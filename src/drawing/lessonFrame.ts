import {
  createBackground,
  type BackgroundPreset,
  type Rect,
} from "./background";
import { createBadge, type BadgePosition } from "./badge";
import { createCaption } from "./captions";
import { buildGuides } from "./guides";
import { drawTool, type HandStyle, type ToolStyle } from "./pencil";
import {
  INTRO_MS,
  buildTimeline,
  easeStroke,
  locate,
  stepAt,
  type Timeline,
  type TimelineSegment,
} from "./timeline";
import type { ColorLayer, DrawingData, DrawingStroke, Point } from "./types";

/*
 * The single place where a video frame is drawn. The live preview and the
 * exported video both call `createLessonRenderer(...).drawFrame(ctx, timeMs)`,
 * so they cannot drift apart. The frame contains no text: no step numbers,
 * titles, captions or UI.
 *
 * How lines appear: the picture's real line pixels (`lineArt`) are uncovered
 * only along the path the pencil has already travelled. The lines therefore
 * keep the exact shape and thickness of the original drawing, and they are
 * still built up over time along real stroke paths (no wipe, no whole-image fade).
 */

export type FrameStep = {
  strokeIds: readonly number[];
  weight: number;
};

export type AnimationSettings = {
  showPencil: boolean;
  /** Show the original picture as a faint guide under the strokes. */
  showGuide: boolean;
  /** Experimental flat colors from closed regions; only used when no colored image is given. */
  autoColors: boolean;
  /** Pause between two strokes, in milliseconds. */
  strokePauseMs: number;
  tool: ToolStyle;
  hand: HandStyle;
  /** Channel badge (profile picture and account name) in a corner of the video. */
  showBadge: boolean;
  badgeName: string;
  badgePosition: BadgePosition;
  /** Show the colored picture for a moment at the very start (needs a colored image). */
  showTeaser: boolean;
  /** Title card at the start. Nothing is shown when the text is empty. */
  showTitle: boolean;
  titleText: string;
  /** Thank-you card at the end. */
  showOutro: boolean;
  outroText: string;
};

export type RendererInput = {
  width: number;
  height: number;
  steps: readonly FrameStep[];
  drawing: DrawingData | null;
  lineArt: HTMLCanvasElement | null;
  /** Width, in drawing pixels, of the area uncovered around the pencil path. */
  maskWidth: number;
  /** The colored picture shown at the end, if the user provided one. */
  finalImage: HTMLImageElement | null;
  colorLayer: ColorLayer | null;
  guide: HTMLImageElement | null;
  /** Profile picture for the channel badge. */
  badgeImage: HTMLImageElement | null;
  animation: AnimationSettings;
  background: BackgroundPreset;
  hiddenStrokeIds: ReadonlySet<number>;
  totalMs: number;
};

export type LessonRenderer = {
  timeline: Timeline;
  /** Stage playing at `timeMs`. */
  stepAt: (timeMs: number) => number;
  drawFrame: (ctx: CanvasRenderingContext2D, timeMs: number) => void;
};

const GUIDE_OPACITY = 0.18;
const REVEAL_WINDOW = 0.35;
const REVEAL_STEPS = 90;
const FINISH_MS = 400;
const GUIDE_COLOR = "#8a8f98";
const GUIDE_ALPHA = 0.6;

type GuideSegment = {
  points: Point[];
  cumulative: number[];
  length: number;
  start: number;
  end: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitRect(card: Rect, inset: number, w: number, h: number): Rect {
  const scale = Math.min((card.w - inset * 2) / w, (card.h - inset * 2) / h);
  const drawWidth = w * scale;
  const drawHeight = h * scale;

  return {
    x: card.x + (card.w - drawWidth) / 2,
    y: card.y + (card.h - drawHeight) / 2,
    w: drawWidth,
    h: drawHeight,
  };
}

function appendPolyline(ctx: CanvasRenderingContext2D, points: readonly Point[]) {
  if (points.length === 0) return;

  ctx.moveTo(points[0][0], points[0][1]);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
}

function createLayer(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a drawing layer.");

  return { canvas, ctx };
}

/** The first `target` units of a stroke, plus the pen-tip position and direction. */
function partialStroke(
  segment: Pick<TimelineSegment, "points" | "cumulative">,
  target: number,
): { points: Point[]; tip: Point; angle: number } {
  const { points, cumulative } = segment;
  let low = 0;
  let high = cumulative.length - 1;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] < target) low = mid + 1;
    else high = mid;
  }

  if (low === 0) return { points: [points[0]], tip: points[0], angle: 0 };

  const [x0, y0] = points[low - 1];
  const [x1, y1] = points[low];
  const span = cumulative[low] - cumulative[low - 1];
  const t = span > 0 ? (target - cumulative[low - 1]) / span : 0;
  const tip: Point = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  const out = points.slice(0, low);
  out.push(tip);

  const back = out[Math.max(0, out.length - 5)];
  const angle = Math.atan2(tip[1] - back[1], tip[0] - back[0]);

  return { points: out, tip, angle: Number.isFinite(angle) ? angle : 0 };
}

type Region = { x: number; y: number; w: number; h: number };

/** Points between two distances along a stroke, including the exact end points. */
function pieceOf(
  segment: Pick<TimelineSegment, "points" | "cumulative">,
  from: number,
  to: number,
): Point[] {
  const a = partialStroke(segment, from);
  const b = partialStroke(segment, to);

  return [a.tip, ...b.points.slice(a.points.length - 1, b.points.length - 1), b.tip];
}

function createColorPainter(layer: ColorLayer) {
  const { canvas, ctx } = createLayer(layer.width, layer.height);
  const image = ctx.createImageData(layer.width, layer.height);
  let lastKey = -1;

  const paint = (progress: number) => {
    const key = Math.round(clamp(progress, 0, 1) * REVEAL_STEPS);
    if (key === lastKey) return;
    lastKey = key;

    const p = key / REVEAL_STEPS;
    const alphas = new Uint8ClampedArray(layer.regionCount + 1);

    for (let region = 1; region <= layer.regionCount; region++) {
      const start = layer.ranks[region] * (1 - REVEAL_WINDOW);
      alphas[region] = Math.round(clamp((p - start) / REVEAL_WINDOW, 0, 1) * 255);
    }

    const { data } = image;
    const { labels, colors } = layer;

    for (let i = 0; i < labels.length; i++) {
      const region = labels[i];
      const o = i * 4;

      if (region === 0) {
        data[o + 3] = 0;
        continue;
      }

      data[o] = colors[region * 3];
      data[o + 1] = colors[region * 3 + 1];
      data[o + 2] = colors[region * 3 + 2];
      data[o + 3] = alphas[region];
    }

    ctx.putImageData(image, 0, 0);
  };

  return { canvas, paint };
}

export function createLessonRenderer(input: RendererInput): LessonRenderer {
  const {
    width,
    height,
    steps,
    drawing,
    lineArt,
    maskWidth,
    finalImage,
    colorLayer,
    guide,
    badgeImage,
    animation,
    background,
    hiddenStrokeIds,
    totalMs,
  } = input;

  const base = Math.min(width, height);
  const bg = createBackground(width, height, background);
  const inset = Math.round(base * 0.06);

  const fit = drawing
    ? fitRect(bg.sheet, inset, drawing.width, drawing.height)
    : null;
  const finalFit =
    finalImage && finalImage.naturalWidth > 0 && finalImage.naturalHeight > 0
      ? fitRect(bg.sheet, inset, finalImage.naturalWidth, finalImage.naturalHeight)
      : null;

  const strokeMap = new Map<number, DrawingStroke>();
  if (drawing) {
    for (const stroke of drawing.strokes) strokeMap.set(stroke.id, stroke);
  }

  const useAutoColors =
    animation.autoColors && finalFit === null && colorLayer !== null && colorLayer.regionCount > 0;
  const hasFinal = finalFit !== null || useAutoColors;

  // Construction lines: drawn first, erased after the last real stroke.
  const guidePaths = buildGuides(drawing, hiddenStrokeIds);
  const guideLengths = guidePaths.map((points) => {
    const cumulative = [0];

    for (let i = 1; i < points.length; i++) {
      cumulative.push(
        cumulative[i - 1] +
          Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
      );
    }

    return { points, cumulative, length: cumulative[cumulative.length - 1] };
  });
  const guideTotal = guideLengths.reduce((sum, item) => sum + item.length, 0);
  const lastGuide = guideLengths[guideLengths.length - 1];
  const timeline = buildTimeline(
    steps,
    strokeMap,
    hiddenStrokeIds,
    totalMs,
    hasFinal,
    animation.strokePauseMs,
    lastGuide ? lastGuide.points[lastGuide.points.length - 1] : null,
  );
  const guideSegments: GuideSegment[] = [];
  let guideCursor = INTRO_MS;

  for (const item of guideLengths) {
    const span =
      guideTotal > 0 ? ((timeline.guideEnd - INTRO_MS) * item.length) / guideTotal : 0;

    guideSegments.push({ ...item, start: guideCursor, end: guideCursor + span });
    guideCursor += span;
  }

  const painter = useAutoColors && colorLayer ? createColorPainter(colorLayer) : null;

  // Layers for the revealed line art. Finished strokes are composed once and kept,
  // so a long video does not get slower.
  const layers =
    fit && drawing && lineArt
      ? {
          done: createLayer(fit.w, fit.h),
          scratch: createLayer(fit.w, fit.h),
          partial: createLayer(fit.w, fit.h),
        }
      : null;
  const layerScale = layers && drawing ? layers.done.canvas.width / drawing.width : 1;

  // The line art is scaled to the layer size once, so every frame only copies pixels.
  let lineScaled: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

  if (layers && lineArt) {
    lineScaled = createLayer(layers.done.canvas.width, layers.done.canvas.height);
    lineScaled.ctx.imageSmoothingEnabled = true;
    lineScaled.ctx.imageSmoothingQuality = "high";
    lineScaled.ctx.drawImage(
      lineArt,
      0,
      0,
      lineScaled.canvas.width,
      lineScaled.canvas.height,
    );
  }

  /** The layer area touched by these paths, so only that part is redrawn. */
  const regionOf = (paths: readonly (readonly Point[])[]): Region | null => {
    if (!layers) return null;

    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;

    for (const points of paths) {
      for (const [x, y] of points) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }

    if (x0 > x1) return null;

    const pad = (maskWidth / 2 + 2) * layerScale + 2;
    const maxW = layers.done.canvas.width;
    const maxH = layers.done.canvas.height;
    const left = clamp(Math.floor(x0 * layerScale - pad), 0, maxW);
    const top = clamp(Math.floor(y0 * layerScale - pad), 0, maxH);
    const right = clamp(Math.ceil(x1 * layerScale + pad), 0, maxW);
    const bottom = clamp(Math.ceil(y1 * layerScale + pad), 0, maxH);

    return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
  };
  const mainScale = fit && drawing ? fit.w / drawing.width : 1;
  const pencilSize = base * 0.3;
  let drawnCount = 0;
  let activeIndex = -1;
  let activeLength = 0;

  /**
   * Draws `build`'s thick strokes in `region` of `target`, then keeps only the line
   * art under them. Everything outside the region is left untouched.
   */
  const uncover = (
    target: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D },
    build: (ctx: CanvasRenderingContext2D) => void,
    region: Region | null,
  ) => {
    if (!lineScaled || !region) return;
    const { ctx } = target;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(region.x, region.y, region.w, region.h);
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.w, region.h);
    ctx.clip();

    ctx.setTransform(layerScale, 0, 0, layerScale, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = maskWidth;
    ctx.strokeStyle = "#000000";
    ctx.beginPath();
    build(ctx);
    ctx.stroke();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(
      lineScaled.canvas,
      region.x,
      region.y,
      region.w,
      region.h,
      region.x,
      region.y,
      region.w,
      region.h,
    );
    ctx.restore();
  };

  const syncDone = (count: number) => {
    if (!layers) return;

    if (count < drawnCount) {
      layers.done.ctx.clearRect(0, 0, layers.done.canvas.width, layers.done.canvas.height);
      drawnCount = 0;
    }

    if (count === drawnCount) return;

    const fresh = timeline.segments.slice(drawnCount, count).map((item) => item.points);
    const region = regionOf(fresh);

    uncover(
      layers.scratch,
      (ctx) => {
        for (const points of fresh) appendPolyline(ctx, points);
      },
      region,
    );

    if (region) {
      layers.done.ctx.drawImage(
        layers.scratch.canvas,
        region.x,
        region.y,
        region.w,
        region.h,
        region.x,
        region.y,
        region.w,
        region.h,
      );
    }

    drawnCount = count;
  };

  const badge = animation.showBadge
    ? createBadge(width, height, animation.badgeName, badgeImage, animation.badgePosition)
    : null;

  const drawBadge = (ctx: CanvasRenderingContext2D, t: number) => {
    if (!badge) return;

    ctx.save();
    ctx.globalAlpha = clamp((t - 200) / 500, 0, 1);
    ctx.drawImage(badge.canvas, badge.x, badge.y);
    ctx.restore();
  };

  const sheet = bg.sheet;
  const titleCard = animation.showTitle
    ? createCaption(
        animation.titleText,
        sheet.x + sheet.w / 2,
        sheet.y + sheet.h * 0.1,
        sheet.w * 0.92,
        base,
        0.06,
        "#ffb703",
      )
    : null;
  const outroCard = animation.showOutro && hasFinal
    ? createCaption(
        animation.outroText,
        sheet.x + sheet.w / 2,
        sheet.y + sheet.h - base * 0.08,
        sheet.w * 0.92,
        base,
        0.04,
        "#4dabf7",
      )
    : null;
  const outroStart = totalMs - Math.min(2800, (totalMs - timeline.drawEnd) * 0.8);

  const drawOverlays = (ctx: CanvasRenderingContext2D, t: number) => {
    // Teaser: the finished colored picture, for a moment, so viewers know what they will get.
    if (animation.showTeaser && finalImage && finalFit && t < INTRO_MS) {
      const alpha = 1 - clamp((t - INTRO_MS * 0.6) / (INTRO_MS * 0.4), 0, 1);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "multiply";
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(finalImage, finalFit.x, finalFit.y, finalFit.w, finalFit.h);
      ctx.restore();
    }

    if (titleCard) {
      const alpha =
        clamp(t / 250, 0, 1) * (1 - clamp((t - INTRO_MS - 300) / 400, 0, 1));

      if (alpha > 0) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(titleCard.canvas, titleCard.x, titleCard.y);
        ctx.restore();
      }
    }

    if (outroCard) {
      const alpha = clamp((t - outroStart) / 500, 0, 1);

      if (alpha > 0) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(outroCard.canvas, outroCard.x, outroCard.y);
        ctx.restore();
      }
    }
  };

  const drawGuides = (
    ctx: CanvasRenderingContext2D,
    t: number,
    area: Rect,
  ): { x: number; y: number; angle: number } | null => {
    if (guideSegments.length === 0) return null;

    const cleanSpan = timeline.drawEnd - timeline.strokesEnd;
    const fade =
      cleanSpan > 0 ? 1 - clamp((t - timeline.strokesEnd) / cleanSpan, 0, 1) : 1;
    let tip: { x: number; y: number; angle: number } | null = null;

    if (fade > 0) {
      ctx.save();
      ctx.translate(area.x, area.y);
      ctx.scale(mainScale, mainScale);
      ctx.globalAlpha = GUIDE_ALPHA * fade;
      ctx.strokeStyle = GUIDE_COLOR;
      ctx.lineWidth = Math.max(1.5, base * 0.004) / mainScale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([10 / mainScale, 8 / mainScale]);
      ctx.beginPath();

      for (const segment of guideSegments) {
        if (t >= segment.end) {
          appendPolyline(ctx, segment.points);
        } else if (t > segment.start) {
          const u = (t - segment.start) / (segment.end - segment.start);
          const part = partialStroke(segment, u * segment.length);

          appendPolyline(ctx, part.points);
          tip = { x: part.tip[0], y: part.tip[1], angle: part.angle };
        }
      }

      ctx.stroke();
      ctx.restore();
    }

    if (!tip && t < INTRO_MS) {
      const first = guideSegments[0].points[0];
      tip = { x: first[0], y: first[1], angle: 0 };
    }

    return tip;
  };

  const drawFrame = (ctx: CanvasRenderingContext2D, timeMs: number) => {
    const t = clamp(timeMs, 0, totalMs);

    ctx.drawImage(bg.canvas, 0, 0);

    if (!fit || !drawing) {
      drawBadge(ctx, t);
      return;
    }

    if (animation.showGuide && guide) {
      ctx.save();
      ctx.globalAlpha = GUIDE_OPACITY;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(guide, fit.x, fit.y, fit.w, fit.h);
      ctx.restore();
    }

    // Experimental flat colors go under the lines.
    if (painter && timeline.revealEnd > timeline.revealStart) {
      const progress = clamp(
        (t - timeline.revealStart) / (timeline.revealEnd - timeline.revealStart),
        0,
        1,
      );

      if (progress > 0) {
        painter.paint(progress);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(painter.canvas, fit.x, fit.y, fit.w, fit.h);
        ctx.restore();
      }
    }

    const guidePen = drawGuides(ctx, t, fit);
    const state = locate(timeline, t);
    syncDone(state.completed);

    if (layers) ctx.drawImage(layers.done.canvas, fit.x, fit.y, fit.w, fit.h);

    // The stroke being drawn right now: only the part the pencil has reached.
    let pen: { x: number; y: number; angle: number; lift: number } | null = null;

    if (state.active) {
      const { segment, u } = state.active;
      const part = partialStroke(segment, easeStroke(u) * segment.length);

      if (layers) {
        const target = easeStroke(u) * segment.length;

        // Only the newly drawn piece of the stroke is uncovered on each frame.
        if (state.completed !== activeIndex || target < activeLength) {
          layers.partial.ctx.clearRect(
            0,
            0,
            layers.partial.canvas.width,
            layers.partial.canvas.height,
          );
          activeIndex = state.completed;
          activeLength = 0;
        }

        if (target > activeLength) {
          const piece = pieceOf(segment, activeLength, target);
          const region = regionOf([piece]);

          uncover(layers.scratch, (layerCtx) => appendPolyline(layerCtx, piece), region);

          if (region) {
            layers.partial.ctx.drawImage(
              layers.scratch.canvas,
              region.x,
              region.y,
              region.w,
              region.h,
              region.x,
              region.y,
              region.w,
              region.h,
            );
          }

          activeLength = target;
        }

        ctx.drawImage(layers.partial.canvas, fit.x, fit.y, fit.w, fit.h);
      }

      pen = { x: part.tip[0], y: part.tip[1], angle: part.angle, lift: 0 };
    } else if (state.travel) {
      const { segment, p } = state.travel;
      const eased = p * p * (3 - 2 * p);
      const target = segment.points[0];

      pen = {
        x: segment.from[0] + (target[0] - segment.from[0]) * eased,
        y: segment.from[1] + (target[1] - segment.from[1]) * eased,
        angle: Math.atan2(target[1] - segment.from[1], target[0] - segment.from[0]),
        lift: Math.sin(Math.PI * p),
      };
    } else if (guidePen && t < timeline.guideEnd) {
      pen = { ...guidePen, lift: 0 };
    } else if (timeline.segments.length > 0) {
      const previous = timeline.segments[state.completed - 1];
      const next = timeline.segments[state.completed];
      const rest: Point = previous
        ? previous.points[previous.points.length - 1]
        : next.from;

      pen = { x: rest[0], y: rest[1], angle: 0, lift: 0 };
    }

    // Anything the pencil path did not cover (faint details) fades in just before the end,
    // so the finished drawing always equals the picture.
    if (lineArt) {
      const finish = clamp((t - (timeline.strokesEnd - FINISH_MS)) / FINISH_MS, 0, 1);

      if (finish > 0) {
        ctx.save();
        ctx.globalAlpha = finish;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(lineScaled ? lineScaled.canvas : lineArt, fit.x, fit.y, fit.w, fit.h);
        ctx.restore();
      }
    }

    // The colored picture appears at the end and stays on screen.
    if (finalFit && finalImage && timeline.revealEnd > timeline.revealStart) {
      const progress = clamp(
        (t - timeline.revealStart) / (timeline.revealEnd - timeline.revealStart),
        0,
        1,
      );

      if (progress > 0) {
        ctx.save();
        ctx.globalAlpha = progress * progress * (3 - 2 * progress);
        // Multiply keeps the paper color: the picture's white background disappears.
        ctx.globalCompositeOperation = "multiply";
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(finalImage, finalFit.x, finalFit.y, finalFit.w, finalFit.h);
        ctx.restore();
      }
    }

    drawOverlays(ctx, t);
    drawBadge(ctx, t);

    if (animation.showPencil && pen && t >= (animation.showTeaser && finalFit ? INTRO_MS * 0.6 : 0) && t < timeline.drawEnd + 600) {
      const fade = clamp((timeline.drawEnd + 600 - t) / 600, 0, 1);

      drawTool(
        ctx,
        fit.x + pen.x * mainScale,
        fit.y + pen.y * mainScale,
        pen.angle,
        pencilSize,
        pen.lift,
        fade,
        animation.tool,
        animation.hand,
      );
    }
  };

  return {
    timeline,
    stepAt: (timeMs: number) => stepAt(timeline, timeMs),
    drawFrame,
  };
}

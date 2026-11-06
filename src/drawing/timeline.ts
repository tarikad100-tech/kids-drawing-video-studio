import { polylineLength, smoothPolyline } from "./geometry";
import type { DrawingStroke, Point } from "./types";

/*
 * Turns the stages into one deterministic schedule: which stroke is drawn
 * when, how the pen travels between strokes, and when the color reveal starts.
 * The preview and the export both read this same schedule.
 */

/** Time before the first guide line: the title and the colored teaser are shown here. */
export const INTRO_MS = 1200;
export const CLEAN_MS = 700;
const SMOOTHING_ITERATIONS = 2;

export type TimelineStep = { strokeIds: readonly number[]; weight: number };

export type TimelineSegment = {
  stepIndex: number;
  /** Smoothed points, oriented in the direction the pen draws. */
  points: Point[];
  /** Length along the path at each point; cumulative[0] = 0. */
  cumulative: number[];
  length: number;
  /** Pen lifts and starts moving from `from`. */
  travelStart: number;
  /** Pen touches the paper. */
  start: number;
  end: number;
  from: Point;
};

export type Timeline = {
  segments: TimelineSegment[];
  /** Start of every step plus the end of the drawing phase (length = steps + 1). */
  stepStarts: number[];
  /** The guide (construction) lines are drawn between INTRO_MS and `guideEnd`. */
  guideEnd: number;
  /** The last real stroke ends here; the guide lines are then erased until `drawEnd`. */
  strokesEnd: number;
  drawEnd: number;
  revealStart: number;
  revealEnd: number;
  totalMs: number;
};

export type Locate = {
  /** Number of strokes already finished. */
  completed: number;
  active: { segment: TimelineSegment; u: number } | null;
  travel: { segment: TimelineSegment; p: number } | null;
};

type Prepared = { points: Point[]; cumulative: number[]; length: number };

function cumulativeLengths(points: readonly Point[]): number[] {
  const out = [0];

  for (let i = 1; i < points.length; i++) {
    out.push(
      out[i - 1] +
        Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
    );
  }

  return out;
}

function prepare(stroke: DrawingStroke): Prepared {
  const points = smoothPolyline(stroke.points, SMOOTHING_ITERATIONS);

  return {
    points,
    cumulative: cumulativeLengths(points),
    length: polylineLength(points),
  };
}

function reversed(item: Prepared): Prepared {
  const points = [...item.points].reverse();

  return { points, cumulative: cumulativeLengths(points), length: item.length };
}

/** Slow start and slow end of every stroke, like a hand speeding up and easing off. */
export function easeStroke(u: number): number {
  const clamped = Math.min(1, Math.max(0, u));
  const smooth = clamped * clamped * (3 - 2 * clamped);

  return 0.6 * clamped + 0.4 * smooth;
}

/** Time reserved before the first stage for the guide lines. */
export function guideMsFor(totalMs: number): number {
  return Math.min(totalMs * 0.15, Math.min(3200, Math.max(1500, totalMs * 0.08)));
}

export function planPhases(totalMs: number, colorReveal: boolean) {
  const tail = colorReveal
    ? Math.min(totalMs * 0.5, Math.max(3000, Math.min(12000, totalMs * 0.25)))
    : Math.min(1500, totalMs * 0.1);
  const drawEnd = totalMs - tail;
  const revealStart = colorReveal ? drawEnd + 300 : totalMs;
  const revealEnd = colorReveal ? revealStart + tail * 0.5 : totalMs;
  const guideEnd = INTRO_MS + guideMsFor(totalMs);
  const strokesEnd = Math.max(guideEnd, drawEnd - Math.min(CLEAN_MS, totalMs * 0.06));

  return { guideEnd, strokesEnd, drawEnd, revealStart, revealEnd };
}

/** How long each stage lasts, in milliseconds. */
export function stepDurationsMs(
  steps: readonly { weight: number }[],
  totalMs: number,
  colorReveal: boolean,
): number[] {
  const { guideEnd, strokesEnd } = planPhases(totalMs, colorReveal);
  const available = Math.max(0, strokesEnd - guideEnd);
  const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0);

  return steps.map((step) =>
    totalWeight > 0 ? (available * step.weight) / totalWeight : 0,
  );
}

export function buildTimeline(
  steps: readonly TimelineStep[],
  strokes: ReadonlyMap<number, DrawingStroke>,
  hidden: ReadonlySet<number>,
  totalMs: number,
  colorReveal: boolean,
  pauseMs: number,
  /** Where the pen is when the first stage begins (the end of the guide lines). */
  startPen: Point | null = null,
): Timeline {
  const phases = planPhases(totalMs, colorReveal);
  const durations = stepDurationsMs(steps, totalMs, colorReveal);
  const segments: TimelineSegment[] = [];
  const stepStarts: number[] = [];
  let cursor = phases.guideEnd;
  let pen: Point | null = startPen;

  steps.forEach((step, stepIndex) => {
    const stepStart = cursor;
    const duration = durations[stepIndex];
    stepStarts.push(stepStart);
    cursor = stepStart + duration;

    const items: Prepared[] = [];
    for (const id of step.strokeIds) {
      const stroke = strokes.get(id);
      if (stroke && !hidden.has(id)) items.push(prepare(stroke));
    }

    const totalLength = items.reduce((sum, item) => sum + item.length, 0);
    if (items.length === 0 || totalLength <= 0) return;

    // Pauses between strokes never take more than 30% of the stage.
    const gapTotal = Math.min(items.length * pauseMs, duration * 0.3);
    const gap = gapTotal / items.length;
    const drawTotal = duration - gapTotal;
    let time = stepStart;

    for (const item of items) {
      const first = item.points[0];
      const last = item.points[item.points.length - 1];
      const forward =
        pen === null ||
        Math.hypot(pen[0] - first[0], pen[1] - first[1]) <=
          Math.hypot(pen[0] - last[0], pen[1] - last[1]);
      const oriented = forward ? item : reversed(item);
      const start = time + gap;
      const end = start + (drawTotal * item.length) / totalLength;

      segments.push({
        stepIndex,
        points: oriented.points,
        cumulative: oriented.cumulative,
        length: oriented.length,
        travelStart: time,
        start,
        end,
        from: pen ?? oriented.points[0],
      });

      time = end;
      pen = oriented.points[oriented.points.length - 1];
    }
  });

  stepStarts.push(phases.strokesEnd);

  return {
    segments,
    stepStarts,
    guideEnd: phases.guideEnd,
    strokesEnd: phases.strokesEnd,
    drawEnd: phases.drawEnd,
    revealStart: phases.revealStart,
    revealEnd: phases.revealEnd,
    totalMs,
  };
}

export function locate(timeline: Timeline, t: number): Locate {
  const segments = timeline.segments;
  let low = 0;
  let high = segments.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (segments[mid].end <= t) low = mid + 1;
    else high = mid;
  }

  const completed = low;
  const segment = segments[completed];

  if (!segment) return { completed, active: null, travel: null };

  if (t >= segment.start) {
    const span = segment.end - segment.start;

    return {
      completed,
      active: { segment, u: span > 0 ? (t - segment.start) / span : 1 },
      travel: null,
    };
  }

  if (t >= segment.travelStart && segment.start > segment.travelStart) {
    return {
      completed,
      active: null,
      travel: {
        segment,
        p: (t - segment.travelStart) / (segment.start - segment.travelStart),
      },
    };
  }

  return { completed, active: null, travel: null };
}

/** Index of the stage playing at time `t`. */
export function stepAt(timeline: Timeline, t: number): number {
  const count = timeline.stepStarts.length - 1;
  if (count <= 0) return 0;

  let low = 0;
  let high = count - 1;

  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (timeline.stepStarts[mid] <= t) low = mid;
    else high = mid - 1;
  }

  return low;
}

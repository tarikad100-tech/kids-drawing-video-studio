import { HAND_SPRITES, getHandImage } from "./handSprites";

export type ToolStyle = "pencil" | "pen" | "crayon";
export type HandStyle = "none" | "light" | "tan" | "brown" | "dark" | "glove";

export const TOOL_OPTIONS: ReadonlyArray<readonly [ToolStyle, string]> = [
  ["pencil", "Pencil"],
  ["pen", "Felt-tip pen"],
  ["crayon", "Crayon"],
];

export const HAND_OPTIONS: ReadonlyArray<readonly [HandStyle, string]> = [
  ["light", "Hand: light skin"],
  ["tan", "Hand: tan skin"],
  ["brown", "Hand: brown skin"],
  ["dark", "Hand: dark skin"],
  ["glove", "Cartoon glove"],
  ["none", "No hand"],
];

export function isToolStyle(value: unknown): value is ToolStyle {
  return value === "pencil" || value === "pen" || value === "crayon";
}

export function isHandStyle(value: unknown): value is HandStyle {
  return (
    value === "none" ||
    value === "light" ||
    value === "tan" ||
    value === "brown" ||
    value === "dark" ||
    value === "glove"
  );
}

type Palette = {
  body: readonly [string, string, string];
  cone: string;
  coneLength: number;
  point: string;
  pointLength: number;
  ferrule: boolean;
  cap: string;
};

const TOOLS: Record<ToolStyle, Palette> = {
  pencil: {
    body: ["#fbd75c", "#f0b429", "#c98516"],
    cone: "#f2d3a8",
    coneLength: 0.12,
    point: "#3b3b42",
    pointLength: 0.04,
    ferrule: true,
    cap: "#ef8a8a",
  },
  pen: {
    body: ["#8fd0ff", "#3d8bff", "#2a5fc4"],
    cone: "#4a4f57",
    coneLength: 0.09,
    point: "#111111",
    pointLength: 0.03,
    ferrule: false,
    cap: "#ffffff",
  },
  crayon: {
    body: ["#ff9a90", "#e5484d", "#b5282c"],
    cone: "#e5484d",
    coneLength: 0.07,
    point: "#b5282c",
    pointLength: 0.02,
    ferrule: false,
    cap: "#f4e7c8",
  },
};

const SKIN: Record<Exclude<HandStyle, "none">, { fill: string; edge: string; sleeve: string }> = {
  light: { fill: "#f9d3b4", edge: "#d9a17a", sleeve: "#ff8fab" },
  tan: { fill: "#e8b48a", edge: "#c18559", sleeve: "#6ec6ff" },
  brown: { fill: "#b9794f", edge: "#8d5632", sleeve: "#ffd166" },
  dark: { fill: "#7a4b33", edge: "#55321f", sleeve: "#9be3a6" },
  glove: { fill: "#ffffff", edge: "#aab4bf", sleeve: "#ff8fab" },
};

type Skin = { fill: string; edge: string; sleeve: string };

type Pt = readonly [number, number];

const quad = (a: Pt, c: Pt, b: Pt, t: number): Pt => [
  (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
  (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
];

function lineWidthFor(size: number): number {
  return Math.max(1.5, size * 0.009);
}

/**
 * A tapered, rounded finger (or the forearm) along a curve, wider at `a`
 * (radius r0) than at `b` (radius r1). Coordinates are fractions of `size`.
 * Returns the unit direction at the tip so details (a nail) can follow it.
 */
function tube(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  size: number,
  a: Pt,
  c: Pt,
  b: Pt,
  r0: number,
  r1: number,
): number {
  const steps = 16;
  const left: Pt[] = [];
  const right: Pt[] = [];
  let tipAngle = 0;
  let startAngle = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [px, py] = quad(a, c, b, t);
    const dx = 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
    const dy = 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const r = r0 + (r1 - r0) * t;

    left.push([(px + nx * r) * size, (py + ny * r) * size]);
    right.push([(px - nx * r) * size, (py - ny * r) * size]);

    if (i === 0) startAngle = Math.atan2(ny, nx);
    if (i === steps) tipAngle = Math.atan2(ny, nx);
  }

  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i <= steps; i++) ctx.lineTo(left[i][0], left[i][1]);
  ctx.arc(b[0] * size, b[1] * size, r1 * size, tipAngle, tipAngle - Math.PI, true);
  for (let i = steps; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.arc(a[0] * size, a[1] * size, r0 * size, startAngle + Math.PI, startAngle, true);
  ctx.closePath();
  ctx.fillStyle = skin.fill;
  ctx.fill();
  ctx.lineWidth = lineWidthFor(size);
  ctx.lineJoin = "round";
  ctx.strokeStyle = skin.edge;
  ctx.stroke();

  // Soft highlight along the top edge and a faint shadow along the bottom edge.
  ctx.save();
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 2; i <= steps - 3; i++) {
    const t = i / steps;
    const [px, py] = quad(a, c, b, t);
    const dx = 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
    const dy = 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
    const length = Math.hypot(dx, dy) || 1;
    const r = (r0 + (r1 - r0) * t) * 0.5;
    const x = (px + (dy / length) * r) * size;
    const y = (py - (dx / length) * r) * size;
    if (i === 2) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = Math.max(1, (r0 + r1) * size * 0.28);
  ctx.stroke();
  ctx.restore();

  return Math.atan2(b[1] - c[1], b[0] - c[0]);
}

function nail(ctx: CanvasRenderingContext2D, size: number, tip: Pt, angle: number, radius: number, glove: boolean) {
  if (glove) return;

  ctx.save();
  ctx.translate((tip[0] - Math.cos(angle) * radius * 0.7) * size, (tip[1] - Math.sin(angle) * radius * 0.7) * size);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.62 * size, radius * 0.5 * size, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 244, 238, 0.8)";
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.004);
  ctx.strokeStyle = "rgba(160, 100, 80, 0.45)";
  ctx.stroke();
  ctx.restore();
}

/** A smooth closed shape through the given points. */
function softShape(ctx: CanvasRenderingContext2D, skin: Skin, size: number, points: readonly Pt[]) {
  const n = points.length;
  const mid = (i: number): Pt => {
    const p = points[i % n];
    const q = points[(i + 1) % n];

    return [((p[0] + q[0]) / 2) * size, ((p[1] + q[1]) / 2) * size];
  };

  ctx.beginPath();
  const start = mid(n - 1);
  ctx.moveTo(start[0], start[1]);

  for (let i = 0; i < n; i++) {
    const m = mid(i);
    ctx.quadraticCurveTo(points[i][0] * size, points[i][1] * size, m[0], m[1]);
  }

  ctx.closePath();
  ctx.fillStyle = skin.fill;
  ctx.fill();
  ctx.lineWidth = lineWidthFor(size);
  ctx.lineJoin = "round";
  ctx.strokeStyle = skin.edge;
  ctx.stroke();
}

/*
 * A relaxed writing grip, in the pencil's own frame (tip at (0, 0), the pencil
 * along +x). The pencil is pinched between the thumb and the index finger and
 * rests on the middle finger; the other two fingers curl under. The back of
 * the hand sits behind the pencil and the forearm leaves toward the lower
 * right, with a sleeve.
 */

/** Behind the pencil: sleeve, forearm, back of the hand and the hidden fingers. */
function drawHandBack(ctx: CanvasRenderingContext2D, skin: Skin, size: number) {
  const wrist: Pt = [0.5, 0.24];
  const elbow: Pt = [0.62, 0.86];
  const angle = Math.atan2(elbow[1] - wrist[1], elbow[0] - wrist[0]);

  // Forearm and sleeve.
  tube(ctx, skin, size, wrist, [0.56, 0.52], elbow, 0.066, 0.078);

  ctx.save();
  ctx.translate(wrist[0] * size, wrist[1] * size);
  ctx.rotate(angle - Math.PI / 2);
  ctx.beginPath();
  ctx.roundRect(-size * 0.115, size * 0.2, size * 0.23, size * 0.6, size * 0.035);
  ctx.fillStyle = skin.sleeve;
  ctx.fill();
  ctx.lineWidth = lineWidthFor(size);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.fillRect(-size * 0.115, size * 0.2, size * 0.23, size * 0.045);
  ctx.restore();

  // Back of the hand.
  softShape(ctx, skin, size, [
    [0.3, 0.02],
    [0.42, -0.02],
    [0.53, 0.04],
    [0.55, 0.17],
    [0.5, 0.27],
    [0.4, 0.28],
    [0.31, 0.15],
  ]);

  // Curled ring and little fingers: two rounded knuckles below the hand.
  for (const [x, y, rx, ry, rot] of [
    [0.37, 0.265, 0.05, 0.034, 0.5],
    [0.44, 0.3, 0.048, 0.032, 0.7],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(x * size, y * size, rx * size, ry * size, rot, 0, Math.PI * 2);
    ctx.fillStyle = skin.fill;
    ctx.fill();
    ctx.lineWidth = lineWidthFor(size);
    ctx.strokeStyle = skin.edge;
    ctx.stroke();
  }

  // Middle finger: it supports the pencil from below.
  tube(ctx, skin, size, [0.4, 0.15], [0.35, 0.11], [0.28, 0.05], 0.038, 0.03);
}

/** In front of the pencil: the index finger and the thumb pinching it. */
function drawHandFront(ctx: CanvasRenderingContext2D, skin: Skin, size: number, glove: boolean) {
  // Index finger: arches over the pencil from the knuckle.
  const indexTip: Pt = [0.27, -0.012];
  const indexAngle = tube(ctx, skin, size, [0.5, 0.05], [0.38, -0.06], indexTip, 0.044, 0.031);
  nail(ctx, size, indexTip, indexAngle, 0.03, glove);

  // Thumb: from the base of the hand to the pencil, from the other side.
  const thumbTip: Pt = [0.22, 0.04];
  const thumbAngle = tube(ctx, skin, size, [0.45, 0.25], [0.31, 0.2], thumbTip, 0.05, 0.034);
  nail(ctx, size, thumbTip, thumbAngle, 0.032, glove);

  // Small crease at the knuckles of the back of the hand.
  ctx.strokeStyle = skin.edge;
  ctx.globalAlpha *= 0.55;
  ctx.lineWidth = Math.max(1, size * 0.004);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(size * 0.44, size * 0.075);
  ctx.quadraticCurveTo(size * 0.46, size * 0.1, size * 0.45, size * 0.13);
  ctx.stroke();
  ctx.globalAlpha /= 0.55;

  if (glove) {
    ctx.strokeStyle = "rgba(120, 130, 145, 0.7)";
    ctx.lineWidth = Math.max(1, size * 0.005);

    for (const [x0, y0, x1, y1] of [
      [0.4, 0.06, 0.38, 0.12],
      [0.44, 0.1, 0.43, 0.17],
      [0.37, 0.1, 0.35, 0.16],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x0 * size, y0 * size);
      ctx.lineTo(x1 * size, y1 * size);
      ctx.stroke();
    }
  }
}

/** Shade a "rgb(r,g,b)" string by a factor. */
function shade(rgb: string, f: number): string {
  const n = rgb.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
  return `rgb(${n.map((v) => Math.round(v * f)).join(",")})`;
}

/** Realistic sprite hand. Returns false when the image is not loaded yet. */
function drawHandSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  travelAngle: number,
  size: number,
  lift: number,
  alpha: number,
  hand: Exclude<HandStyle, "none">,
): boolean {
  const img = getHandImage(hand);
  if (!img) return false;
  const sp = HAND_SPRITES[hand];
  const s = size / sp.length;
  const axis = -Math.PI * 0.34 + 0.22 * Math.cos(travelAngle);

  // Contact shadow.
  ctx.save();
  ctx.globalAlpha = alpha * (0.2 - 0.08 * lift);
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.ellipse(
    x + size * 0.02 + lift * size * 0.03,
    y + size * 0.012 + lift * size * 0.05,
    size * 0.05 * (1 + lift * 0.4),
    size * 0.013 * (1 + lift * 0.4),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y - lift * size * 0.04);
  ctx.rotate(axis - sp.axis);
  ctx.scale(s, s);
  ctx.translate(-sp.tip[0], -sp.tip[1]);

  // Forearm and sleeve continuing from the sprite's cut edge.
  const x0 = sp.cutX - 12;
  const top = sp.armTop;
  const bot = sp.armBottom;
  const mid = (top + bot) / 2;
  const half = (bot - top) / 2;
  const line = shade(sp.skin, 0.42);
  const reach = 1400;
  const sleeveAt = x0 + 330;

  const armPath = (xa: number, xb: number, ha: number, hb: number) => {
    ctx.beginPath();
    ctx.moveTo(xa, mid - ha);
    ctx.lineTo(xb, mid - hb);
    ctx.lineTo(xb, mid + hb);
    ctx.lineTo(xa, mid + ha);
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = line;
  ctx.fillStyle = sp.skin;
  armPath(x0, sleeveAt, half, half * 1.06);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x0, mid - half);
  ctx.lineTo(sleeveAt, mid - half * 1.06);
  ctx.moveTo(x0, mid + half);
  ctx.lineTo(sleeveAt, mid + half * 1.06);
  ctx.stroke();

  const sleeve = ctx.createLinearGradient(0, mid - half * 1.5, 0, mid + half * 1.5);
  sleeve.addColorStop(0, shade(sp.sleeve, 1.04));
  sleeve.addColorStop(1, shade(sp.sleeve, 0.86));
  ctx.fillStyle = sleeve;
  ctx.strokeStyle = shade(sp.sleeve, 0.45);
  ctx.beginPath();
  ctx.moveTo(sleeveAt - 8, mid - half * 1.12);
  ctx.quadraticCurveTo(sleeveAt + 14, mid, sleeveAt - 8, mid + half * 1.12);
  ctx.lineTo(sleeveAt + reach, mid + half * 1.9);
  ctx.lineTo(sleeveAt + reach, mid - half * 1.9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.drawImage(img, 0, 0);
  ctx.restore();
  return true;
}

/**
 * Draws the drawing tool, held by a hand, with its tip exactly at (x, y).
 *
 * `travelAngle` is the direction the tool is moving. The tool keeps its usual
 * writing tilt (body pointing up and to the right) and leans a little with the
 * horizontal movement. `lift` (0–1) raises it off the paper while it travels
 * between strokes.
 */
export function drawTool(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  travelAngle: number,
  size: number,
  lift: number,
  alpha: number,
  tool: ToolStyle,
  hand: HandStyle,
) {
  if (alpha <= 0) return;

  if (hand !== "none" && drawHandSprite(ctx, x, y, travelAngle, size, lift, alpha, hand)) return;

  const palette = TOOLS[tool];
  const axis = -Math.PI * 0.34 + 0.22 * Math.cos(travelAngle);
  const length = size;
  const width = size * 0.075;
  const skin = hand === "none" ? null : SKIN[hand];

  // Soft contact shadow on the paper.
  ctx.save();
  ctx.globalAlpha = alpha * (0.2 - 0.08 * lift);
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.ellipse(
    x + size * 0.02 + lift * size * 0.03,
    y + size * 0.012 + lift * size * 0.05,
    size * 0.05 * (1 + lift * 0.4),
    size * 0.013 * (1 + lift * 0.4),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y - lift * size * 0.04);
  ctx.rotate(axis);

  if (skin) drawHandBack(ctx, skin, size);

  // Cone, then the colored point at its end.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(length * palette.coneLength, -width / 2);
  ctx.lineTo(length * palette.coneLength, width / 2);
  ctx.closePath();
  ctx.fillStyle = palette.cone;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(length * palette.pointLength, -width * 0.17);
  ctx.lineTo(length * palette.pointLength, width * 0.17);
  ctx.closePath();
  ctx.fillStyle = palette.point;
  ctx.fill();

  // Body with simple shading.
  const bodyStart = length * palette.coneLength;
  const bodyEnd = length * (palette.ferrule ? 0.86 : 0.93);
  const body = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
  body.addColorStop(0, palette.body[0]);
  body.addColorStop(0.5, palette.body[1]);
  body.addColorStop(1, palette.body[2]);
  ctx.fillStyle = body;
  ctx.fillRect(bodyStart, -width / 2, bodyEnd - bodyStart, width);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
  ctx.lineWidth = Math.max(1, size * 0.003);
  ctx.beginPath();
  ctx.moveTo(bodyStart, -width * 0.17);
  ctx.lineTo(bodyEnd, -width * 0.17);
  ctx.moveTo(bodyStart, width * 0.17);
  ctx.lineTo(bodyEnd, width * 0.17);
  ctx.stroke();

  if (palette.ferrule) {
    const ferrule = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
    ferrule.addColorStop(0, "#e3e6ea");
    ferrule.addColorStop(0.5, "#b7bcc4");
    ferrule.addColorStop(1, "#8b9098");
    ctx.fillStyle = ferrule;
    ctx.fillRect(bodyEnd, -width / 2, length * 0.07, width);
  }

  ctx.fillStyle = palette.cap;
  ctx.fillRect(length * 0.93, -width / 2, length * 0.07, width);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
  ctx.lineWidth = Math.max(1, size * 0.004);
  ctx.strokeRect(bodyStart, -width / 2, length - bodyStart, width);

  if (skin) drawHandFront(ctx, skin, size, hand === "glove");

  ctx.restore();
}

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

/** A rounded limb or finger: darker edge underneath, skin color on top. */
function limb(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  size: number,
  from: Pt,
  control: Pt,
  to: Pt,
  thickness: number,
) {
  const outline = Math.max(1.5, size * 0.011);

  for (const [color, extra] of [
    [skin.edge, outline * 2],
    [skin.fill, 0],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(from[0] * size, from[1] * size);
    ctx.quadraticCurveTo(control[0] * size, control[1] * size, to[0] * size, to[1] * size);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = thickness * size + extra;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

function blob(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  size: number,
  center: Pt,
  rx: number,
  ry: number,
  rotation: number,
) {
  ctx.beginPath();
  ctx.ellipse(center[0] * size, center[1] * size, rx * size, ry * size, rotation, 0, Math.PI * 2);
  ctx.fillStyle = skin.fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * 0.011);
  ctx.strokeStyle = skin.edge;
  ctx.stroke();
}

/*
 * A simple cartoon fist, in the pencil's own frame (tip at (0, 0), the pencil
 * pointing along +x). Four rounded fingers wrap around the pencil, the thumb
 * rests next to the tip side, and the forearm and sleeve hang down (+y is down
 * and to the right on screen). Simple shapes keep it clean instead of distorted.
 */

function roundedBar(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  size: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.beginPath();
  ctx.roundRect(x * size, y * size, w * size, h * size, (w * size) / 2);
  ctx.fillStyle = skin.fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * 0.009);
  ctx.strokeStyle = skin.edge;
  ctx.stroke();
}

/** Behind the pencil: sleeve, forearm and the palm. */
function drawHandBack(ctx: CanvasRenderingContext2D, skin: Skin, size: number) {
  // Sleeve with a lighter cuff band at its top.
  ctx.save();
  ctx.translate(size * 0.33, size * 0.5);
  ctx.beginPath();
  ctx.roundRect(-size * 0.14, 0, size * 0.28, size * 0.55, size * 0.05);
  ctx.fillStyle = skin.sleeve;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * 0.008);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.fillRect(-size * 0.14, 0, size * 0.28, size * 0.05);
  ctx.restore();

  // Wrist, then the palm under the fingers.
  limb(ctx, skin, size, [0.33, 0.28], [0.33, 0.4], [0.33, 0.55], 0.12);
  blob(ctx, skin, size, [0.32, 0.2], 0.115, 0.1, 0);
}

/** In front of the pencil: four fingers wrapped around it, and the thumb. */
function drawHandFront(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  size: number,
  glove: boolean,
) {
  const left = 0.21;
  const step = 0.048;

  for (let i = 0; i < 4; i++) {
    roundedBar(ctx, skin, size, left + i * step, -0.07, 0.056, 0.2);
  }

  // Thumb resting on the tip side of the fist.
  ctx.save();
  ctx.translate(size * 0.19, -size * 0.045);
  ctx.rotate(-0.45);
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.075, size * 0.036, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin.fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * 0.009);
  ctx.strokeStyle = skin.edge;
  ctx.stroke();

  if (!glove) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.beginPath();
    ctx.ellipse(-size * 0.04, -size * 0.004, size * 0.016, size * 0.01, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  if (glove) {
    // Glove stitches on the back of the hand.
    ctx.strokeStyle = "rgba(120, 130, 145, 0.7)";
    ctx.lineWidth = Math.max(1, size * 0.005);
    ctx.lineCap = "round";

    for (const x of [0.27, 0.32, 0.37]) {
      ctx.beginPath();
      ctx.moveTo(x * size, 0.15 * size);
      ctx.lineTo(x * size, 0.26 * size);
      ctx.stroke();
    }
  }
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

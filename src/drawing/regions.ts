import type { ColorLayer, DrawingStroke } from "./types";

/*
 * Finds closed regions between the outlines and gives each a flat color.
 *
 * Honest limits: an outline with a gap lets the inside leak into the
 * background, and that region then stays uncolored. Colors come from the
 * original picture when it has real color; for black-and-white drawings a
 * fixed child-friendly palette is used instead (not "intelligent" coloring).
 */

const MIN_REGION_AREA = 24;
const MAX_REGIONS = 60000;
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [255, 138, 128],
  [255, 209, 102],
  [123, 223, 242],
  [143, 214, 148],
  [195, 166, 255],
  [255, 180, 162],
  [249, 192, 255],
  [178, 247, 239],
];

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return [0, 0, l];

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;

  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;

  return [(h * 60 + 360) % 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function buildColorLayer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  strokes: readonly DrawingStroke[],
): ColorLayer {
  // 1. Rasterize the outlines slightly thick so tiny gaps close.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create a canvas for color regions.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  for (const stroke of strokes) {
    stroke.points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  }

  ctx.stroke();

  const mask = ctx.getImageData(0, 0, width, height).data;
  const total = width * height;
  const ink = new Uint8Array(total);

  for (let i = 0; i < total; i++) ink[i] = mask[i * 4] < 160 ? 1 : 0;

  // 2. Connected components of paper. Components touching the border are background.
  const labels = new Uint16Array(total);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const areas: number[] = [0];
  const sums: number[] = [0, 0, 0];
  let nextLabel = 1;

  for (let start = 0; start < total; start++) {
    if (ink[start] === 1 || visited[start] === 1) continue;

    let head = 0;
    let tail = 0;
    let touchesBorder = false;

    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;

      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true;
      }

      if (x > 0) {
        const n = index - 1;
        if (ink[n] === 0 && visited[n] === 0) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
      if (x < width - 1) {
        const n = index + 1;
        if (ink[n] === 0 && visited[n] === 0) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
      if (y > 0) {
        const n = index - width;
        if (ink[n] === 0 && visited[n] === 0) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
      if (y < height - 1) {
        const n = index + width;
        if (ink[n] === 0 && visited[n] === 0) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }

    if (touchesBorder || tail < MIN_REGION_AREA || nextLabel >= MAX_REGIONS) {
      continue;
    }

    let r = 0;
    let g = 0;
    let b = 0;

    for (let i = 0; i < tail; i++) {
      const index = queue[i];
      labels[index] = nextLabel;
      r += pixels[index * 4];
      g += pixels[index * 4 + 1];
      b += pixels[index * 4 + 2];
    }

    areas.push(tail);
    sums.push(r / tail, g / tail, b / tail);
    nextLabel += 1;
  }

  const regionCount = nextLabel - 1;

  // 3. Let region colors run under the outline pixels so no paper shows between them.
  for (let pass = 0; pass < 2; pass++) {
    const previous = labels.slice();

    for (let index = 0; index < total; index++) {
      if (ink[index] === 0 || previous[index] !== 0) continue;

      const x = index % width;
      const y = (index - x) / width;
      let found = 0;

      if (x > 0 && previous[index - 1] !== 0) found = previous[index - 1];
      else if (x < width - 1 && previous[index + 1] !== 0) found = previous[index + 1];
      else if (y > 0 && previous[index - width] !== 0) found = previous[index - width];
      else if (y < height - 1 && previous[index + width] !== 0) found = previous[index + width];

      if (found !== 0) labels[index] = found;
    }
  }

  // 4. Order (big regions first) and colors.
  const order = Array.from({ length: regionCount }, (_, i) => i + 1).sort(
    (a, b) => areas[b] - areas[a] || a - b,
  );
  const ranks = new Float32Array(regionCount + 1);
  const colors = new Uint8Array((regionCount + 1) * 3);

  order.forEach((region, position) => {
    ranks[region] = regionCount > 1 ? position / (regionCount - 1) : 0;

    const [h, s, l] = rgbToHsl(
      sums[region * 3],
      sums[region * 3 + 1],
      sums[region * 3 + 2],
    );

    let rgb: readonly [number, number, number];

    if (s < 0.15) {
      rgb = PALETTE[position % PALETTE.length];
    } else {
      rgb = hslToRgb(
        h,
        Math.min(1, s * 1.15 + 0.05),
        Math.min(0.8, Math.max(0.45, l)),
      );
    }

    colors[region * 3] = rgb[0];
    colors[region * 3 + 1] = rgb[1];
    colors[region * 3 + 2] = rgb[2];
  });

  return { width, height, labels, colors, ranks, regionCount };
}

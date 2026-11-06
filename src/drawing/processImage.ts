import { polylineLength, distanceToSegment } from "./geometry";
import { mergePaths } from "./mergeStrokes";
import { buildColorLayer } from "./regions";
import type {
  DrawingStroke,
  Point,
  ProcessedImage,
  ProcessingSettings,
} from "./types";

/*
 * Local, dependency-free image analysis:
 *   grayscale → (optional lighting flatten) → contrast → (Sobel edges | dark-line threshold)
 *   → Zhang-Suen thinning → path tracing → Douglas-Peucker simplification
 *   → closed-region detection for the final color reveal.
 *
 * Limitation: this finds lines, not objects. The drawing order is a
 * deterministic heuristic (see steps.ts), not an understanding of the picture.
 */

export const MAX_PROCESS_DIMENSION = 640;
const LINE_ART_MAX_DIMENSION = 1400;
const MAX_STROKES = 1500;
const SIMPLIFY_EPSILON = 0.8;

export const defaultProcessingSettings: ProcessingSettings = {
  mode: "line-art",
  contrast: 100,
  threshold: 150,
  edgeSensitivity: 50,
  cleanup: 8,
  flatten: false,
};

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

function yieldToBrowser(): Promise<void> {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

/**
 * The drawing's own lines at high resolution: black with an alpha taken from
 * how dark each pixel is. This is what the viewer finally sees, so the picture
 * is not redrawn or approximated.
 */
function createLineArt(
  bitmap: ImageBitmap,
  settings: ProcessingSettings,
): HTMLCanvasElement {
  const scale = Math.min(
    1,
    LINE_ART_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create a canvas for the line art.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);

  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  const gray = new Float32Array(width * height);

  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  }

  if (settings.flatten) flattenLighting(gray, width, height);
  applyContrast(gray, settings.contrast);

  const limit = settings.threshold + 25;

  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const alpha = Math.min(1, Math.max(0, (limit - gray[i]) / 50));
    data[p] = 0;
    data[p + 1] = 0;
    data[p + 2] = 0;
    data[p + 3] = Math.round(alpha * 255);
  }

  ctx.putImageData(image, 0, 0);

  return canvas;
}

function binaryToCanvas(
  binary: Uint8Array,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a canvas for the line art.");

  const image = ctx.createImageData(width, height);

  for (let i = 0; i < binary.length; i++) {
    image.data[i * 4 + 3] = binary[i] === 1 ? 255 : 0;
  }

  ctx.putImageData(image, 0, 0);

  return canvas;
}

async function readImage(
  file: File,
  settings: ProcessingSettings,
): Promise<{
  gray: Float32Array;
  pixels: Uint8ClampedArray;
  lineArt: HTMLCanvasElement | null;
  width: number;
  height: number;
}> {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "This image could not be read. Try another PNG, JPG, or WebP file.",
    );
  }

  try {
    const scale = Math.min(
      1,
      MAX_PROCESS_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    if (width < 8 || height < 8) {
      throw new Error("The image is too small to analyze.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not create a canvas for image analysis.");

    // Transparent PNGs are analyzed on a white background.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);
    const gray = new Float32Array(width * height);

    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
    }

    const lineArt =
      settings.mode === "line-art" ? createLineArt(bitmap, settings) : null;

    return { gray, pixels: data, lineArt, width, height };
  } finally {
    bitmap.close();
  }
}

function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const horizontal = new Float32Array(src.length);
  const result = new Float32Array(src.length);
  const size = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;

    for (let k = -radius; k <= radius; k++) {
      sum += src[row + Math.min(width - 1, Math.max(0, k))];
    }

    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / size;
      sum +=
        src[row + Math.min(width - 1, x + radius + 1)] -
        src[row + Math.max(0, x - radius)];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;

    for (let k = -radius; k <= radius; k++) {
      sum += horizontal[Math.min(height - 1, Math.max(0, k)) * width + x];
    }

    for (let y = 0; y < height; y++) {
      result[y * width + x] = sum / size;
      sum +=
        horizontal[Math.min(height - 1, y + radius + 1) * width + x] -
        horizontal[Math.max(0, y - radius) * width + x];
    }
  }

  return result;
}

/** Divides by a heavily blurred copy so shadows and uneven paper become flat white. */
function flattenLighting(gray: Float32Array, width: number, height: number): void {
  const radius = Math.max(8, Math.round(Math.max(width, height) / 6));
  const background = boxBlur(gray, width, height, radius);

  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.min(255, (gray[i] / Math.max(1, background[i])) * 245);
  }
}

function applyContrast(gray: Float32Array, contrast: number): void {
  const factor = contrast / 100;

  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.min(255, Math.max(0, (gray[i] - 128) * factor + 128));
  }
}

function blur3(
  gray: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const horizontal = new Float32Array(gray.length);
  const result = new Float32Array(gray.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = gray[y * width + Math.max(0, x - 1)];
      const mid = gray[y * width + x];
      const right = gray[y * width + Math.min(width - 1, x + 1)];
      horizontal[y * width + x] = (left + 2 * mid + right) / 4;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const up = horizontal[Math.max(0, y - 1) * width + x];
      const mid = horizontal[y * width + x];
      const down = horizontal[Math.min(height - 1, y + 1) * width + x];
      result[y * width + x] = (up + 2 * mid + down) / 4;
    }
  }

  return result;
}

function detectEdges(
  gray: Float32Array,
  width: number,
  height: number,
  sensitivity: number,
): Uint8Array {
  const blurred = blur3(gray, width, height);
  // Sensitivity 0 → 260 (only very strong edges), 100 → 20 (faint edges too).
  const threshold = 260 - sensitivity * 2.4;
  const out = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const a = blurred[i - width - 1];
      const b = blurred[i - width];
      const c = blurred[i - width + 1];
      const d = blurred[i - 1];
      const f = blurred[i + 1];
      const g = blurred[i + width - 1];
      const h = blurred[i + width];
      const k = blurred[i + width + 1];

      const gx = -a - 2 * d - g + c + 2 * f + k;
      const gy = -a - 2 * b - c + g + 2 * h + k;

      out[i] = Math.hypot(gx, gy) > threshold ? 1 : 0;
    }
  }

  return out;
}

function detectDarkLines(
  gray: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  const out = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      out[i] = gray[i] < threshold ? 1 : 0;
    }
  }

  return out;
}

/** Zhang-Suen thinning: reduces thick lines to one-pixel-wide skeletons. */
function thin(binary: Uint8Array, width: number, height: number): Uint8Array {
  const img = new Uint8Array(binary);
  const toClear: number[] = [];
  let changed = true;
  let guard = 0;

  while (changed && guard < 200) {
    changed = false;
    guard += 1;

    for (let pass = 0; pass < 2; pass++) {
      toClear.length = 0;

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;
          if (img[i] === 0) continue;

          const p2 = img[i - width];
          const p3 = img[i - width + 1];
          const p4 = img[i + 1];
          const p5 = img[i + width + 1];
          const p6 = img[i + width];
          const p7 = img[i + width - 1];
          const p8 = img[i - 1];
          const p9 = img[i - width - 1];

          const neighbors = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (neighbors < 2 || neighbors > 6) continue;

          const transitions =
            (p2 === 0 && p3 === 1 ? 1 : 0) +
            (p3 === 0 && p4 === 1 ? 1 : 0) +
            (p4 === 0 && p5 === 1 ? 1 : 0) +
            (p5 === 0 && p6 === 1 ? 1 : 0) +
            (p6 === 0 && p7 === 1 ? 1 : 0) +
            (p7 === 0 && p8 === 1 ? 1 : 0) +
            (p8 === 0 && p9 === 1 ? 1 : 0) +
            (p9 === 0 && p2 === 1 ? 1 : 0);
          if (transitions !== 1) continue;

          if (pass === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) {
            continue;
          }

          toClear.push(i);
        }
      }

      if (toClear.length > 0) {
        changed = true;
        for (const index of toClear) img[index] = 0;
      }
    }
  }

  return img;
}

function tracePaths(
  skeleton: Uint8Array,
  width: number,
  height: number,
): Point[][] {
  const visited = new Uint8Array(width * height);
  const paths: Point[][] = [];

  const neighborIndex = (x: number, y: number, offset: number): number => {
    const [dx, dy] = NEIGHBOR_OFFSETS[offset];
    const nx = x + dx;
    const ny = y + dy;

    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return -1;
    return ny * width + nx;
  };

  const degree = (index: number): number => {
    const x = index % width;
    const y = Math.floor(index / width);
    let count = 0;

    for (let offset = 0; offset < NEIGHBOR_OFFSETS.length; offset++) {
      const n = neighborIndex(x, y, offset);
      if (n >= 0 && skeleton[n] === 1) count += 1;
    }

    return count;
  };

  const nextUnvisited = (index: number): number => {
    const x = index % width;
    const y = Math.floor(index / width);

    for (let offset = 0; offset < NEIGHBOR_OFFSETS.length; offset++) {
      const n = neighborIndex(x, y, offset);
      if (n >= 0 && skeleton[n] === 1 && visited[n] === 0) return n;
    }

    return -1;
  };

  const visitedNeighbor = (index: number): number => {
    const x = index % width;
    const y = Math.floor(index / width);

    for (let offset = 0; offset < NEIGHBOR_OFFSETS.length; offset++) {
      const n = neighborIndex(x, y, offset);
      if (n >= 0 && skeleton[n] === 1 && visited[n] === 1) return n;
    }

    return -1;
  };

  const toPoint = (index: number): Point => [index % width, Math.floor(index / width)];

  const walk = (start: number, prefix: number): void => {
    const path: Point[] = [];
    if (prefix >= 0) path.push(toPoint(prefix));

    let current = start;
    while (current >= 0) {
      visited[current] = 1;
      path.push(toPoint(current));
      current = nextUnvisited(current);
    }

    if (path.length >= 2) paths.push(path);
  };

  // Open lines first (start at their ends), then whatever is left (loops, branches).
  for (let i = 0; i < skeleton.length; i++) {
    if (skeleton[i] === 1 && visited[i] === 0 && degree(i) === 1) walk(i, -1);
  }

  for (let i = 0; i < skeleton.length; i++) {
    if (skeleton[i] === 1 && visited[i] === 0) walk(i, visitedNeighbor(i));
  }

  return paths;
}

/** Douglas-Peucker, iterative so long paths cannot overflow the call stack. */
function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<readonly [number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;

    const [from, to] = range;
    let maxDistance = 0;
    let maxIndex = -1;

    for (let i = from + 1; i < to; i++) {
      const distance = distanceToSegment(points[i], points[from], points[to]);

      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }

    if (maxIndex !== -1 && maxDistance > epsilon) {
      keep[maxIndex] = 1;
      stack.push([from, maxIndex], [maxIndex, to]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

export async function processImage(
  file: File,
  settings: ProcessingSettings,
): Promise<ProcessedImage> {
  const { gray, pixels, lineArt: highResLineArt, width, height } =
    await readImage(file, settings);
  await yieldToBrowser();

  if (settings.flatten) flattenLighting(gray, width, height);
  applyContrast(gray, settings.contrast);

  const binary =
    settings.mode === "line-art"
      ? detectDarkLines(gray, width, height, settings.threshold)
      : detectEdges(gray, width, height, settings.edgeSensitivity);
  await yieldToBrowser();

  const skeleton = thin(binary, width, height);
  await yieldToBrowser();

  const minLength = Math.max(2, settings.cleanup);
  let inkPixels = 0;
  let skeletonPixels = 0;

  for (let i = 0; i < binary.length; i++) {
    inkPixels += binary[i];
    skeletonPixels += skeleton[i];
  }

  // Average line width, used to size the area the pencil uncovers around its path.
  const lineWidth = skeletonPixels > 0 ? inkPixels / skeletonPixels : 2;
  const maskWidth = Math.min(14, Math.max(2.5, lineWidth * 1.6 + 1.5));

  const candidates = mergePaths(tracePaths(skeleton, width, height))
    .map((path) => simplify(path, SIMPLIFY_EPSILON))
    .map((points) => ({ points, length: polylineLength(points) }))
    .filter((stroke) => stroke.length >= minLength)
    // Longest first; Array.prototype.sort is stable, so ties keep scan order.
    .sort((a, b) => b.length - a.length);

  const truncated = candidates.length > MAX_STROKES;
  const strokes: DrawingStroke[] = candidates
    .slice(0, MAX_STROKES)
    .map((stroke, index) => ({ id: index, ...stroke }));
  await yieldToBrowser();

  const colorLayer = buildColorLayer(pixels, width, height, strokes);

  return {
    width,
    height,
    binary,
    drawing: { width, height, strokes },
    colorLayer,
    lineArt: highResLineArt ?? binaryToCanvas(binary, width, height),
    maskWidth,
    truncated,
  };
}

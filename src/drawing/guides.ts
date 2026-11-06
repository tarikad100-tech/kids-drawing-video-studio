import type { DrawingData, Point } from "./types";

/*
 * Construction (guide) lines, like the light shapes a person sketches first:
 * a center cross and a loose oval around the main shape, plus ovals around the
 * other big parts. They are drawn by the pencil before the real lines and
 * erased at the end. They are only guides: they never appear in the final picture.
 */

type Box = { x0: number; y0: number; x1: number; y1: number };

const CLUSTER_PAD = 8;
const MAX_CLUSTER_STROKES = 700;
const ELLIPSE_POINTS = 72;

function area(box: Box): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

function touches(a: Box, b: Box): boolean {
  return (
    a.x0 - CLUSTER_PAD <= b.x1 &&
    b.x0 - CLUSTER_PAD <= a.x1 &&
    a.y0 - CLUSTER_PAD <= b.y1 &&
    b.y0 - CLUSTER_PAD <= a.y1
  );
}

function ellipse(box: Box, grow: number): Point[] {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const rx = ((box.x1 - box.x0) / 2) * grow;
  const ry = ((box.y1 - box.y0) / 2) * grow;
  const out: Point[] = [];

  for (let i = 0; i <= ELLIPSE_POINTS; i++) {
    const angle = -Math.PI / 2 + (i / ELLIPSE_POINTS) * Math.PI * 2;
    out.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }

  return out;
}

function boxOf(drawing: DrawingData, hidden: ReadonlySet<number>): Box[] {
  const boxes: Box[] = [];

  for (const stroke of drawing.strokes) {
    if (hidden.has(stroke.id) || stroke.points.length === 0) continue;

    const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

    for (const [x, y] of stroke.points) {
      if (x < box.x0) box.x0 = x;
      if (y < box.y0) box.y0 = y;
      if (x > box.x1) box.x1 = x;
      if (y > box.y1) box.y1 = y;
    }

    boxes.push(box);
  }

  return boxes;
}

/** Groups strokes whose bounding boxes touch, so each group is one "part". */
function cluster(boxes: readonly Box[]): Box[] {
  const parent = boxes.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];

    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }

    return root;
  };

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (touches(boxes[i], boxes[j])) parent[find(i)] = find(j);
    }
  }

  const merged = new Map<number, Box>();

  boxes.forEach((box, index) => {
    const root = find(index);
    const current = merged.get(root);

    merged.set(
      root,
      current
        ? {
            x0: Math.min(current.x0, box.x0),
            y0: Math.min(current.y0, box.y0),
            x1: Math.max(current.x1, box.x1),
            y1: Math.max(current.y1, box.y1),
          }
        : { ...box },
    );
  });

  return [...merged.values()];
}

/** Guide paths, in drawing coordinates, in the order they are drawn. */
export function buildGuides(
  drawing: DrawingData | null,
  hidden: ReadonlySet<number>,
): Point[][] {
  if (!drawing) return [];

  const boxes = boxOf(drawing, hidden);
  if (boxes.length === 0) return [];

  const whole: Box = boxes.reduce((sum, box) => ({
    x0: Math.min(sum.x0, box.x0),
    y0: Math.min(sum.y0, box.y0),
    x1: Math.max(sum.x1, box.x1),
    y1: Math.max(sum.y1, box.y1),
  }));

  if (area(whole) < 400) return [];

  const parts =
    boxes.length <= MAX_CLUSTER_STROKES
      ? cluster(boxes).sort((a, b) => area(b) - area(a))
      : [whole];
  const main = parts[0];
  const cx = (main.x0 + main.x1) / 2;
  const cy = (main.y0 + main.y1) / 2;
  const padX = (main.x1 - main.x0) * 0.06;
  const padY = (main.y1 - main.y0) * 0.06;

  const guides: Point[][] = [
    [
      [cx, main.y0 - padY],
      [cx, main.y1 + padY],
    ],
    [
      [main.x0 - padX, cy],
      [main.x1 + padX, cy],
    ],
    ellipse(main, 1.08),
  ];

  const others = parts
    .slice(1)
    .filter((box) => area(box) >= area(whole) * 0.04)
    .slice(0, 3)
    .sort((a, b) => a.y0 - b.y0);

  for (const box of others) guides.push(ellipse(box, 1.1));

  return guides;
}

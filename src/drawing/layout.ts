import type { DrawingData, DrawingStroke, Point } from "./types";

/*
 * Drawing order "like a person": the picture is split into parts (for example
 * the mother, the girl, the writing). Parts are drawn one after another, and
 * the pen never leaves a part until it is finished, so nothing jumps around.
 *
 * - The writing is found automatically (a row of big shapes near the top or
 *   bottom). It is drawn letter by letter: right to left for Arabic, left to
 *   right for Latin letters.
 * - Other parts are boxes the person drags on the picture. A stroke belongs to
 *   the smallest box that holds most of it, so a small box (the girl) can sit
 *   inside a big one (the mother).
 * - Everything else is the "rest" part.
 */

export type WritingDirection = "rtl" | "ltr";

/** x0, y0, x1, y1 as fractions (0..1) of the picture. */
export type PartRect = readonly [number, number, number, number];

export type PartKind = "text" | "rect" | "rest";

export type PartDef = {
  id: number;
  name: string;
  kind: PartKind;
  rect?: PartRect;
};

export type LayoutPlan = {
  direction: WritingDirection;
  parts: PartDef[];
};

export const MAX_PARTS = 10;

export const DEFAULT_LAYOUT: LayoutPlan = {
  direction: "rtl",
  parts: [
    { id: 1, name: "Drawing", kind: "rest" },
    { id: 2, name: "Writing", kind: "text" },
  ],
};

export type OrderedPart = { part: PartDef; strokes: DrawingStroke[] };

type Cluster = {
  ids: number[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  length: number;
};

// ---------------------------------------------------------------- geometry

function densify(points: readonly Point[], step: number): Point[] {
  const out: Point[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));

    for (let k = 0; k < count; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / count, a[1] + ((b[1] - a[1]) * k) / count]);
    }
  }

  if (points.length > 0) out.push(points[points.length - 1]);

  return out;
}

function bounds(stroke: DrawingStroke) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  for (const [x, y] of stroke.points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }

  return { x0, y0, x1, y1 };
}

/** Groups strokes whose lines come within `gap` pixels of each other. */
function clusterStrokes(strokes: readonly DrawingStroke[], gap: number): Cluster[] {
  const parent = strokes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const grid = new Map<string, Array<[number, number, number]>>();

  strokes.forEach((stroke, index) => {
    for (const [x, y] of densify(stroke.points, Math.max(1, gap / 2))) {
      const cx = Math.floor(x / gap);
      const cy = Math.floor(y / gap);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${cx + dx},${cy + dy}`);
          if (!bucket) continue;

          for (const [other, px, py] of bucket) {
            if (other !== index && Math.hypot(px - x, py - y) <= gap) {
              parent[find(index)] = find(other);
            }
          }
        }
      }

      const key = `${cx},${cy}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push([index, x, y]);
      else grid.set(key, [[index, x, y]]);
    }
  });

  const groups = new Map<number, Cluster>();

  strokes.forEach((stroke, index) => {
    const root = find(index);
    const b = bounds(stroke);
    const existing = groups.get(root);

    if (!existing) {
      groups.set(root, { ids: [stroke.id], ...b, length: stroke.length });
    } else {
      existing.ids.push(stroke.id);
      existing.x0 = Math.min(existing.x0, b.x0);
      existing.y0 = Math.min(existing.y0, b.y0);
      existing.x1 = Math.max(existing.x1, b.x1);
      existing.y1 = Math.max(existing.y1, b.y1);
      existing.length += stroke.length;
    }
  });

  return [...groups.values()];
}

const clusterW = (c: Cluster) => c.x1 - c.x0;
const clusterH = (c: Cluster) => c.y1 - c.y0;
const centerX = (c: Cluster) => (c.x0 + c.x1) / 2;
const centerY = (c: Cluster) => (c.y0 + c.y1) / 2;

// ---------------------------------------------------------------- stroke order

/** Continuous pen path: always continue with the nearest end; long strokes first. */
function traceOrder(strokes: readonly DrawingStroke[], start: Point | null): DrawingStroke[] {
  const remaining = [...strokes];
  const ordered: DrawingStroke[] = [];
  let pen = start;

  if (remaining.length === 0) return ordered;

  if (pen === null) {
    let index = 0;
    let best = Infinity;

    remaining.forEach((stroke, i) => {
      for (const p of [stroke.points[0], stroke.points[stroke.points.length - 1]]) {
        const score = p[1] * 10000 + p[0];
        if (score < best) {
          best = score;
          index = i;
        }
      }
    });

    const [first] = remaining.splice(index, 1);
    ordered.push(first);
    pen = first.points[first.points.length - 1];
  }

  while (remaining.length > 0) {
    let index = 0;
    let best = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const { points, length } = remaining[i];
      const head = points[0];
      const tail = points[points.length - 1];
      const distance = Math.min(
        Math.hypot(head[0] - pen[0], head[1] - pen[1]),
        Math.hypot(tail[0] - pen[0], tail[1] - pen[1]),
      );
      const cost = distance * (1 + 8 / (length + 10));

      if (cost < best) {
        best = cost;
        index = i;
      }
    }

    const [next] = remaining.splice(index, 1);
    const head = next.points[0];
    const tail = next.points[next.points.length - 1];
    ordered.push(next);
    pen =
      Math.hypot(head[0] - pen[0], head[1] - pen[1]) <= Math.hypot(tail[0] - pen[0], tail[1] - pen[1])
        ? tail
        : head;
  }

  return ordered;
}

/** Big structure first (55% of the line length), then medium parts, then small details. */
function outlineFirst(strokes: readonly DrawingStroke[], start: Point | null): DrawingStroke[] {
  if (strokes.length === 0) return [];

  const total = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
  const tiers: DrawingStroke[][] = [[], [], []];
  let running = 0;

  for (const stroke of [...strokes].sort((a, b) => b.length - a.length)) {
    tiers[running < total * 0.55 ? 0 : running < total * 0.85 ? 1 : 2].push(stroke);
    running += stroke.length;
  }

  const ordered: DrawingStroke[] = [];
  let pen = start;

  for (const tier of tiers) {
    const part = traceOrder(tier, pen);
    ordered.push(...part);

    if (part.length > 0) {
      const last = part[part.length - 1];
      pen = last.points[last.points.length - 1];
    }
  }

  return ordered;
}

// ---------------------------------------------------------------- writing

/**
 * Finds the writing: rows of clusters that sit near the top or bottom, are
 * spread across the picture, and contain several big letter-sized shapes.
 */
export function detectText(drawing: DrawingData): Set<number> {
  const { width: W, height: H, strokes } = drawing;
  const found = new Set<number>();
  if (strokes.length < 3) return found;

  const clusters = clusterStrokes(strokes, Math.max(5, W * 0.012)).filter(
    (c) => clusterH(c) <= H * 0.45 && clusterW(c) <= W * 0.6,
  );
  const sorted = [...clusters].sort((a, b) => centerY(a) - centerY(b));
  const rows: Array<{ items: Cluster[]; y0: number; y1: number }> = [];

  for (const cluster of sorted) {
    const row = rows.find((r) => {
      const overlap = Math.min(r.y1, cluster.y1) - Math.max(r.y0, cluster.y0);
      return overlap >= 0.35 * Math.min(r.y1 - r.y0, clusterH(cluster));
    });

    if (row) {
      row.items.push(cluster);
      row.y0 = Math.min(row.y0, cluster.y0);
      row.y1 = Math.max(row.y1, cluster.y1);
    } else {
      rows.push({ items: [cluster], y0: cluster.y0, y1: cluster.y1 });
    }
  }

  for (const row of rows) {
    const xs0 = Math.min(...row.items.map((c) => c.x0));
    const xs1 = Math.max(...row.items.map((c) => c.x1));
    const tall = row.items.filter((c) => clusterH(c) >= H * 0.1).length;
    const middle = (row.y0 + row.y1) / 2;
    const placed = middle <= H * 0.45 || middle >= H * 0.72;

    if (row.items.length >= 3 && tall >= 2 && xs1 - xs0 >= W * 0.35 && placed) {
      // Letter-sized shapes are writing; smaller ones only if they sit inside a letter (dots, hamza).
      const letters = row.items.filter((c) => clusterH(c) >= H * 0.07);

      for (const cluster of row.items) {
        const isLetter = clusterH(cluster) >= H * 0.07;
        const inside = letters.some((l) => {
          const padX = clusterW(l) * 0.04;
          const padY = clusterH(l) * 0.04;
          return centerX(cluster) >= l.x0 - padX && centerX(cluster) <= l.x1 + padX && centerY(cluster) >= l.y0 - padY && centerY(cluster) <= l.y1 + padY;
        });

        if (isLetter || inside) for (const id of cluster.ids) found.add(id);
      }
    }
  }

  return found;
}

/** Letter by letter, row by row; direction decides which end of a row comes first. */
function orderText(strokes: readonly DrawingStroke[], drawing: DrawingData, direction: WritingDirection): DrawingStroke[] {
  if (strokes.length === 0) return [];

  const byId = new Map(strokes.map((s) => [s.id, s]));
  let glyphs = clusterStrokes(strokes, Math.max(5, drawing.width * 0.012));

  // Small shapes sitting inside another letter's box (dots, hamza) belong to that letter.
  glyphs.sort((a, b) => b.length - a.length);
  const merged: Cluster[] = [];

  for (const glyph of glyphs) {
    const host = merged.find(
      (m) =>
        centerX(glyph) >= m.x0 &&
        centerX(glyph) <= m.x1 &&
        centerY(glyph) >= m.y0 - clusterH(m) * 0.35 &&
        centerY(glyph) <= m.y1 + clusterH(m) * 0.35 &&
        glyph.length < m.length * 0.6,
    );

    if (host) {
      host.ids.push(...glyph.ids);
      host.x0 = Math.min(host.x0, glyph.x0);
      host.y0 = Math.min(host.y0, glyph.y0);
      host.x1 = Math.max(host.x1, glyph.x1);
      host.y1 = Math.max(host.y1, glyph.y1);
      host.length += glyph.length;
    } else {
      merged.push({ ...glyph, ids: [...glyph.ids] });
    }
  }

  glyphs = merged;

  const rows: Array<{ items: Cluster[]; y0: number; y1: number }> = [];

  for (const glyph of [...glyphs].sort((a, b) => centerY(a) - centerY(b))) {
    const row = rows.find((r) => {
      const overlap = Math.min(r.y1, glyph.y1) - Math.max(r.y0, glyph.y0);
      return overlap >= 0.3 * Math.min(r.y1 - r.y0, clusterH(glyph));
    });

    if (row) {
      row.items.push(glyph);
      row.y0 = Math.min(row.y0, glyph.y0);
      row.y1 = Math.max(row.y1, glyph.y1);
    } else {
      rows.push({ items: [glyph], y0: glyph.y0, y1: glyph.y1 });
    }
  }

  rows.sort((a, b) => a.y0 - b.y0);

  const ordered: DrawingStroke[] = [];

  for (const row of rows) {
    row.items.sort((a, b) => (direction === "rtl" ? centerX(b) - centerX(a) : centerX(a) - centerX(b)));

    for (const glyph of row.items) {
      const pieces = glyph.ids.map((id) => byId.get(id)).filter((s): s is DrawingStroke => s !== undefined);
      const start: Point = direction === "rtl" ? [glyph.x1, glyph.y0] : [glyph.x0, glyph.y0];
      ordered.push(...outlineFirst(pieces, start));
    }
  }

  return ordered;
}

// ---------------------------------------------------------------- parts

function share(stroke: DrawingStroke, rect: PartRect, drawing: DrawingData): number {
  const x0 = rect[0] * drawing.width;
  const y0 = rect[1] * drawing.height;
  const x1 = rect[2] * drawing.width;
  const y1 = rect[3] * drawing.height;
  const samples = densify(stroke.points, 3);
  let inside = 0;

  for (const [x, y] of samples) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) inside += 1;

  return samples.length > 0 ? inside / samples.length : 0;
}

function area(rect: PartRect): number {
  return Math.max(0, rect[2] - rect[0]) * Math.max(0, rect[3] - rect[1]);
}

/** Decorations and scenery: finish each connected piece before moving to the next. */
function orderRest(strokes: readonly DrawingStroke[], drawing: DrawingData, start: Point | null): DrawingStroke[] {
  if (strokes.length === 0) return [];

  const byId = new Map(strokes.map((s) => [s.id, s]));
  const clusters = clusterStrokes(strokes, Math.max(3, drawing.width * 0.006)).sort((a, b) => b.length - a.length);
  const left = [...clusters];
  const ordered: DrawingStroke[] = [];
  let pen = start;

  while (left.length > 0) {
    let index = 0;

    if (ordered.length > 0 && pen) {
      // After the biggest piece, go to the nearest one so the pen travels little.
      const here = pen;
      let best = Infinity;
      left.forEach((c, i) => {
        const score = Math.hypot(centerX(c) - here[0], centerY(c) - here[1]) / (1 + Math.sqrt(c.length) / 12);
        if (score < best) {
          best = score;
          index = i;
        }
      });
    }

    const [cluster] = left.splice(index, 1);
    const pieces = cluster.ids.map((id) => byId.get(id)).filter((s): s is DrawingStroke => s !== undefined);
    const part = outlineFirst(pieces, pen);
    ordered.push(...part);

    if (part.length > 0) {
      const last = part[part.length - 1];
      pen = last.points[last.points.length - 1];
    }
  }

  return ordered;
}

export function normalizeLayout(plan: LayoutPlan): LayoutPlan {
  const parts = plan.parts.slice(0, MAX_PARTS);

  if (!parts.some((p) => p.kind === "rest")) parts.push({ id: Math.max(0, ...parts.map((p) => p.id)) + 1, name: "Drawing", kind: "rest" });

  return { direction: plan.direction, parts };
}

/** Strokes grouped by part, in drawing order. Parts with no strokes are left out. */
export function orderByParts(drawing: DrawingData, input: LayoutPlan): OrderedPart[] {
  const plan = normalizeLayout(input);
  const textPart = plan.parts.find((p) => p.kind === "text");
  const textIds = textPart ? detectText(drawing) : new Set<number>();
  const rects = plan.parts.filter((p) => p.kind === "rect" && p.rect);
  const bucket = new Map<number, DrawingStroke[]>(plan.parts.map((p) => [p.id, []]));
  const restPart = plan.parts.find((p) => p.kind === "rest") ?? plan.parts[plan.parts.length - 1];

  for (const stroke of drawing.strokes) {
    if (textPart && textIds.has(stroke.id)) {
      bucket.get(textPart.id)?.push(stroke);
      continue;
    }

    let owner: PartDef | null = null;
    let ownerArea = Infinity;

    for (const part of rects) {
      if (!part.rect) continue;
      const size = area(part.rect);

      if (size < ownerArea && share(stroke, part.rect, drawing) >= 0.5) {
        owner = part;
        ownerArea = size;
      }
    }

    bucket.get((owner ?? restPart).id)?.push(stroke);
  }

  const result: OrderedPart[] = [];
  let pen: Point | null = null;

  for (const part of plan.parts) {
    const strokes = bucket.get(part.id) ?? [];
    if (strokes.length === 0) continue;

    const ordered =
      part.kind === "text"
        ? orderText(strokes, drawing, plan.direction)
        : part.kind === "rest"
          ? orderRest(strokes, drawing, pen)
          : outlineFirst(strokes, pen);

    result.push({ part, strokes: ordered });
    const last = ordered[ordered.length - 1];
    pen = last.points[last.points.length - 1];
  }

  return result;
}

/** How many stages each part gets: at least one, the rest by line length. */
export function allocateStages(lengths: readonly number[], count: number): number[] {
  const parts = lengths.length;
  if (parts === 0) return [];

  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const stages = lengths.map(() => 1);
  let spare = Math.max(0, count - parts);

  while (spare > 0) {
    // Give the next stage to the part whose stages are the longest.
    let best = 0;
    let bestLoad = -1;

    lengths.forEach((length, i) => {
      const load = length / total / stages[i];
      if (load > bestLoad) {
        bestLoad = load;
        best = i;
      }
    });

    stages[best] += 1;
    spare -= 1;
  }

  return stages;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Reads a saved plan; anything odd falls back to the default plan. */
export function parseLayout(value: unknown): LayoutPlan {
  if (!isRecord(value) || !Array.isArray(value.parts)) return DEFAULT_LAYOUT;

  const parts: PartDef[] = [];
  const seen = new Set<number>();

  for (const item of value.parts.slice(0, MAX_PARTS)) {
    if (!isRecord(item)) continue;

    const id = typeof item.id === "number" && Number.isInteger(item.id) && item.id > 0 ? item.id : 0;
    const kind = item.kind === "text" || item.kind === "rest" || item.kind === "rect" ? item.kind : null;
    if (id === 0 || kind === null || seen.has(id)) continue;

    const name = typeof item.name === "string" ? item.name.slice(0, 30) : "Part";
    const raw = item.rect;
    const rect =
      Array.isArray(raw) && raw.length === 4 && raw.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)
        ? ([raw[0], raw[1], raw[2], raw[3]] as PartRect)
        : undefined;

    if (kind === "rect" && !rect) continue;

    seen.add(id);
    parts.push(rect && kind === "rect" ? { id, name, kind, rect } : { id, name, kind });
  }

  return parts.length === 0 ? DEFAULT_LAYOUT : normalizeLayout({ direction: value.direction === "ltr" ? "ltr" : "rtl", parts });
}

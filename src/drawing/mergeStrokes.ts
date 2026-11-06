import type { Point } from "./types";

/*
 * Thinning and tracing cut long lines into many short pieces. This joins
 * pieces whose ends touch and continue in the same direction, so the pencil
 * draws long, natural lines instead of fragments.
 */

const MAX_GAP = 3.5;
const MIN_COS = Math.cos(Math.PI * 0.4);
const CELL = 6;
const DIRECTION_SPAN = 5;

type End = { stroke: number; atStart: boolean; x: number; y: number };

function cellKey(x: number, y: number): number {
  return Math.floor(x / CELL) * 65536 + Math.floor(y / CELL);
}

/** Unit direction leaving the path at its start (atStart) or its end. */
function outward(path: readonly Point[], atStart: boolean): [number, number] {
  const span = Math.min(DIRECTION_SPAN, path.length - 1);
  const tip = atStart ? path[0] : path[path.length - 1];
  const inner = atStart ? path[span] : path[path.length - 1 - span];
  const dx = tip[0] - inner[0];
  const dy = tip[1] - inner[1];
  const length = Math.hypot(dx, dy);

  return length > 0 ? [dx / length, dy / length] : [0, 0];
}

export function mergePaths(paths: Point[][]): Point[][] {
  const alive: Array<Point[] | null> = paths.map((path) => path);
  const grid = new Map<number, End[]>();

  const register = (index: number) => {
    const path = alive[index];
    if (!path) return;

    for (const atStart of [true, false]) {
      const point = atStart ? path[0] : path[path.length - 1];
      const key = cellKey(point[0], point[1]);
      const list = grid.get(key);
      const end: End = { stroke: index, atStart, x: point[0], y: point[1] };

      if (list) list.push(end);
      else grid.set(key, [end]);
    }
  };

  for (let i = 0; i < alive.length; i++) register(i);

  // Best piece that continues `path` from its end, or null.
  const findMate = (path: readonly Point[]): End | null => {
    const tail = path[path.length - 1];
    const direction = outward(path, false);
    const cx = Math.floor(tail[0] / CELL);
    const cy = Math.floor(tail[1] / CELL);
    let best: End | null = null;
    let bestCost = Infinity;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get((cx + dx) * 65536 + (cy + dy));
        if (!list) continue;

        for (const end of list) {
          const other = alive[end.stroke];
          if (!other || other.length < 2) continue;

          const point = end.atStart ? other[0] : other[other.length - 1];
          // Stale entry: this piece was merged or its end moved.
          if (point[0] !== end.x || point[1] !== end.y) continue;

          const gap = Math.hypot(point[0] - tail[0], point[1] - tail[1]);
          if (gap > MAX_GAP) continue;

          const away = outward(other, end.atStart);
          const cos = -(direction[0] * away[0] + direction[1] * away[1]);
          if (cos < MIN_COS) continue;

          const cost = gap + (1 - cos) * 6;

          if (cost < bestCost) {
            bestCost = cost;
            best = end;
          }
        }
      }
    }

    return best;
  };

  for (let i = 0; i < alive.length; i++) {
    const first = alive[i];
    if (!first) continue;

    let current: Point[] = first;
    alive[i] = null;

    // Grow from the tail, flip, grow from the (old) head, flip back.
    for (let pass = 0; pass < 2; pass++) {
      while (true) {
        const mate = findMate(current);
        if (!mate) break;

        const other = alive[mate.stroke];
        if (!other) break;

        alive[mate.stroke] = null;
        const oriented = mate.atStart ? other : [...other].reverse();
        current = current.concat(oriented);
      }

      current = [...current].reverse();
    }

    alive[i] = current;
    register(i);
  }

  return alive.filter((path): path is Point[] => path !== null);
}

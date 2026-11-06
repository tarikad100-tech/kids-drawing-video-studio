import type { DrawingStroke, Point } from "./types";

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared,
    ),
  );

  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

export function polylineLength(points: readonly Point[]): number {
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
  }

  return total;
}

/** Chaikin corner cutting. Keeps both end points, so strokes still start and end where they should. */
export function smoothPolyline(points: readonly Point[], iterations: number): Point[] {
  let current: Point[] = [...points];

  for (let iteration = 0; iteration < iterations; iteration++) {
    if (current.length < 3) break;

    const next: Point[] = [current[0]];

    for (let i = 0; i < current.length - 1; i++) {
      const [x0, y0] = current[i];
      const [x1, y1] = current[i + 1];

      next.push(
        [0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1],
        [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1],
      );
    }

    next.push(current[current.length - 1]);
    current = next;
  }

  return current;
}

/** Id of the stroke closest to (x, y) within `maxDistance`, or -1. */
export function nearestStroke(
  strokes: readonly DrawingStroke[],
  x: number,
  y: number,
  maxDistance: number,
): number {
  const target: Point = [x, y];
  let bestId = -1;
  let bestDistance = maxDistance;

  for (const stroke of strokes) {
    for (let i = 1; i < stroke.points.length; i++) {
      const distance = distanceToSegment(
        target,
        stroke.points[i - 1],
        stroke.points[i],
      );

      if (distance <= bestDistance) {
        bestDistance = distance;
        bestId = stroke.id;
      }
    }
  }

  return bestId;
}

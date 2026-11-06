import type { DrawingData, DrawingStep, DrawingStroke, Point } from "./types";

export const MIN_STEPS = 5;
export const MAX_STEPS = 15;

export type StepText = { title: string; description: string; weight?: number };

export const MIN_WEIGHT = 0.5;
export const MAX_WEIGHT = 3;

const stepTemplates: ReadonlyArray<readonly [string, string]> = [
  ["Basic shapes", "Draw the big simple shapes first, with light guide lines."],
  ["Main parts", "Add the large parts that join the basic shapes together."],
  ["Limbs and extras", "Add the side parts, such as the tail, arms, legs or feet."],
  ["Face and fine details", "Draw the small details, such as eyes, patterns and stripes."],
  ["Define the drawing", "Go over the final lines so the whole drawing looks clean."],
  ["Check the proportions", "Check that the different parts look balanced."],
  ["Add more details", "Add a few extra details to make your drawing special."],
  ["Refine the shapes", "Smooth any lines that still look rough."],
  ["Add the finishing touches", "Check the small details and complete the outline."],
  ["Review your drawing", "Look over your drawing and make any final adjustments."],
  ["Polish the shape", "Make sure all the lines are clean and easy to follow."],
  ["Finish the outline", "Complete any remaining lines in your drawing."],
  ["Final check", "Make sure nothing is missing before the colors appear."],
  ["Almost done", "Get ready for the colors."],
  ["Your drawing is complete!", "Celebrate your work and get ready to share it!"],
];

export function templateText(index: number): StepText {
  const [title, description] =
    stepTemplates[Math.min(Math.max(0, index), stepTemplates.length - 1)];

  return { title, description };
}

function nextStepId(steps: readonly DrawingStep[]): number {
  return Math.max(0, ...steps.map((step) => step.id)) + 1;
}

/**
 * One continuous drawing path, like a person tracing the picture: start at the
 * top, then always continue with the stroke whose end is closest to the pen.
 * Tiny strokes are penalized, so long lines are drawn first and small details
 * are drawn when the pen passes near them. Deterministic, and it does not know
 * what the picture shows.
 */
function traceOrder(
  strokes: readonly DrawingStroke[],
  startPen: Point | null,
): DrawingStroke[] {
  if (strokes.length === 0) return [];

  const remaining = [...strokes];
  const ordered: DrawingStroke[] = [];
  let pen: Point | null = startPen;

  if (pen === null) {
    // First stroke of the whole drawing: the one that starts highest.
    let startIndex = 0;
    let topScore = Infinity;

    remaining.forEach((stroke, index) => {
      for (const point of [stroke.points[0], stroke.points[stroke.points.length - 1]]) {
        const score = point[1] * 10000 + point[0];

        if (score < topScore) {
          topScore = score;
          startIndex = index;
        }
      }
    });

    const [first] = remaining.splice(startIndex, 1);
    ordered.push(first);
    pen = first.points[first.points.length - 1];
  }

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestCost = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const { points, length } = remaining[i];
      const head = points[0];
      const tail = points[points.length - 1];
      const distance = Math.min(
        Math.hypot(head[0] - pen[0], head[1] - pen[1]),
        Math.hypot(tail[0] - pen[0], tail[1] - pen[1]),
      );
      const cost = distance * (1 + 8 / (length + 10));

      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = i;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    const head = next.points[0];
    const tail = next.points[next.points.length - 1];

    ordered.push(next);
    pen =
      Math.hypot(head[0] - pen[0], head[1] - pen[1]) <=
      Math.hypot(tail[0] - pen[0], tail[1] - pen[1])
        ? tail
        : head;
  }

  return ordered;
}

/**
 * Like a person drawing: first the big structure (the longest lines that make up
 * about 55% of all the line length), then the medium parts (up to 85%), and the
 * small details last. Inside each level the pen keeps moving continuously.
 */
function orderStrokes(strokes: readonly DrawingStroke[]): DrawingStroke[] {
  if (strokes.length === 0) return [];

  const total = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
  const byLength = [...strokes].sort((a, b) => b.length - a.length);
  const tiers: DrawingStroke[][] = [[], [], []];
  let running = 0;

  for (const stroke of byLength) {
    const tier = running < total * 0.55 ? 0 : running < total * 0.85 ? 1 : 2;
    tiers[tier].push(stroke);
    running += stroke.length;
  }

  const ordered: DrawingStroke[] = [];
  let pen: Point | null = null;

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

/**
 * The traced path is cut into `count` stages of roughly equal total length, so
 * each stage is one connected region of the picture.
 */
function distributeStrokes(drawing: DrawingData, count: number): number[][] {
  const groups: number[][] = Array.from({ length: count }, () => []);
  const total = drawing.strokes.reduce((sum, stroke) => sum + stroke.length, 0);
  let accumulated = 0;
  let group = 0;

  for (const stroke of orderStrokes(drawing.strokes)) {
    groups[group].push(stroke.id);
    accumulated += stroke.length;

    if (group < count - 1 && accumulated >= ((group + 1) / count) * total) {
      group += 1;
    }
  }

  return groups;
}

export function buildSteps(
  drawing: DrawingData | null,
  count: number,
  texts: readonly StepText[] = [],
): DrawingStep[] {
  const total = Math.min(MAX_STEPS, Math.max(MIN_STEPS, count));
  const groups = drawing
    ? distributeStrokes(drawing, total)
    : Array.from({ length: total }, () => [] as number[]);

  return groups.map((strokeIds, index) => {
    const text = texts[index] ?? templateText(index);

    return {
      id: index + 1,
      title: text.title,
      description: text.description,
      strokeIds,
      weight: text.weight ?? 1,
    };
  });
}

export function clearStrokes(steps: readonly DrawingStep[]): DrawingStep[] {
  return steps.map((step) => ({ ...step, strokeIds: [] }));
}

/** Inserts a new step after `index` and moves the second half of its strokes into it. */
export function splitStep(
  steps: readonly DrawingStep[],
  index: number,
): DrawingStep[] {
  const source = steps[index];
  if (!source || steps.length >= MAX_STEPS) return [...steps];

  const cut = Math.ceil(source.strokeIds.length / 2);
  const text = templateText(steps.length);
  const created: DrawingStep = {
    id: nextStepId(steps),
    title: text.title,
    description: text.description,
    strokeIds: source.strokeIds.slice(cut),
    weight: source.weight,
  };

  const next = steps.map((step) => step);
  next[index] = { ...source, strokeIds: source.strokeIds.slice(0, cut) };
  next.splice(index + 1, 0, created);

  return next;
}

/** Removes a step; its strokes move to the previous step (or the next one for step 1). */
export function mergeStep(
  steps: readonly DrawingStep[],
  index: number,
): DrawingStep[] {
  const removed = steps[index];
  if (!removed || steps.length <= MIN_STEPS) return [...steps];

  const rest = steps.filter((_, i) => i !== index);
  const targetIndex = index > 0 ? index - 1 : 0;
  const target = rest[targetIndex];

  rest[targetIndex] = {
    ...target,
    strokeIds:
      index > 0
        ? [...target.strokeIds, ...removed.strokeIds]
        : [...removed.strokeIds, ...target.strokeIds],
  };

  return rest;
}

/** direction 1: last stroke goes to the next step. -1: first stroke goes to the previous step. */
export function moveStrokeAcross(
  steps: readonly DrawingStep[],
  index: number,
  direction: -1 | 1,
): DrawingStep[] {
  const from = steps[index];
  const to = steps[index + direction];
  if (!from || !to || from.strokeIds.length === 0) return [...steps];

  const next = steps.map((step) => step);

  if (direction === 1) {
    const moved = from.strokeIds[from.strokeIds.length - 1];
    next[index] = { ...from, strokeIds: from.strokeIds.slice(0, -1) };
    next[index + 1] = { ...to, strokeIds: [moved, ...to.strokeIds] };
  } else {
    const moved = from.strokeIds[0];
    next[index] = { ...from, strokeIds: from.strokeIds.slice(1) };
    next[index - 1] = { ...to, strokeIds: [...to.strokeIds, moved] };
  }

  return next;
}

export function moveStepTo(
  steps: readonly DrawingStep[],
  from: number,
  to: number,
): DrawingStep[] {
  if (from === to || !steps[from] || to < 0 || to >= steps.length) {
    return [...steps];
  }

  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  return next;
}

/** Grows by splitting the busiest step, shrinks by merging the emptiest one. */
export function adjustStepCount(
  steps: readonly DrawingStep[],
  target: number,
): DrawingStep[] {
  const goal = Math.min(MAX_STEPS, Math.max(MIN_STEPS, target));
  let next = [...steps];

  while (next.length < goal) {
    let busiest = 0;
    next.forEach((step, i) => {
      if (step.strokeIds.length > next[busiest].strokeIds.length) busiest = i;
    });
    next = splitStep(next, busiest);
  }

  while (next.length > goal) {
    let emptiest = 0;
    next.forEach((step, i) => {
      if (step.strokeIds.length < next[emptiest].strokeIds.length) emptiest = i;
    });
    next = mergeStep(next, emptiest);
  }

  return next;
}

export type Rect = { x: number; y: number; w: number; h: number };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Largest rectangle with the given aspect that fits inside `area` minus `inset`, centered. */
export function fitRect(area: Rect, inset: number, w: number, h: number): Rect {
  const scale = Math.min((area.w - inset * 2) / w, (area.h - inset * 2) / h);
  const drawWidth = w * scale;
  const drawHeight = h * scale;

  return {
    x: area.x + (area.w - drawWidth) / 2,
    y: area.y + (area.h - drawHeight) / 2,
    w: drawWidth,
    h: drawHeight,
  };
}

/** Small deterministic random generator, so every render looks identical. */
export function createRandom(seed: number): () => number {
  let a = seed;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

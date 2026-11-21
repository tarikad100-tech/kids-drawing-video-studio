// Realistic hand sprites (cut from the supplied reference picture). The pencil
// is part of each sprite; the forearm and sleeve past the cut edge are drawn
// procedurally so the arm can run off the canvas at any size.
import type { HandStyle } from "./pencil";

export interface HandSprite {
  file: string;
  w: number;
  h: number;
  tip: readonly [number, number];
  length: number;
  axis: number;
  cutX: number;
  armTop: number;
  armBottom: number;
  skin: string;
  sleeve: string;
}

export const HAND_SPRITES: Record<Exclude<HandStyle, "none">, HandSprite> = {
  light: { file: "hand-light.png", w: 274, h: 474, tip: [20, 470], length: 524.2, axis: -1.0909, cutX: 233, armTop: 219, armBottom: 378, skin: "rgb(230,195,173)", sleeve: "rgb(243,171,185)" },
  tan: { file: "hand-tan.png", w: 269, h: 467, tip: [22, 461], length: 515.2, axis: -1.095, cutX: 234, armTop: 213, armBottom: 372, skin: "rgb(207,160,131)", sleeve: "rgb(160,196,220)" },
  brown: { file: "hand-brown.png", w: 272, h: 466, tip: [30, 460], length: 510.7, axis: -1.0993, cutX: 236, armTop: 207, armBottom: 366, skin: "rgb(172,117,86)", sleeve: "rgb(248,209,105)" },
  dark: { file: "hand-dark.png", w: 270, h: 460, tip: [28, 452], length: 500.9, axis: -1.0938, cutX: 235, armTop: 206, armBottom: 365, skin: "rgb(119,83,65)", sleeve: "rgb(137,164,114)" },
  glove: { file: "hand-glove.png", w: 265, h: 459, tip: [25, 458], length: 505.9, axis: -1.0833, cutX: 228, armTop: 210, armBottom: 313, skin: "rgb(246,244,239)", sleeve: "rgb(243,200,203)" },
};

const images = new Map<string, HTMLImageElement>();
const loads = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function baseUrl(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL ?? "/";
}

function load(key: string, file: string): Promise<void> {
  const existing = loads.get(key);
  if (existing) return existing;
  const promise = new Promise<void>((resolve) => {
    if (typeof Image === "undefined") return resolve();
    const img = new Image();
    img.onload = () => {
      images.set(key, img);
      listeners.forEach((cb) => cb());
      resolve();
    };
    img.onerror = () => resolve(); // vector hand stays as the fallback
    img.src = `${baseUrl()}hands/${file}`;
  });
  loads.set(key, promise);
  return promise;
}

export function getHandImage(hand: Exclude<HandStyle, "none">): HTMLImageElement | null {
  const img = images.get(hand);
  if (!img) void load(hand, HAND_SPRITES[hand].file);
  return img ?? null;
}

export async function handSpritesReady(hand?: HandStyle): Promise<void> {
  const keys = (hand && hand !== "none"
    ? [hand]
    : (Object.keys(HAND_SPRITES) as Array<Exclude<HandStyle, "none">>));
  await Promise.all(keys.map((k) => load(k, HAND_SPRITES[k].file)));
}

export function onHandSpritesLoaded(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

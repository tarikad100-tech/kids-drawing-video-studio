export type Point = readonly [number, number];

/** One pen stroke, in processed-image pixel coordinates. */
export type DrawingStroke = {
  id: number;
  points: Point[];
  /** Polyline length in processed-image pixels. */
  length: number;
};

export type DrawingData = {
  /** Size of the processed image; stroke coordinates live in this space. */
  width: number;
  height: number;
  /** Sorted from the longest stroke to the shortest; `id` follows this order. */
  strokes: DrawingStroke[];
};

export type DrawingStep = {
  id: number;
  title: string;
  description: string;
  strokeIds: number[];
  /** Relative share of the drawing time (0.5–3). Editor setting. */
  weight: number;
};

export type ProcessingMode = "edges" | "line-art";

export type ProcessingSettings = {
  /** "edges": Sobel edge detection (any picture). "line-art": dark lines on a light background. */
  mode: ProcessingMode;
  /** Contrast in percent (50–250). */
  contrast: number;
  /** Gray level below which a pixel counts as ink (line-art mode only). */
  threshold: number;
  /** 0–100. Higher values keep weaker edges (edges mode only). */
  edgeSensitivity: number;
  /** Strokes shorter than this many pixels are removed as specks. */
  cleanup: number;
  /** Evens out uneven lighting (photographed paper) before detection. */
  flatten: boolean;
};

/** Closed regions found between the outlines, with flat colors for the final reveal. */
export type ColorLayer = {
  width: number;
  height: number;
  /** Region id per pixel. 0 = paper / background (not colored). */
  labels: Uint16Array;
  /** RGB per region, index `region * 3`. */
  colors: Uint8Array;
  /** 0..1 reveal order per region (big regions first). */
  ranks: Float32Array;
  regionCount: number;
};

export type ProcessedImage = {
  width: number;
  height: number;
  /** Black-and-white result before thinning (1 = ink). Used for the comparison view. */
  binary: Uint8Array;
  drawing: DrawingData;
  colorLayer: ColorLayer;
  /**
   * The drawing's real lines (black on transparent) at higher resolution.
   * The pencil uncovers these exact pixels along its path, so the result
   * matches the picture instead of a redrawn approximation.
   */
  lineArt: HTMLCanvasElement;
  /** Width, in processed-image pixels, of the area uncovered around the pencil path. */
  maskWidth: number;
  /** True when very short strokes were dropped to stay under the stroke limit. */
  truncated: boolean;
};

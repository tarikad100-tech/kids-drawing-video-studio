import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { nearestStroke } from "../drawing/geometry";
import type { ProcessedImage, ProcessingSettings } from "../drawing/types";

type View = "original" | "processed" | "outlines" | "compare" | "color";

const VIEWS: ReadonlyArray<readonly [View, string]> = [
  ["outlines", "Outlines"],
  ["original", "Original"],
  ["processed", "Black & white"],
  ["compare", "Original vs outlines"],
  ["color", "Colored regions"],
];

function drawOutlines(
  ctx: CanvasRenderingContext2D,
  result: ProcessedImage,
  hidden: ReadonlySet<number>,
  offsetX: number,
) {
  ctx.save();
  ctx.translate(offsetX, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const showHidden of [true, false]) {
    ctx.beginPath();
    ctx.strokeStyle = showHidden ? "rgba(229, 72, 77, 0.55)" : "#202019";
    ctx.lineWidth = showHidden ? 1 : 1.5;

    for (const stroke of result.drawing.strokes) {
      if (hidden.has(stroke.id) !== showHidden) continue;

      stroke.points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
    }

    ctx.stroke();
  }

  ctx.restore();
}

function AnalysisCanvas({
  view,
  image,
  result,
  hidden,
  onToggleStroke,
}: {
  view: View;
  image: HTMLImageElement | null;
  result: ProcessedImage;
  hidden: ReadonlySet<number>;
  onToggleStroke: (id: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, height } = result;
  const canvasWidth = view === "compare" ? width * 2 : width;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, height);

    if (view === "original" || view === "compare") {
      if (image) ctx.drawImage(image, 0, 0, width, height);
    }

    if (view === "processed") {
      const pixels = ctx.createImageData(width, height);

      for (let i = 0; i < result.binary.length; i++) {
        const value = result.binary[i] === 1 ? 0 : 255;
        pixels.data[i * 4] = value;
        pixels.data[i * 4 + 1] = value;
        pixels.data[i * 4 + 2] = value;
        pixels.data[i * 4 + 3] = 255;
      }

      ctx.putImageData(pixels, 0, 0);
    }

    if (view === "color") {
      const layer = result.colorLayer;
      const pixels = ctx.createImageData(width, height);

      for (let i = 0; i < layer.labels.length; i++) {
        const region = layer.labels[i];
        const o = i * 4;

        pixels.data[o] = region === 0 ? 255 : layer.colors[region * 3];
        pixels.data[o + 1] = region === 0 ? 255 : layer.colors[region * 3 + 1];
        pixels.data[o + 2] = region === 0 ? 255 : layer.colors[region * 3 + 2];
        pixels.data[o + 3] = 255;
      }

      ctx.putImageData(pixels, 0, 0);
    }

    if (view === "outlines" || view === "color") {
      drawOutlines(ctx, result, hidden, 0);
    }

    if (view === "compare") {
      drawOutlines(ctx, result, hidden, width);
    }
  }, [view, image, result, hidden, width, height, canvasWidth]);

  function handleClick(event: MouseEvent<HTMLCanvasElement>) {
    if (view !== "outlines") return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    const id = nearestStroke(result.drawing.strokes, x, y, 8);

    if (id >= 0) onToggleStroke(id);
  }

  return (
    <canvas
      ref={canvasRef}
      className={view === "outlines" ? "analysis-canvas clickable" : "analysis-canvas"}
      width={canvasWidth}
      height={height}
      role="img"
      aria-label={`${view} view of the analyzed image`}
      onClick={handleClick}
    />
  );
}

type Props = {
  hasFile: boolean;
  image: HTMLImageElement | null;
  result: ProcessedImage | null;
  isProcessing: boolean;
  error: string;
  settings: ProcessingSettings;
  hidden: ReadonlySet<number>;
  onChange: (patch: Partial<ProcessingSettings>) => void;
  onReset: () => void;
  onRetry: () => void;
  onToggleStroke: (id: number) => void;
  onShowAll: () => void;
};

export function ProcessingPanel({
  hasFile,
  image,
  result,
  isProcessing,
  error,
  settings,
  hidden,
  onChange,
  onReset,
  onRetry,
  onToggleStroke,
  onShowAll,
}: Props) {
  const [view, setView] = useState<View>("outlines");
  const strokeCount = result?.drawing.strokes.length ?? 0;
  const hiddenCount = hidden.size;

  return (
    <section className="panel editor-panel">
      <div className="editor-heading">
        <div>
          <span className="eyebrow">LOCAL ANALYSIS</span>
          <h2>② Analyze your drawing</h2>
          <p>
            Lines are found in your browser. Nothing is uploaded. The tool finds
            lines, not objects, so you can fix the steps by hand afterwards.
          </p>
        </div>
        <div className="editor-heading-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={onRetry}
            disabled={!hasFile || isProcessing}
          >
            Analyze again
          </button>
          <button type="button" className="ghost-button" onClick={onReset}>
            Reset analysis
          </button>
        </div>
      </div>

      <div className="processing-grid">
        <div>
          <div className="view-tabs" role="group" aria-label="Analysis view">
            {VIEWS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={view === id ? "view-tab selected" : "view-tab"}
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {result ? (
            <AnalysisCanvas
              view={view}
              image={image}
              result={result}
              hidden={hidden}
              onToggleStroke={onToggleStroke}
            />
          ) : (
            <div className="analysis-empty">
              {hasFile
                ? isProcessing
                  ? "Analyzing your image…"
                  : "The image could not be analyzed."
                : "Upload an image to see the original, black-and-white and outline views."}
            </div>
          )}

          <p className="status-line" role="status">
            {hasFile && isProcessing && result ? "Updating…" : null}
            {result && !isProcessing
              ? `${strokeCount - hiddenCount} strokes in use${hiddenCount > 0 ? `, ${hiddenCount} hidden` : ""}, ${result.colorLayer.regionCount} closed regions for coloring${result.truncated ? " (very short strokes were dropped)" : ""}.`
              : null}
          </p>

          {result && view === "outlines" ? (
            <p className="editor-help">
              Click a line to hide it from the video (shown in red). Click it
              again to bring it back.
              {hiddenCount > 0 ? (
                <>
                  {" "}
                  <button type="button" className="link-button" onClick={onShowAll}>
                    Show all hidden lines
                  </button>
                </>
              ) : null}
            </p>
          ) : null}

          {result && strokeCount === 0 && !isProcessing ? (
            <p className="warning-line">
              No outlines were found. Raise the edge sensitivity, lower the
              speck removal, or switch the detection mode.
            </p>
          ) : null}
          {result && result.colorLayer.regionCount === 0 && strokeCount > 0 && !isProcessing ? (
            <p className="warning-line">
              No closed shapes were found, so the final color reveal is not
              available. Closed outlines are needed for coloring.
            </p>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="controls">
          <div className="control">
            <label htmlFor="mode">Detection mode</label>
            <select
              id="mode"
              className="select"
              value={settings.mode}
              onChange={(event) =>
                onChange({
                  mode: event.target.value === "line-art" ? "line-art" : "edges",
                })
              }
            >
              <option value="line-art">Line art (black-and-white drawing)</option>
              <option value="edges">Edges (a colored picture or photo)</option>
            </select>
            <p className="editor-help">
              Use Line art when the picture is a black-and-white drawing: the
              video then shows your drawing's real lines. Edges finds outlines in
              a colored picture and is less exact.
            </p>
          </div>

          <div className="control">
            <label htmlFor="sensitivity">
              Edge sensitivity: {settings.edgeSensitivity}
            </label>
            <input
              id="sensitivity"
              className="slider"
              type="range"
              min={0}
              max={100}
              value={settings.edgeSensitivity}
              disabled={settings.mode !== "edges"}
              onChange={(event) =>
                onChange({ edgeSensitivity: Number(event.target.value) })
              }
            />
          </div>

          <div className="control">
            <label htmlFor="threshold">Dark-line threshold: {settings.threshold}</label>
            <input
              id="threshold"
              className="slider"
              type="range"
              min={40}
              max={230}
              value={settings.threshold}
              disabled={settings.mode !== "line-art"}
              onChange={(event) =>
                onChange({ threshold: Number(event.target.value) })
              }
            />
          </div>

          <div className="control">
            <label htmlFor="contrast">Contrast: {settings.contrast}%</label>
            <input
              id="contrast"
              className="slider"
              type="range"
              min={50}
              max={250}
              value={settings.contrast}
              onChange={(event) =>
                onChange({ contrast: Number(event.target.value) })
              }
            />
          </div>

          <div className="control">
            <label htmlFor="cleanup">
              Speck removal (background cleanup): {settings.cleanup}px
            </label>
            <input
              id="cleanup"
              className="slider"
              type="range"
              min={2}
              max={60}
              value={settings.cleanup}
              onChange={(event) =>
                onChange({ cleanup: Number(event.target.value) })
              }
            />
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.flatten}
              onChange={(event) => onChange({ flatten: event.target.checked })}
            />
            Even out lighting (for photos of paper)
          </label>

          <p className="editor-help">
            Changing these settings re-analyzes the image and regenerates the
            stroke groups of every stage. Stage titles, descriptions and
            durations are kept.
          </p>
        </div>
      </div>
    </section>
  );
}

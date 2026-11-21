import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  MAX_PARTS,
  normalizeLayout,
  orderByParts,
  type LayoutPlan,
  type PartDef,
  type PartRect,
  type WritingDirection,
} from "../drawing/layout";
import type { DrawingData } from "../drawing/types";

const COLORS = ["#e5484d", "#2f7de1", "#1f9a57", "#e08a00", "#8a4fd6", "#0aa5a5", "#c2468a", "#6b7280"];
const CANVAS_WIDTH = 640;

type Props = {
  drawing: DrawingData | null;
  layout: LayoutPlan;
  onChange: (layout: LayoutPlan) => void;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function PartsPanel({ drawing, layout, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const plan = useMemo(() => normalizeLayout(layout), [layout]);

  // Which part every stroke belongs to, for the colors and the counts.
  const ordered = useMemo(() => (drawing ? orderByParts(drawing, plan) : []), [drawing, plan]);
  const counts = useMemo(() => new Map(ordered.map((o) => [o.part.id, o.strokes.length])), [ordered]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !drawing) return;

    const scale = CANVAS_WIDTH / drawing.width;
    canvas.width = CANVAS_WIDTH;
    canvas.height = Math.round(drawing.height * scale);
    ctx.fillStyle = "#fffdf7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;

    plan.parts.forEach((part, index) => {
      const entry = ordered.find((o) => o.part.id === part.id);
      if (!entry) return;

      ctx.strokeStyle = COLORS[index % COLORS.length];
      ctx.beginPath();

      for (const stroke of entry.strokes) {
        stroke.points.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(x * scale, y * scale);
          else ctx.lineTo(x * scale, y * scale);
        });
      }

      ctx.stroke();
    });

    plan.parts.forEach((part, index) => {
      if (part.kind !== "rect" || !part.rect) return;

      const [x0, y0, x1, y1] = part.rect;
      ctx.strokeStyle = COLORS[index % COLORS.length];
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 * canvas.width, y0 * canvas.height, (x1 - x0) * canvas.width, (y1 - y0) * canvas.height);
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.font = "bold 13px sans-serif";
      ctx.fillStyle = COLORS[index % COLORS.length];
      ctx.fillText(part.name, x0 * canvas.width + 4, y0 * canvas.height + 14);
    });

    if (drag) {
      ctx.strokeStyle = "#111";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        Math.min(drag.x0, drag.x1) * canvas.width,
        Math.min(drag.y0, drag.y1) * canvas.height,
        Math.abs(drag.x1 - drag.x0) * canvas.width,
        Math.abs(drag.y1 - drag.y0) * canvas.height,
      );
      ctx.setLineDash([]);
    }
  }, [drawing, plan, ordered, drag]);

  function position(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();

    return [clamp01((event.clientX - box.left) / box.width), clamp01((event.clientY - box.top) / box.height)] as const;
  }

  function startDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (!adding) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = position(event);
    setDrag({ x0: x, y0: y, x1: x, y1: y });
  }

  function moveDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (!drag) return;

    const [x, y] = position(event);
    setDrag({ ...drag, x1: x, y1: y });
  }

  function endDrag() {
    if (!drag) return;

    const rect: PartRect = [Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1)];
    setDrag(null);
    setAdding(false);

    // A click without dragging does nothing.
    if (rect[2] - rect[0] < 0.03 || rect[3] - rect[1] < 0.03) return;

    const id = Math.max(0, ...plan.parts.map((p) => p.id)) + 1;
    const rectParts = plan.parts.filter((p) => p.kind === "rect").length;
    const created: PartDef = { id, name: `Part ${rectParts + 1}`, kind: "rect", rect };
    // New parts come before the "rest" so they are drawn first.
    const restIndex = plan.parts.findIndex((p) => p.kind === "rest");
    const parts = [...plan.parts];
    parts.splice(restIndex < 0 ? parts.length : restIndex, 0, created);
    onChange({ ...plan, parts });
  }

  function rename(id: number, name: string) {
    onChange({ ...plan, parts: plan.parts.map((p) => (p.id === id ? { ...p, name: name.slice(0, 30) } : p)) });
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= plan.parts.length) return;

    const parts = [...plan.parts];
    [parts[index], parts[target]] = [parts[target], parts[index]];
    onChange({ ...plan, parts });
  }

  function remove(id: number) {
    onChange({ ...plan, parts: plan.parts.filter((p) => p.id !== id) });
  }

  function addWriting() {
    const id = Math.max(0, ...plan.parts.map((p) => p.id)) + 1;
    onChange({ ...plan, parts: [...plan.parts, { id, name: "Writing", kind: "text" }] });
  }

  if (!drawing) return null;

  return (
    <section className="panel parts-panel">
      <span className="eyebrow">DRAWING ORDER</span>
      <h2>② Parts: what is drawn first</h2>
      <p>
        The pencil finishes one part before it starts the next, so it never jumps around. Writing is found
        automatically and drawn letter by letter. To draw one character before another (for example the mother, then
        the girl), press “Add a part” and drag a box around it. The smaller box wins when boxes overlap.
      </p>

      <div className="row">
        <div>
          <label htmlFor="direction">Direction of the writing</label>
          <select
            id="direction"
            value={plan.direction}
            onChange={(event) => onChange({ ...plan, direction: event.target.value === "ltr" ? "ltr" : ("rtl" as WritingDirection) })}
          >
            <option value="rtl">Arabic: right to left</option>
            <option value="ltr">English / French / Spanish: left to right</option>
          </select>
        </div>
        <div className="align-end">
          <button type="button" className={adding ? "primary" : "ghost-button"} disabled={plan.parts.length >= MAX_PARTS} onClick={() => setAdding((value) => !value)}>
            {adding ? "Drag a box on the picture…" : "+ Add a part"}
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="parts-canvas"
        style={{ width: "100%", maxWidth: CANVAS_WIDTH, cursor: adding ? "crosshair" : "default", touchAction: adding ? "none" : "auto", border: "1px solid #e2d8bf", borderRadius: 12 }}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        aria-label="Parts of the drawing"
      />

      <ol className="parts-list" style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
        {plan.parts.map((part, index) => (
          <li key={part.id} style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0", flexWrap: "wrap" }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: COLORS[index % COLORS.length], flex: "none" }} />
            <strong style={{ width: 22 }}>{index + 1}</strong>
            <input
              value={part.name}
              maxLength={30}
              aria-label={`Name of part ${index + 1}`}
              onChange={(event) => rename(part.id, event.target.value)}
              style={{ flex: "1 1 140px", minWidth: 120 }}
            />
            <small>
              {part.kind === "text" ? "writing (automatic)" : part.kind === "rest" ? "everything else" : "box"} · {counts.get(part.id) ?? 0} lines
            </small>
            <button type="button" className="ghost-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move earlier">
              ↑
            </button>
            <button type="button" className="ghost-button" disabled={index === plan.parts.length - 1} onClick={() => move(index, 1)} aria-label="Move later">
              ↓
            </button>
            {part.kind !== "rest" ? (
              <button type="button" className="ghost-button" onClick={() => remove(part.id)} aria-label={`Delete ${part.name}`}>
                ✕
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {!plan.parts.some((p) => p.kind === "text") ? (
        <button type="button" className="ghost-button" onClick={addWriting}>
          + Detect the writing automatically
        </button>
      ) : null}
    </section>
  );
}

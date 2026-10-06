"use client";

import { useEffect, useRef, useState } from "react";

import type { DrawingPoint, DrawingStroke } from "@/game/mock-game-state";

interface DrawingCanvasProps {
  strokes: DrawingStroke[];
  canDraw: boolean;
  emptyMessage?: string;
  redoCount?: number;
  onStroke: (stroke: DrawingStroke) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

interface CanvasSize {
  width: number;
  height: number;
}

const PALETTE = [
  "#263b5b",
  "#ef6d5c",
  "#ec9d42",
  "#67b7a7",
  "#5c83cd",
  "#a077c9",
  "#262626",
  "#ffffff",
];

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: DrawingStroke,
  width: number,
  height: number,
) {
  if (stroke.points.length === 0) return;
  context.save();
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  const [first, ...rest] = stroke.points;
  context.moveTo(first.x * width, first.y * height);
  for (const point of rest) context.lineTo(point.x * width, point.y * height);
  if (rest.length === 0) {
    context.arc(first.x * width, first.y * height, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.stroke();
  }
  context.restore();
}

function pointerToPoint(event: React.PointerEvent<HTMLCanvasElement>): DrawingPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
}

export function DrawingCanvas({
  strokes,
  canDraw,
  emptyMessage = "The canvas is all yours",
  redoCount = 0,
  onStroke,
  onUndo,
  onRedo,
  onClear,
}: DrawingCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointerId = useRef<number | null>(null);
  const activeStrokeRef = useRef<DrawingStroke | null>(null);
  const nextStrokeId = useRef(1);
  const [surfaceSize, setSurfaceSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [activeStroke, setActiveStroke] = useState<DrawingStroke | null>(null);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState(PALETTE[0]);
  const [brushSize, setBrushSize] = useState(5);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSurfaceSize({
        width: Math.max(1, Math.round(entry.contentRect.width)),
        height: Math.max(1, Math.round(entry.contentRect.height)),
      });
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || surfaceSize.width < 1 || surfaceSize.height < 1) return;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(surfaceSize.width * pixelRatio);
    canvas.height = Math.round(surfaceSize.height * pixelRatio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, surfaceSize.width, surfaceSize.height);
    for (const stroke of strokes)
      drawStroke(context, stroke, surfaceSize.width, surfaceSize.height);
    if (activeStroke) drawStroke(context, activeStroke, surfaceSize.width, surfaceSize.height);
  }, [strokes, activeStroke, surfaceSize]);

  function startStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!canDraw || activePointerId.current !== null) return;
    event.preventDefault();
    activePointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerToPoint(event);
    const stroke: DrawingStroke = {
      id: `stroke-${nextStrokeId.current++}`,
      color,
      size: brushSize,
      tool,
      points: [point],
    };
    activeStrokeRef.current = stroke;
    setActiveStroke(stroke);
  }

  function moveStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!canDraw || activePointerId.current !== event.pointerId) return;
    event.preventDefault();
    const current = activeStrokeRef.current;
    if (!current) return;
    const next = { ...current, points: [...current.points, pointerToPoint(event)] };
    activeStrokeRef.current = next;
    setActiveStroke(next);
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (activePointerId.current !== event.pointerId) return;
    const finished = activeStrokeRef.current;
    activePointerId.current = null;
    activeStrokeRef.current = null;
    setActiveStroke(null);
    if (finished) onStroke(finished);
  }

  return (
    <div className="drawing-toolkit">
      <div className="canvas-surface" ref={surfaceRef}>
        <canvas
          ref={canvasRef}
          className={`drawing-canvas${canDraw ? " drawing-canvas--active" : ""}`}
          aria-label={
            canDraw
              ? "Drawing canvas. Use a pointer, mouse, or touch to draw."
              : "Current round drawing"
          }
          onPointerDown={startStroke}
          onPointerMove={moveStroke}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
        {!canDraw && strokes.length === 0 ? (
          <div className="canvas-empty-note">
            <span aria-hidden="true">✎</span> {emptyMessage}
          </div>
        ) : null}
      </div>

      {canDraw ? (
        <div className="drawing-toolbar" aria-label="Drawing tools">
          <div className="tool-buttons" role="group" aria-label="Choose a tool">
            <button
              className={`tool-button${tool === "pen" ? " tool-button--active" : ""}`}
              type="button"
              onClick={() => setTool("pen")}
              aria-pressed={tool === "pen"}
            >
              <span aria-hidden="true">✎</span> Pen
            </button>
            <button
              className={`tool-button${tool === "eraser" ? " tool-button--active" : ""}`}
              type="button"
              onClick={() => setTool("eraser")}
              aria-pressed={tool === "eraser"}
            >
              <span aria-hidden="true">▱</span> Eraser
            </button>
            <button
              className="tool-icon-button"
              type="button"
              onClick={onUndo}
              disabled={strokes.length === 0}
              aria-label="Undo last stroke"
            >
              ↶
            </button>
            <button
              className="tool-icon-button"
              type="button"
              onClick={onRedo}
              disabled={redoCount === 0}
              aria-label="Redo last undone stroke"
            >
              ↷
            </button>
            <button
              className="tool-icon-button tool-icon-button--clear"
              type="button"
              onClick={onClear}
              disabled={strokes.length === 0}
              aria-label="Clear the canvas"
            >
              ⌫
            </button>
          </div>

          <div className="drawing-options">
            <div className="color-palette" role="group" aria-label="Choose a drawing color">
              {PALETTE.map((swatch) => (
                <button
                  className={`color-swatch${color === swatch ? " color-swatch--active" : ""}${swatch === "#ffffff" ? " color-swatch--white" : ""}`}
                  style={{ backgroundColor: swatch }}
                  type="button"
                  key={swatch}
                  onClick={() => setColor(swatch)}
                  aria-label={`Choose ${swatch === "#ffffff" ? "white" : swatch} color`}
                  aria-pressed={color === swatch}
                />
              ))}
            </div>
            <label className="brush-control">
              <span>
                Brush <strong>{brushSize}px</strong>
              </span>
              <input
                type="range"
                min={2}
                max={16}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                aria-label="Brush size"
              />
            </label>
          </div>
        </div>
      ) : (
        <p className="canvas-view-only">
          <span aria-hidden="true">✦</span> Only the drawer can draw this round
        </p>
      )}
    </div>
  );
}

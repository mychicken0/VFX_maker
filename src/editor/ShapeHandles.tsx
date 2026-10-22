import { useState } from "react";
import type { Layer, Vec } from "../core/model.js";
import { clamp } from "../core/math.js";
export function svgDrag(
  event: React.PointerEvent<SVGElement>,
  move: (point: Vec) => void,
  finish: () => void,
  cancel: () => void,
  width: number,
  height: number,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const el = event.currentTarget;
  el.setPointerCapture(event.pointerId);
  const onMove = (e: PointerEvent) => {
    const r = el.closest(".canvas-stack")!.getBoundingClientRect();
    move({
      x: ((e.clientX - r.left) / r.width) * width,
      y: ((e.clientY - r.top) / r.height) * height,
    });
  };
  const cleanup = () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", abort);
  };
  const up = () => {
    cleanup();
    finish();
  };
  const abort = () => {
    cleanup();
    cancel();
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", abort);
}
export function CurveHandles({
  layer,
  index,
  zoom,
  width,
  height,
  world,
  local,
  onDraft,
  onCommit,
}: {
  layer: Extract<Layer, { type: "path" }>;
  index: number;
  zoom: number;
  width: number;
  height: number;
  world: (p: Vec, l: Layer) => Vec;
  local: (p: Vec, l: Layer) => Vec;
  onDraft: (l: Layer | undefined) => void;
  onCommit: (patch: Record<string, unknown>) => void;
}) {
  if (!layer.handles || !layer.points[index]) return null;
  const anchor = layer.points[index],
    origin = world(anchor, layer);
  return (
    <g>
      {(["in", "out"] as const).map((side) => {
        const handle = layer.handles![index][side],
          p = world({ x: anchor.x + handle.x, y: anchor.y + handle.y }, layer);
        return (
          <g key={side}>
            <line
              x1={origin.x}
              y1={origin.y}
              x2={p.x}
              y2={p.y}
              stroke="#e8b897"
              strokeWidth={1 / zoom}
            />
            <circle
              aria-label={`Bezier ${side} handle`}
              cx={p.x}
              cy={p.y}
              r={5 / zoom}
              fill="#e8b897"
              className="drag-handle"
              onPointerDown={(e) => {
                const original = structuredClone(layer);
                let next = original;
                svgDrag(
                  e,
                  (point) => {
                    const value = local(point, original);
                    next = {
                      ...original,
                      handles: original.handles!.map((h, i) =>
                        i === index
                          ? {
                              ...h,
                              [side]: {
                                x: clamp(value.x - anchor.x, -4096, 4096),
                                y: clamp(value.y - anchor.y, -4096, 4096),
                              },
                            }
                          : h,
                      ),
                    };
                    onDraft(next);
                  },
                  () => {
                    onDraft(undefined);
                    onCommit({ handles: next.handles });
                  },
                  () => onDraft(undefined),
                  width,
                  height,
                );
              }}
            />
          </g>
        );
      })}
    </g>
  );
}
export function MaskHandles({
  layer,
  zoom,
  width,
  height,
  world,
  local,
  onDraft,
  onCommit,
}: {
  layer: Layer;
  zoom: number;
  width: number;
  height: number;
  world: (p: Vec, l: Layer) => Vec;
  local: (p: Vec, l: Layer) => Vec;
  onDraft: (l: Layer | undefined) => void;
  onCommit: (patch: Record<string, unknown>) => void;
}) {
  const m = layer.mask;
  if (!m) return null;
  const center = world(m.position, layer),
    corner = world(
      { x: m.position.x + m.width / 2, y: m.position.y + m.height / 2 },
      layer,
    );
  const drag = (
    e: React.PointerEvent<SVGElement>,
    kind: "position" | "size" | number,
  ) => {
    const original = structuredClone(layer),
      mask = original.mask!;
    let next = mask;
    svgDrag(
      e,
      (point) => {
        const p = local(point, original);
        next =
          typeof kind === "number"
            ? {
                ...mask,
                points: mask.points.map((q, i) =>
                  i === kind
                    ? {
                        x: clamp(p.x - mask.position.x, -4096, 4096),
                        y: clamp(p.y - mask.position.y, -4096, 4096),
                      }
                    : q,
                ),
              }
            : kind === "size"
              ? {
                  ...mask,
                  width: clamp(Math.abs(p.x - mask.position.x) * 2, 1, 1024),
                  height: clamp(Math.abs(p.y - mask.position.y) * 2, 1, 1024),
                }
              : {
                  ...mask,
                  position: {
                    x: clamp(p.x, -4096, 4096),
                    y: clamp(p.y, -4096, 4096),
                  },
                };
        onDraft({ ...original, mask: next });
      },
      () => {
        onDraft(undefined);
        onCommit({ mask: next });
      },
      () => onDraft(undefined),
      width,
      height,
    );
  };
  const shape =
    m.shape === "polygon"
      ? m.points
      : m.shape === "ellipse"
        ? Array.from({ length: 48 }, (_, i) => ({
            x: (Math.cos((i / 48) * Math.PI * 2) * m.width) / 2,
            y: (Math.sin((i / 48) * Math.PI * 2) * m.height) / 2,
          }))
        : [
            { x: -m.width / 2, y: -m.height / 2 },
            { x: m.width / 2, y: -m.height / 2 },
            { x: m.width / 2, y: m.height / 2 },
            { x: -m.width / 2, y: m.height / 2 },
          ];
  return (
    <g>
      <polygon
        points={shape
          .map((p) => {
            const w = world(
              { x: p.x + m.position.x, y: p.y + m.position.y },
              layer,
            );
            return `${w.x},${w.y}`;
          })
          .join(" ")}
        fill="none"
        stroke="#7bd3b2"
        strokeDasharray={`${3 / zoom} ${3 / zoom}`}
        strokeWidth={1 / zoom}
      />
      <circle
        aria-label="Drag mask center"
        className="drag-handle"
        cx={center.x}
        cy={center.y}
        r={8 / zoom}
        fill="#16382f"
        stroke="#7bd3b2"
        strokeWidth={1 / zoom}
        onPointerDown={(e) => drag(e, "position")}
      />
      {m.shape === "polygon" ? (
        m.points.map((p, i) => {
          const w = world(
            { x: p.x + m.position.x, y: p.y + m.position.y },
            layer,
          );
          return (
            <circle
              key={i}
              aria-label={`Mask point ${i + 1}`}
              className="drag-handle"
              cx={w.x}
              cy={w.y}
              r={5 / zoom}
              fill="#7bd3b2"
              onPointerDown={(e) => drag(e, i)}
            />
          );
        })
      ) : (
        <rect
          aria-label="Drag mask size"
          className="drag-handle"
          x={corner.x - 5 / zoom}
          y={corner.y - 5 / zoom}
          width={10 / zoom}
          height={10 / zoom}
          fill="#7bd3b2"
          onPointerDown={(e) => drag(e, "size")}
        />
      )}
    </g>
  );
}
export function InkSurface({
  width,
  height,
  zoom,
  onStroke,
}: {
  width: number;
  height: number;
  zoom: number;
  onStroke: (p: Vec[]) => void;
}) {
  const [points, setPoints] = useState<Vec[]>([]);
  return (
    <>
      <rect
        aria-label="Freehand drawing surface"
        width={width}
        height={height}
        fill="transparent"
        style={{ cursor: "crosshair" }}
        onPointerDown={(e) => {
          const rect = e.currentTarget
              .closest(".canvas-stack")!
              .getBoundingClientRect(),
            first = {
              x: clamp(
                ((e.clientX - rect.left) / rect.width) * width,
                0,
                width,
              ),
              y: clamp(
                ((e.clientY - rect.top) / rect.height) * height,
                0,
                height,
              ),
            },
            stroke = [first];
          setPoints(stroke);
          svgDrag(
            e,
            (p) => {
              const next = {
                  x: clamp(p.x, 0, width),
                  y: clamp(p.y, 0, height),
                },
                last = stroke.at(-1)!;
              if (
                stroke.length < 8192 &&
                Math.hypot(next.x - last.x, next.y - last.y) > 0.25
              ) {
                stroke.push(next);
                setPoints([...stroke]);
              }
            },
            () => {
              setPoints([]);
              if (stroke.length >= 2) onStroke(stroke);
            },
            () => setPoints([]),
            width,
            height,
          );
        }}
      />
      <polyline
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        stroke="#f2bfeb"
        strokeWidth={2 / zoom}
        fill="none"
        pointerEvents="none"
      />
    </>
  );
}

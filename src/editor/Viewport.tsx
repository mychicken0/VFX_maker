import { useEffect, useMemo, useRef, useState } from "react";
import type { Layer, Project, Vec } from "../core/model.js";
import { evaluate } from "../core/math.js";
import { readableError } from "../core/errors.js";
import { localTime } from "../core/simulation.js";
import { VfxRenderer } from "../render/pixi.js";
export function Viewport({
  project,
  layer,
  time,
  update,
  onError,
  onInteract,
}: {
  project: Project;
  layer?: Layer;
  time: number;
  update: (patch: Record<string, unknown>) => void;
  onError: (e: string) => void;
  onInteract: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<VfxRenderer | null>(null),
    timeRef = useRef(time);
  const [ready, setReady] = useState(false),
    [zoom, setZoom] = useState(3),
    [guides, setGuides] = useState(true),
    [background, setBackground] = useState<"dark" | "checker">("dark"),
    [draft, setDraft] = useState<Layer>();
  timeRef.current = time;
  const viewProject = useMemo(
    () =>
      draft
        ? {
            ...project,
            layers: project.layers.map((l) => (l.id === draft.id ? draft : l)),
          }
        : project,
    [project, draft],
  );
  useEffect(() => {
    let alive = true;
    VfxRenderer.create()
      .then((r) => {
        if (!alive) {
          r.destroy();
          return;
        }
        renderer.current = r;
        host.current?.append(r.canvas);
        setReady(true);
      })
      .catch((e) => onError(readableError(e)));
    return () => {
      alive = false;
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, []);
  useEffect(() => {
    if (ready)
      void renderer.current
        ?.setProject(viewProject)
        .then(() => renderer.current?.render(timeRef.current))
        .catch((e) => onError(readableError(e)));
  }, [viewProject, ready]);
  useEffect(() => {
    if (ready) {
      try {
        renderer.current?.render(time);
      } catch (e) {
        onError(readableError(e));
      }
    }
  }, [time, ready]);
  const active = draft ?? layer,
    { width, height } = project.canvas;
  const transform = (l: Layer) => {
    const u = (localTime(l, time) ?? 0) / l.duration;
    return {
      x: l.position.x + evaluate(l.motion.x, u),
      y: l.position.y + evaluate(l.motion.y, u),
      rotation: ((l.rotation + evaluate(l.motion.rotation, u)) * Math.PI) / 180,
      scale: l.scale * evaluate(l.motion.scale, u),
    };
  };
  const world = (p: Vec, l: Layer): Vec => {
    const t = transform(l);
    return {
      x:
        t.x +
        (p.x * Math.cos(t.rotation) - p.y * Math.sin(t.rotation)) * t.scale,
      y:
        t.y +
        (p.x * Math.sin(t.rotation) + p.y * Math.cos(t.rotation)) * t.scale,
    };
  };
  const anchor = active ? world({ x: 0, y: 0 }, active) : { x: 0, y: 0 };
  const pointFromEvent = (e: React.PointerEvent | React.MouseEvent) => {
    const box = e.currentTarget
      .closest(".canvas-stack")!
      .getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * width,
      y: ((e.clientY - box.top) / box.height) * height,
    };
  };
  const drag = (e: React.PointerEvent<SVGElement>, index: number | null) => {
    if (!active || active.locked) return;
    e.stopPropagation();
    onInteract();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const start = pointFromEvent(e),
      original = structuredClone(active);
    let next = original;
    const move = (event: PointerEvent) => {
      const box = target.closest(".canvas-stack")!.getBoundingClientRect();
      const dx = ((event.clientX - box.left) / box.width) * width - start.x,
        dy = ((event.clientY - box.top) / box.height) * height - start.y;
      if (index === null)
        next = {
          ...original,
          position: {
            x: Math.round(original.position.x + dx),
            y: Math.round(original.position.y + dy),
          },
        };
      else if ("points" in original) {
        const tx = transform(original),
          a = -tx.rotation;
        next = {
          ...original,
          points: original.points.map((p, i) =>
            i === index
              ? {
                  x: Math.round(
                    p.x + (dx * Math.cos(a) - dy * Math.sin(a)) / tx.scale,
                  ),
                  y: Math.round(
                    p.y + (dx * Math.sin(a) + dy * Math.cos(a)) / tx.scale,
                  ),
                }
              : p,
          ),
        };
      }
      setDraft(next);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", cancel);
      setDraft(undefined);
      update(
        index === null
          ? { position: next.position }
          : "points" in next
            ? { points: next.points }
            : {},
      );
    };
    const cancel = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", cancel);
      setDraft(undefined);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", cancel);
  };
  return (
    <section className="viewport">
      <div className="viewport-toolbar">
        <span className="live-dot" /> <b>Live preview</b>
        <span className="toolbar-separator" />
        <button
          className={guides ? "active" : ""}
          onClick={() => setGuides(!guides)}
          title="Toggle guides"
        >
          Guides
        </button>
        <button
          onClick={() =>
            setBackground(background === "dark" ? "checker" : "dark")
          }
          title="Toggle transparent checkerboard"
        >
          {background === "checker" ? "Checker" : "Dark"}
        </button>
        <div className="spacer" />
        <select
          aria-label="Preview zoom"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 5, 6].map((z) => (
            <option key={z} value={z}>
              {z * 100}%
            </option>
          ))}
        </select>
      </div>
      <div className="viewport-area">
        <div
          className={`canvas-stack ${background === "checker" ? "checker" : ""}`}
          style={{
            width: width * zoom,
            height: height * zoom,
            backgroundColor:
              background === "dark" ? project.canvas.background : undefined,
          }}
        >
          <div
            ref={host}
            className={`pixi-host ${project.canvas.pixelArt ? "pixel-art" : ""}`}
            data-testid="pixi-viewport"
          />
          {guides && (
            <svg
              className="canvas-guides"
              viewBox={`0 0 ${width} ${height}`}
              onDoubleClick={(e) => {
                if (
                  !active ||
                  active.locked ||
                  !("points" in active) ||
                  (active.type === "particles" && active.mode !== "path") ||
                  active.points.length >= 64
                )
                  return;
                onInteract();
                const p = pointFromEvent(e),
                  tx = transform(active),
                  a = -tx.rotation,
                  dx = p.x - tx.x,
                  dy = p.y - tx.y;
                update({
                  points: [
                    ...active.points,
                    {
                      x: Math.round(
                        (dx * Math.cos(a) - dy * Math.sin(a)) / tx.scale,
                      ),
                      y: Math.round(
                        (dx * Math.sin(a) + dy * Math.cos(a)) / tx.scale,
                      ),
                    },
                  ],
                });
              }}
            >
              <path
                d={`M${width / 2} 0V${height}M0 ${height / 2}H${width}`}
                stroke="#b8b6ce"
                opacity="0.14"
                strokeWidth={1 / zoom}
                strokeDasharray={`${3 / zoom} ${3 / zoom}`}
              />
              {active && active.visible && !active.locked && (
                <>
                  {"points" in active &&
                    (active.type === "path" || active.mode === "path") && (
                      <>
                        <polyline
                          points={active.points
                            .map((p) => {
                              const w = world(p, active);
                              return `${w.x},${w.y}`;
                            })
                            .join(" ")}
                          fill="none"
                          stroke="#b3a0ff"
                          opacity="0.6"
                          strokeWidth={1 / zoom}
                        />
                        {active.points.map((p, i) => {
                          const w = world(p, active);
                          return (
                            <g key={i}>
                              <circle
                                aria-label={`Drag point ${i + 1}`}
                                className="drag-handle"
                                cx={w.x}
                                cy={w.y}
                                r={4 / zoom}
                                fill="#d1c4ff"
                                stroke="#262235"
                                strokeWidth={1 / zoom}
                                onPointerDown={(e) => drag(e, i)}
                              />
                              <text
                                x={w.x + 6 / zoom}
                                y={w.y - 5 / zoom}
                                fontSize={10 / zoom}
                                fill="#d1c4ff"
                                pointerEvents="none"
                              >
                                {i + 1}
                              </text>
                            </g>
                          );
                        })}
                      </>
                    )}
                  <g
                    aria-label="Drag layer position"
                    className="drag-handle"
                    onPointerDown={(e) => drag(e, null)}
                  >
                    <circle
                      cx={anchor.x}
                      cy={anchor.y}
                      r={7 / zoom}
                      fill="#14121f"
                      stroke="#c4b0ff"
                      strokeWidth={1 / zoom}
                    />
                    <path
                      d={`M${anchor.x - 4 / zoom} ${anchor.y}h${8 / zoom}M${anchor.x} ${anchor.y - 4 / zoom}v${8 / zoom}`}
                      stroke="#d1c4ff"
                      strokeWidth={1 / zoom}
                      pointerEvents="none"
                    />
                  </g>
                </>
              )}
            </svg>
          )}
          <div className="canvas-label">
            {width} × {height}
          </div>
        </div>
      </div>
      <div className="viewport-footer">
        <span>
          {project.canvas.pixelArt ? "PIXEL ART" : "SMOOTH TEXTURES"} <i>·</i>{" "}
          PixiJS / WebGL
        </span>
        <span>
          {project.layers.length} layers <i>·</i> {project.seed} seed
        </span>
      </div>
    </section>
  );
}

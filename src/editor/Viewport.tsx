import { useEffect, useMemo, useRef, useState } from "react";
import type { Layer, Project, Vec } from "../core/model.js";
import { defaultHandles, pathPolyline } from "../core/geometry.js";
import { CurveHandles, MaskHandles, InkSurface } from "./ShapeHandles.js";
import { evaluate } from "../core/math.js";
import { readableError } from "../core/errors.js";
import { localTime } from "../core/simulation.js";
import { OnionSkin } from "./OnionSkin.js";
import { VfxRenderer } from "../render/pixi.js";
export function Viewport({
  project,
  layer,
  time,
  update,
  onError,
  onInteract,
  solo,
  selection = [],
  updateProject,
  addStroke,
}: {
  project: Project;
  layer?: Layer;
  time: number;
  update: (patch: Record<string, unknown>) => void;
  onError: (e: string) => void;
  onInteract: () => void;
  solo?: string;
  selection?: string[];
  updateProject?: (p: Project) => void;
  addStroke?: (points: Vec[]) => void;
}) {
  const area = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null),
    renderer = useRef<VfxRenderer | null>(null),
    timeRef = useRef(time);
  const [ready, setReady] = useState(false),
    [zoomChoice, setZoomChoice] = useState("fit"),
    [room, setRoom] = useState({ width: 640, height: 480 }),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [panMode, setPanMode] = useState(false),
    [grid, setGrid] = useState(false),
    [snap, setSnap] = useState(true),
    [guides, setGuides] = useState(true),
    [background, setBackground] = useState<"dark" | "checker">("dark"),
    [draft, setDraft] = useState<Layer>(),
    [onion, setOnion] = useState(false),
    [referenceMode, setReferenceMode] = useState(false),
    [referenceDraft, setReferenceDraft] = useState<{
      x: number;
      y: number;
    } | null>(null),
    [inkMode, setInkMode] = useState(false),
    [maskMode, setMaskMode] = useState(false),
    [anchorIndex, setAnchorIndex] = useState(0);
  timeRef.current = time;
  const zoom =
    zoomChoice === "fit"
      ? Math.max(
          0.125,
          Math.min(
            3,
            (room.width - 48) / project.canvas.width,
            (room.height - 48) / project.canvas.height,
          ),
        )
      : Number(zoomChoice);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const viewProject = useMemo(
    () => ({
      ...project,
      layers: project.layers.map((l) => {
        let value = draft?.id === l.id ? draft : l;
        if (
          draft &&
          layer &&
          l.id !== layer.id &&
          selection.includes(l.id) &&
          !l.locked
        ) {
          value = {
            ...value,
            position: {
              x: value.position.x + draft.position.x - layer.position.x,
              y: value.position.y + draft.position.y - layer.position.y,
            },
          };
        }

        return solo
          ? { ...value, visible: l.id === solo && value.visible }
          : value;
      }),
    }),
    [project, draft, solo, selection, layer],
  );
  useEffect(() => {
    if (!area.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setRoom({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const z = zoomRef.current,
        next = Math.max(
          0.125,
          Math.min(16, z * Math.exp(-event.deltaY * 0.0015)),
        );
      const b = el.getBoundingClientRect(),
        x = event.clientX - b.left - b.width / 2,
        y = event.clientY - b.top - b.height / 2;
      setPan((p) => ({
        x: x - ((x - p.x) * next) / z,
        y: y - ((y - p.y) * next) / z,
      }));
      zoomRef.current = next;
      setZoomChoice(String(next));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [project.canvas.width, project.canvas.height]);
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
  const local = (p: Vec, l: Layer): Vec => {
    const t = transform(l),
      dx = p.x - t.x,
      dy = p.y - t.y;
    return {
      x: (dx * Math.cos(t.rotation) + dy * Math.sin(t.rotation)) / t.scale,
      y: (-dx * Math.sin(t.rotation) + dy * Math.cos(t.rotation)) / t.scale,
    };
  };
  const anchor = active ? world({ x: 0, y: 0 }, active) : { x: 0, y: 0 };
  const rounded = (n: number) =>
    snap ? Math.round(n) : Math.round(n * 100) / 100;
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
    if (
      e.button !== 0 ||
      !active ||
      active.locked ||
      panMode ||
      referenceMode ||
      inkMode ||
      maskMode
    )
      return;
    if (index !== null) setAnchorIndex(index);
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
            x: rounded(original.position.x + dx),
            y: rounded(original.position.y + dy),
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
                  x: rounded(
                    p.x + (dx * Math.cos(a) - dy * Math.sin(a)) / tx.scale,
                  ),
                  y: rounded(
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
        <button
          aria-label="Pixel grid"
          aria-pressed={grid}
          onClick={() => setGrid(!grid)}
          title="Show pixel grid at 400% and above"
        >
          Grid
        </button>
        <button
          aria-label="Snap to pixels"
          aria-pressed={snap}
          onClick={() => setSnap(!snap)}
        >
          Snap
        </button>
        <button
          aria-label="Pan canvas"
          aria-pressed={panMode}
          onClick={() => {
            setPanMode(!panMode);
            setInkMode(false);
            setMaskMode(false);
            setReferenceMode(false);
          }}
        >
          Hand
        </button>
        {addStroke && (
          <button
            aria-label="Freehand stroke"
            aria-pressed={inkMode}
            onClick={() => {
              setInkMode((v) => !v);
              setGuides(true);
              setPanMode(false);
              setReferenceMode(false);
              setMaskMode(false);
              onInteract();
            }}
          >
            Freehand
          </button>
        )}
        {layer?.type === "path" && (
          <button
            aria-label="Bezier handles"
            disabled={layer.locked}
            aria-pressed={!!layer.handles}
            onClick={() => {
              update({
                handles: layer.handles
                  ? undefined
                  : defaultHandles(layer.points, layer.closed),
              });
              setMaskMode(false);
              setInkMode(false);
              setReferenceMode(false);
              setGuides(true);
              onInteract();
            }}
          >
            Bezier
          </button>
        )}
        {layer?.mask && (
          <button
            aria-label="Mask edit"
            aria-pressed={maskMode}
            onClick={() => {
              setMaskMode((v) => !v);
              setInkMode(false);
              setReferenceMode(false);
              setPanMode(false);
              setGuides(true);
              onInteract();
            }}
          >
            Mask edit
          </button>
        )}
        <button
          aria-label="Onion skin"
          aria-pressed={onion}
          onClick={() => {
            setOnion((v) => !v);
            onInteract();
          }}
        >
          Onion
        </button>
        {project.editor.reference && (
          <button
            aria-label="Reference move"
            aria-pressed={referenceMode}
            onClick={() => {
              setReferenceMode((v) => !v);
              setInkMode(false);
              setMaskMode(false);
              setPanMode(false);
              setGuides(true);
              onInteract();
            }}
          >
            Reference move
          </button>
        )}
        <button
          aria-label="Fit canvas"
          onClick={() => {
            setZoomChoice("fit");
            setPan({ x: 0, y: 0 });
          }}
        >
          Fit
        </button>
        <select
          aria-label="Preview zoom"
          value={zoomChoice}
          onChange={(e) => {
            setZoomChoice(e.target.value);
            setPan({ x: 0, y: 0 });
          }}
        >
          <option value="fit">Fit · {Math.round(zoom * 100)}%</option>
          {[0.25, 0.5, 1, 2, 3, 4, 6, 8, 12].map((z) => (
            <option key={z} value={String(z)}>
              {z * 100}%
            </option>
          ))}
          {zoomChoice !== "fit" &&
            ![0.25, 0.5, 1, 2, 3, 4, 6, 8, 12].includes(zoom) && (
              <option value={zoomChoice}>{Math.round(zoom * 100)}%</option>
            )}
        </select>
      </div>
      <div
        ref={area}
        className={`viewport-area ${panMode ? "pan-active" : ""}`}
        onPointerDown={(event) => {
          if (event.button !== 1 && !(panMode && event.button === 0)) return;
          event.preventDefault();
          onInteract();
          const el = event.currentTarget;
          el.setPointerCapture(event.pointerId);
          let x = event.clientX,
            y = event.clientY;
          const move = (e: PointerEvent) => {
            const dx = e.clientX - x,
              dy = e.clientY - y;
            x = e.clientX;
            y = e.clientY;
            setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
          };
          const end = () => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", end);
            el.removeEventListener("pointercancel", end);
          };
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", end);
          el.addEventListener("pointercancel", end);
        }}
      >
        <div
          className={`canvas-stack ${background === "checker" ? "checker" : ""}`}
          style={{
            transform: `translate(calc(-50% + ${pan.x}px),calc(-50% + ${pan.y}px))`,
            width: width * zoom,
            height: height * zoom,
            backgroundColor:
              background === "dark" ? project.canvas.background : undefined,
          }}
        >
          {project.editor.reference?.visible &&
            (() => {
              const ref = project.editor.reference,
                pos = referenceDraft ?? ref.position;
              return (
                <div className={`reference-plane reference-${ref.plane}`}>
                  <img
                    alt="Canvas reference"
                    src={ref.image.data}
                    style={{
                      left: `${(pos.x / width) * 100}%`,
                      top: `${(pos.y / height) * 100}%`,
                      width: ref.image.width * ref.scale * zoom,
                      height: ref.image.height * ref.scale * zoom,
                      opacity: ref.opacity,
                    }}
                  />
                </div>
              );
            })()}
          <div
            ref={host}
            className={`pixi-host ${project.canvas.pixelArt ? "pixel-art" : ""}`}
            data-testid="pixi-viewport"
          />
          {onion && (
            <OnionSkin project={viewProject} time={time} onError={onError} />
          )}
          {grid && zoom >= 4 && (
            <svg
              className="pixel-grid"
              viewBox={`0 0 ${width} ${height}`}
              aria-hidden="true"
            >
              <defs>
                <pattern
                  id="pixel-grid"
                  width="1"
                  height="1"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M1 0H0V1"
                    stroke="#ffffff33"
                    fill="none"
                    strokeWidth={0.6 / zoom}
                  />
                </pattern>
              </defs>
              <rect width={width} height={height} fill="url(#pixel-grid)" />
            </svg>
          )}
          {guides && (
            <svg
              className="canvas-guides"
              viewBox={`0 0 ${width} ${height}`}
              onDoubleClick={(e) => {
                if (
                  panMode ||
                  inkMode ||
                  maskMode ||
                  referenceMode ||
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
                      x: rounded(
                        (dx * Math.cos(a) - dy * Math.sin(a)) / tx.scale,
                      ),
                      y: rounded(
                        (dx * Math.sin(a) + dy * Math.cos(a)) / tx.scale,
                      ),
                    },
                  ],
                });
              }}
            >
              {inkMode && addStroke && (
                <InkSurface
                  width={width}
                  height={height}
                  zoom={zoom}
                  onStroke={addStroke}
                />
              )}
              {maskMode && active && !active.locked && active.mask && (
                <MaskHandles
                  layer={active}
                  zoom={zoom}
                  width={width}
                  height={height}
                  world={world}
                  local={local}
                  onDraft={setDraft}
                  onCommit={update}
                />
              )}
              {referenceMode && project.editor.reference && updateProject && (
                <g
                  aria-label="Drag reference position"
                  className="drag-handle"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onInteract();
                    const el = event.currentTarget,
                      original = project.editor.reference!,
                      start = pointFromEvent(event);
                    let next = original.position;
                    el.setPointerCapture(event.pointerId);
                    const move = (e: PointerEvent) => {
                      const b = el
                        .closest(".canvas-stack")!
                        .getBoundingClientRect();
                      next = {
                        x: rounded(
                          original.position.x +
                            ((e.clientX - b.left) / b.width) * width -
                            start.x,
                        ),
                        y: rounded(
                          original.position.y +
                            ((e.clientY - b.top) / b.height) * height -
                            start.y,
                        ),
                      };
                      setReferenceDraft(next);
                    };
                    const cleanup = () => {
                      el.removeEventListener("pointermove", move);
                      el.removeEventListener("pointerup", end);
                      el.removeEventListener("pointercancel", cancel);
                      setReferenceDraft(null);
                    };
                    const end = () => {
                      cleanup();
                      updateProject({
                        ...project,
                        editor: {
                          ...project.editor,
                          reference: { ...original, position: next },
                        },
                      });
                    };
                    const cancel = () => cleanup();
                    el.addEventListener("pointermove", move);
                    el.addEventListener("pointerup", end);
                    el.addEventListener("pointercancel", cancel);
                  }}
                >
                  <circle
                    cx={(referenceDraft ?? project.editor.reference.position).x}
                    cy={(referenceDraft ?? project.editor.reference.position).y}
                    r={10 / zoom}
                    fill="#252333"
                    stroke="#8fd8d0"
                    strokeWidth={1 / zoom}
                  />
                  <text
                    x={
                      (referenceDraft ?? project.editor.reference.position).x +
                      12 / zoom
                    }
                    y={(referenceDraft ?? project.editor.reference.position).y}
                    fontSize={10 / zoom}
                    fill="#8fd8d0"
                  >
                    REFERENCE
                  </text>
                </g>
              )}
              <path
                pointerEvents="none"
                d={`M${width / 2} 0V${height}M0 ${height / 2}H${width}`}
                stroke="#b8b6ce"
                opacity="0.14"
                strokeWidth={1 / zoom}
                strokeDasharray={`${3 / zoom} ${3 / zoom}`}
              />
              {active &&
                active.visible &&
                !active.locked &&
                !referenceMode &&
                !inkMode &&
                !maskMode && (
                  <>
                    {"points" in active &&
                      (active.type === "path" || active.mode === "path") && (
                        <>
                          <polyline
                            points={(active.type === "path"
                              ? pathPolyline(active)
                              : active.points
                            )
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
                                  r={6 / zoom}
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
                    {active.type === "path" && active.handles && (
                      <CurveHandles
                        layer={active}
                        index={Math.min(anchorIndex, active.points.length - 1)}
                        zoom={zoom}
                        width={width}
                        height={height}
                        world={world}
                        local={local}
                        onDraft={setDraft}
                        onCommit={update}
                      />
                    )}
                    <g
                      aria-label="Drag layer position"
                      className="drag-handle"
                      onPointerDown={(e) => drag(e, null)}
                    >
                      <circle
                        cx={anchor.x}
                        cy={anchor.y}
                        r={9 / zoom}
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

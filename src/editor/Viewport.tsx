import { useEffect, useMemo, useRef, useState } from "react";
import type { Layer, Project, Vec } from "../core/model.js";
import { defaultHandles, pathPolyline } from "../core/geometry.js";
import {
  CurveHandles,
  MaskHandles,
  InkSurface,
  svgDrag,
  PenSurface,
} from "./ShapeHandles.js";
import { clamp } from "../core/math.js";
import { resolveControls } from "../core/parameters.js";
import { NumberField } from "./controls.js";
import { transformLayers } from "../core/editing.js";
import { editPathPoints } from "../core/geometry.js";
import { readableError } from "../core/errors.js";
import { layerTransform } from "../core/spatial.js";
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
    [penMode, setPenMode] = useState(false),
    [tool, setTool] = useState<"move" | "scale" | "rotate" | "points">("move"),
    [maskMode, setMaskMode] = useState(false),
    [anchorIndex, setAnchorIndex] = useState(0);
  timeRef.current = time;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        area.current?.closest("[inert]") ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      const choice = (
        { v: "move", s: "scale", r: "rotate", p: "points" } as const
      )[e.key.toLowerCase() as "v" | "s" | "r" | "p"];
      if (choice) {
        setTool(choice);
        setGuides(true);
        setPanMode(false);
        setInkMode(false);
        setPenMode(false);
        setMaskMode(false);
        setReferenceMode(false);
      }
      if (e.key.toLowerCase() === "f") {
        setZoomChoice("fit");
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const zoom =
    zoomChoice === "fit"
      ? Math.max(
          0.0001,
          Math.min(
            16,
            (room.width - Math.min(48, room.width * 0.2)) /
              project.canvas.width,
            (room.height - Math.min(48, room.height * 0.2)) /
              project.canvas.height,
          ),
        )
      : Number(zoomChoice);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const viewProject = useMemo(() => {
    let grouped = project;
    if (draft && layer && selection.length > 1) {
      try {
        grouped = transformLayers(project, selection, {
          x: draft.position.x - layer.position.x,
          y: draft.position.y - layer.position.y,
          rotation: draft.rotation - layer.rotation,
          scale: draft.scale / layer.scale,
          pivot: layer.position,
        });
      } catch {
        /* Validation on commit reports out-of-range group transforms. */
      }
    }
    return {
      ...project,
      layers: grouped.layers.map((l) => {
        const value =
          draft?.id === l.id
            ? selection.length > 1
              ? { ...draft, position: l.position, motion: l.motion }
              : draft
            : l;

        return solo
          ? { ...value, visible: l.id === solo && value.visible }
          : value;
      }),
    };
  }, [project, draft, solo, selection, layer]);
  const { renderProject, resolvedView, draftError } = useMemo(() => {
    try {
      return {
        renderProject: viewProject,
        resolvedView: resolveControls(viewProject),
        draftError: "",
      };
    } catch (error) {
      return {
        renderProject: project,
        resolvedView: resolveControls(project),
        draftError: readableError(error),
      };
    }
  }, [viewProject, project]);
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
      event.preventDefault();
      if (event.shiftKey) {
        setPan((p) => ({ x: p.x - event.deltaX - event.deltaY, y: p.y }));
        return;
      }
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
        ?.setProject(renderProject)
        .then(() => renderer.current?.render(timeRef.current))
        .catch((e) => onError(readableError(e)));
  }, [renderProject, ready]);
  useEffect(() => {
    if (ready) {
      try {
        renderer.current?.render(time);
      } catch (e) {
        onError(readableError(e));
      }
    }
  }, [time, ready]);
  const active = draftError ? layer : (draft ?? layer),
    { width, height } = project.canvas;
  const transform = (l: Layer) => {
    l = resolvedView.layers.find((value) => value.id === l.id) ?? l;
    const tx = layerTransform(l, time);
    return {
      x: tx.anchor.x,
      y: tx.anchor.y,
      rotation: (tx.rotation * Math.PI) / 180,
      scale: tx.scale,
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
  const editPoint = (action: "insert" | "remove" | "smooth" | "corner") => {
    if (active?.type !== "path" || active.locked) return;
    const index = Math.min(anchorIndex, active.points.length - 1);
    const next = editPathPoints(active, index, action);
    update({ points: next.points, handles: next.handles });
    setAnchorIndex(
      action === "remove"
        ? Math.max(0, index - 1)
        : action === "insert"
          ? index + 1
          : index,
    );
  };
  const turnOrScale = (
    event: React.PointerEvent<SVGElement>,
    kind: "scale" | "rotate",
  ) => {
    if (!active || active.locked) return;
    onInteract();
    const original = structuredClone(active),
      start = pointFromEvent(event),
      length = Math.max(
        1 / zoom,
        Math.hypot(start.x - anchor.x, start.y - anchor.y),
      ),
      angle = Math.atan2(start.y - anchor.y, start.x - anchor.x);
    const snapAngle = event.shiftKey;
    let patch: Record<string, unknown> = {};
    svgDrag(
      event,
      (point) => {
        if (kind === "scale")
          patch = {
            scale: clamp(
              (original.scale *
                Math.hypot(point.x - anchor.x, point.y - anchor.y)) /
                length,
              0.01,
              16,
            ),
          };
        else {
          let delta =
            Math.atan2(point.y - anchor.y, point.x - anchor.x) - angle;
          delta =
            (Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI;
          const value = original.rotation + delta;
          patch = {
            rotation: clamp(
              snapAngle
                ? Math.round(value / 15) * 15
                : Math.round(value * 10) / 10,
              -3600,
              3600,
            ),
          };
        }
        setDraft({ ...original, ...patch } as Layer);
      },
      () => {
        setDraft(undefined);
        if (Object.keys(patch).length) update(patch);
      },
      () => setDraft(undefined),
      width,
      height,
    );
  };
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
      penMode ||
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
        {(["move", "scale", "rotate", "points"] as const).map((value) => (
          <button
            key={value}
            aria-label={`${value[0].toUpperCase() + value.slice(1)} tool`}
            title={`${value[0].toUpperCase() + value.slice(1)} · ${value === "move" ? "V" : value === "scale" ? "S" : value === "rotate" ? "R" : "P"}`}
            aria-pressed={tool === value && !inkMode && !penMode && !panMode}
            disabled={value === "points" && !(layer && "points" in layer)}
            onClick={() => {
              setTool(value);
              setGuides(true);
              setInkMode(false);
              setPenMode(false);
              setPanMode(false);
              setMaskMode(false);
              setReferenceMode(false);
              onInteract();
            }}
          >
            {value === "move"
              ? "↔ Move"
              : value === "scale"
                ? "⤢ Scale"
                : value === "rotate"
                  ? "↻ Rotate"
                  : "◇ Points"}
          </button>
        ))}
        <details className="canvas-options">
          <summary>View options</summary>
          <div className="canvas-options-popover">
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
          </div>
        </details>
        <button
          aria-label="Pan canvas"
          aria-pressed={panMode}
          onClick={() => {
            setPanMode(!panMode);
            setInkMode(false);
            setPenMode(false);
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
              setPenMode(false);
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
        {addStroke && (
          <button
            aria-label="Pen stroke"
            aria-pressed={penMode}
            onClick={() => {
              setPenMode((v) => !v);
              setInkMode(false);
              setGuides(true);
              setPanMode(false);
              setReferenceMode(false);
              setMaskMode(false);
              onInteract();
            }}
          >
            Pen
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
              setPenMode(false);
              setTool("points");
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
              setPenMode(false);
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
              setPenMode(false);
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
        <button
          aria-label="Zoom canvas out"
          onClick={() => setZoomChoice(String(Math.max(0.125, zoom / 1.25)))}
        >
          −
        </button>
        <button
          aria-label="Zoom canvas in"
          onClick={() => setZoomChoice(String(Math.min(16, zoom * 1.25)))}
        >
          +
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
      {active?.type === "path" && tool === "points" && !inkMode && !penMode && (
        <div className="path-tools" aria-label="Path point tools">
          <span>
            Point {Math.min(anchorIndex + 1, active.points.length)} /{" "}
            {active.points.length}
          </span>
          <button
            disabled={active.locked || active.points.length >= 64}
            onClick={() => editPoint("insert")}
          >
            Insert point
          </button>
          <button
            disabled={active.locked || active.points.length <= 2}
            onClick={() => editPoint("remove")}
          >
            Delete point
          </button>
          <button disabled={active.locked} onClick={() => editPoint("smooth")}>
            Smooth point
          </button>
          <button disabled={active.locked} onClick={() => editPoint("corner")}>
            Corner point
          </button>
          <NumberField
            label="Point X"
            value={
              active.points[Math.min(anchorIndex, active.points.length - 1)].x
            }
            step={0.1}
            onChange={(x) =>
              update({
                points: active.points.map((p, i) =>
                  i === Math.min(anchorIndex, active.points.length - 1)
                    ? { ...p, x }
                    : p,
                ),
              })
            }
          />
          <NumberField
            label="Point Y"
            value={
              active.points[Math.min(anchorIndex, active.points.length - 1)].y
            }
            step={0.1}
            onChange={(y) =>
              update({
                points: active.points.map((p, i) =>
                  i === Math.min(anchorIndex, active.points.length - 1)
                    ? { ...p, y }
                    : p,
                ),
              })
            }
          />
        </div>
      )}
      {draftError && (
        <p role="alert" className="viewport-draft-error">
          {draftError} · Reduce the transform or its driving control.
        </p>
      )}
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
            width:
              zoomChoice === "fit"
                ? `min(${width * 16}px, calc(100cqw - min(48px, 20cqw)), calc((100cqh - min(48px, 20cqh)) * ${width / height}))`
                : width * zoom,
            height: zoomChoice === "fit" ? "auto" : height * zoom,
            aspectRatio: `${width} / ${height}`,
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
                      width: `${((ref.image.width * ref.scale) / width) * 100}%`,
                      height: "auto",
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
                  penMode ||
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
                const points = [
                  ...active.points,
                  {
                    x: rounded(
                      (dx * Math.cos(a) - dy * Math.sin(a)) / tx.scale,
                    ),
                    y: rounded(
                      (dx * Math.sin(a) + dy * Math.cos(a)) / tx.scale,
                    ),
                  },
                ];
                update({
                  points,
                  ...(active.type === "path" && active.handles
                    ? {
                        handles: [
                          ...active.handles,
                          { in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
                        ],
                      }
                    : {}),
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
              {penMode && addStroke && (
                <PenSurface
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
                    fontSize={12 / zoom}
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
                !penMode &&
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
                            stroke="transparent"
                            strokeWidth={16 / zoom}
                            className="drag-handle"
                            aria-label="Drag stroke"
                            onPointerDown={(e) => drag(e, null)}
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
                                  r={9 / zoom}
                                  fill="#d1c4ff"
                                  stroke="#262235"
                                  strokeWidth={1 / zoom}
                                  onPointerDown={(e) => drag(e, i)}
                                />
                                <text
                                  x={w.x + 6 / zoom}
                                  y={w.y - 5 / zoom}
                                  fontSize={12 / zoom}
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
                    {active.type === "path" &&
                      active.handles &&
                      tool === "points" && (
                        <CurveHandles
                          layer={active}
                          index={Math.min(
                            anchorIndex,
                            active.points.length - 1,
                          )}
                          zoom={zoom}
                          width={width}
                          height={height}
                          world={world}
                          local={local}
                          onDraft={setDraft}
                          onCommit={update}
                        />
                      )}
                    {(tool === "rotate" || tool === "scale") && (
                      <g
                        className="transform-gizmo"
                        onPointerDown={(e) => turnOrScale(e, tool)}
                      >
                        <line
                          x1={anchor.x}
                          y1={anchor.y}
                          x2={anchor.x + 58 / zoom}
                          y2={anchor.y - 58 / zoom}
                          stroke="#ffd590"
                          strokeWidth={2 / zoom}
                        />
                        <circle
                          aria-label={
                            tool === "rotate"
                              ? "Drag layer rotation"
                              : "Drag layer scale"
                          }
                          cx={anchor.x + 58 / zoom}
                          cy={anchor.y - 58 / zoom}
                          r={14 / zoom}
                          fill="#463724"
                          stroke="#ffd590"
                          strokeWidth={2 / zoom}
                        />
                        <text
                          x={anchor.x + 58 / zoom}
                          y={anchor.y - 53 / zoom}
                          textAnchor="middle"
                          fontSize={17 / zoom}
                          fill="#ffe9bc"
                          pointerEvents="none"
                        >
                          {tool === "rotate" ? "↻" : "⤢"}
                        </text>
                      </g>
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

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../core/model.js";
import {
  stageDefaults,
  stageSchema,
  stagePlacementSchema,
  type Stage,
} from "../core/stage.js";
import { applyEdits } from "../core/operations.js";
import { clamp } from "../core/math.js";
import { readableError } from "../core/errors.js";
import { StageRenderer } from "../render/stage.js";
import {
  exportEffect,
  zipExport,
  type ExportOptions,
} from "../render/export.js";
import { Modal } from "./Modal.js";
import { NumberField, Check, Select } from "./controls.js";
import { downloadFile, safeFilename } from "./files.js";
export function StageStudio({
  project,
  selected,
  time: initialTime,
  update,
  undo,
  redo,
  onClose,
}: {
  project: Project;
  selected?: string;
  time: number;
  update: (p: Project) => void;
  undo: () => void;
  redo: () => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<StageRenderer | null>(null),
    abort = useRef<AbortController | null>(null);
  const [ready, setReady] = useState(false),
    [draft, setDraft] = useState<Stage | null>(null),
    [error, setError] = useState(""),
    [time, setTime] = useState(Math.min(initialTime, project.duration / 2)),
    [playing, setPlaying] = useState(false),
    [guides, setGuides] = useState(true),
    [layerId, setLayerId] = useState(selected ?? project.layers[0]?.id ?? ""),
    [format, setFormat] = useState<ExportOptions["format"]>("gif"),
    [scale, setScale] = useState(2),
    [progress, setProgress] = useState<string | null>(null);
  const timeRef = useRef(time);
  timeRef.current = time;
  const stage = useMemo(
      () => draft ?? project.stage ?? stageDefaults(),
      [draft, project.stage],
    ),
    current = useMemo(() => ({ ...project, stage }), [project, stage]),
    layer = project.layers.find((l) => l.id === layerId),
    placement =
      stage.layers[layerId] ??
      stagePlacementSchema.parse({ plane: stage.plane });
  const act = (fn: () => Project) => {
    try {
      update(fn());
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  };
  const configure = (patch: Record<string, unknown>) =>
    act(() => applyEdits(project, [{ action: "configure_stage", patch }]));
  const place = (patch: Record<string, unknown>) =>
    act(() =>
      applyEdits(project, [
        { action: "place_stage_layer", id: layerId, patch },
      ]),
    );
  useEffect(() => {
    let alive = true;
    StageRenderer.create()
      .then((r) => {
        if (!alive) {
          r.destroy();
          return;
        }
        renderer.current = r;
        host.current?.append(r.canvas);
        setReady(true);
      })
      .catch((e) => setError(readableError(e)));
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && abort.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        abort.current.abort();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      alive = false;
      abort.current?.abort();
      renderer.current?.destroy();
      renderer.current = null;
      window.removeEventListener("keydown", key, true);
    };
  }, []);
  useEffect(() => {
    if (ready)
      void renderer.current
        ?.setProject(current)
        .then(() => {
          renderer.current?.setGuides(guides);
          renderer.current?.render(timeRef.current);
        })
        .catch((e) => setError(readableError(e)));
  }, [current, ready]);
  useEffect(() => {
    if (ready && !abort.current) {
      renderer.current?.setGuides(guides);
      renderer.current?.render(time);
    }
  }, [guides, time, ready]);
  useEffect(() => {
    if (!playing || progress) return;
    let frame = 0,
      last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(0.1, (now - last) / 1000);
      last = now;
      setTime((t) => (t + delta) % project.duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, progress, project.duration]);
  const exportCamera = async () => {
    if (!renderer.current || progress) return;
    setPlaying(false);
    const controller = new AbortController();
    abort.current = controller;
    setProgress("Preparing camera export…");
    setError("");
    try {
      await renderer.current.setProject(current);
      renderer.current.setGuides(false);
      const files = await exportEffect(
        renderer.current,
        current,
        { format, scale, view: "stage" },
        (done, total) => setProgress(`${done} / ${total} frames`),
        controller.signal,
      );
      downloadFile(
        zipExport(files),
        `${safeFilename(project.name)}-${stage.mode}-${format}.zip`,
        "application/zip",
      );
    } catch (e) {
      setError(
        controller.signal.aborted
          ? "Stage export cancelled."
          : readableError(e),
      );
    } finally {
      abort.current = null;
      setProgress(null);
      if (renderer.current) {
        renderer.current.setGuides(guides);
        renderer.current.render(timeRef.current);
      }
    }
  };
  const orbit = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || progress) return;
    e.preventDefault();
    setPlaying(false);
    const el = e.currentTarget,
      original = stage,
      start = { x: e.clientX, y: e.clientY };
    let next = original;
    el.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => {
      next = {
        ...original,
        azimuth: clamp(
          original.azimuth - (event.clientX - start.x) * 0.5,
          -360,
          360,
        ),
        elevation: clamp(
          original.elevation + (event.clientY - start.y) * 0.4,
          -85,
          89,
        ),
      };
      setDraft(stageSchema.parse(next));
    };
    const clean = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", cancel);
      setDraft(null);
    };
    const end = () => {
      clean();
      if (next !== original)
        configure({ azimuth: next.azimuth, elevation: next.elevation });
    };
    const cancel = () => clean();
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", cancel);
  };
  const cameraNumber = (
    label: string,
    key: keyof Stage,
    value: number,
    min: number,
    max: number,
    step = 1,
  ) => (
    <NumberField
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(value) => configure({ [key]: value })}
    />
  );
  const placementVector = (key: "position" | "rotation") =>
    (["x", "y", "z"] as const).map((axis) => (
      <NumberField
        key={axis}
        label={`Plane ${key} ${axis.toUpperCase()}`}
        value={placement[key][axis]}
        min={-4096}
        max={4096}
        step={0.1}
        onChange={(value) =>
          place({ [key]: { ...placement[key], [axis]: value } })
        }
      />
    ));
  return (
    <Modal title="2.5D / 3D Stage" onClose={onClose} busy={!!progress} wide>
      <div className="stage-studio">
        <div className="stage-toolbar">
          <button
            aria-pressed={stage.mode === "2.5d"}
            disabled={!!progress}
            onClick={() =>
              configure({ ...stageDefaults("2.5d"), layers: stage.layers })
            }
          >
            2.5D · game view
          </button>
          <button
            aria-pressed={stage.mode === "3d"}
            disabled={!!progress}
            onClick={() =>
              configure({ ...stageDefaults("3d"), layers: stage.layers })
            }
          >
            3D · free camera
          </button>
          <button
            aria-label="Undo stage edit"
            disabled={!!progress}
            onClick={() => {
              setPlaying(false);
              undo();
            }}
          >
            Undo
          </button>
          <button
            aria-label="Redo stage edit"
            disabled={!!progress}
            onClick={() => {
              setPlaying(false);
              redo();
            }}
          >
            Redo
          </button>
          <span>Drag to orbit · camera changes save with your project</span>
          <Check
            label="Stage grid & axes"
            value={guides}
            onChange={setGuides}
          />
        </div>
        <div className="stage-body">
          <div className="stage-view">
            <div
              ref={host}
              className="stage-canvas"
              style={
                {
                  "--stage-aspect":
                    project.canvas.width / project.canvas.height,
                } as React.CSSProperties
              }
              data-mode={stage.mode}
              aria-label="Stage camera viewport"
              onPointerDown={orbit}
            />
            <div className="stage-transport">
              <button
                aria-label={playing ? "Pause stage" : "Play stage"}
                disabled={!ready || !!progress}
                onClick={() => setPlaying((v) => !v)}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <input
                aria-label="Stage playhead"
                type="range"
                min={0}
                max={project.duration}
                step={1 / project.fps}
                value={time}
                disabled={!!progress}
                onChange={(e) => {
                  setPlaying(false);
                  setTime(Number(e.target.value));
                }}
              />
              <span>{time.toFixed(2)} s</span>
            </div>
            <p className="hint">
              Effect layers are textured planes in world space. Export bakes
              this camera to game-ready frames; grid and axes are preview-only.
            </p>
          </div>
          <fieldset className="stage-settings" disabled={!!progress}>
            <legend className="sr-only">Stage settings</legend>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <details open>
              <summary>View & camera</summary>
              <div className="compact-actions">
                <button
                  onClick={() =>
                    configure({
                      azimuth: 45,
                      elevation: 35.264,
                      projection: "orthographic",
                    })
                  }
                >
                  Isometric
                </button>
                <button onClick={() => configure({ azimuth: 0, elevation: 0 })}>
                  Front
                </button>
                <button
                  onClick={() => configure({ azimuth: 0, elevation: 89 })}
                >
                  Top
                </button>
              </div>
              {stage.projection === "orthographic"
                ? cameraNumber("Camera span", "span", stage.span, 16, 4096)
                : cameraNumber(
                    "Camera distance",
                    "distance",
                    stage.distance,
                    16,
                    8192,
                  )}
              <Select
                label="Default effect plane"
                value={stage.plane}
                options={["ground", "upright", "billboard"]}
                onChange={(plane) => configure({ plane })}
              />
            </details>
            <details>
              <summary>Place a layer</summary>
              <label className="field">
                <span>Layer</span>
                <select
                  aria-label="Stage layer"
                  value={layerId}
                  onChange={(e) => setLayerId(e.target.value)}
                >
                  {project.layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.locked ? " · locked" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset disabled={!!layer?.locked || !layer}>
                <Select
                  label="Layer plane"
                  value={placement.plane}
                  options={["ground", "upright", "billboard"]}
                  onChange={(plane) => place({ plane })}
                />
                <div className="three-fields">
                  {placementVector("position")}
                </div>
                <details>
                  <summary>Plane rotation & scale</summary>
                  <div className="three-fields">
                    {placementVector("rotation")}
                  </div>
                  <NumberField
                    label="Plane scale"
                    value={placement.scale}
                    min={0.01}
                    max={16}
                    step={0.05}
                    onChange={(scale) => place({ scale })}
                  />
                </details>
              </fieldset>
            </details>
            <details>
              <summary>Advanced camera</summary>
              <Select
                label="Stage projection"
                value={stage.projection}
                options={["orthographic", "perspective"]}
                onChange={(projection) => configure({ projection })}
              />
              <div className="two-fields">
                {cameraNumber(
                  "Camera azimuth",
                  "azimuth",
                  stage.azimuth,
                  -360,
                  360,
                )}
                {cameraNumber(
                  "Camera elevation",
                  "elevation",
                  stage.elevation,
                  -85,
                  89,
                )}
              </div>
              {cameraNumber(
                "Advanced camera distance",
                "distance",
                stage.distance,
                16,
                8192,
              )}
              {cameraNumber("Camera FOV", "fov", stage.fov, 15, 100)}
              {(["x", "y", "z"] as const).map((axis) => (
                <NumberField
                  key={axis}
                  label={`Camera target ${axis.toUpperCase()}`}
                  value={stage.target[axis]}
                  step={0.1}
                  onChange={(value) =>
                    configure({ target: { ...stage.target, [axis]: value } })
                  }
                />
              ))}
            </details>
            <div className="stage-export">
              <h3>Export camera</h3>
              <Select
                label="Stage export format"
                value={format!}
                options={["gif", "spritesheet", "sequence", "godot", "unity"]}
                onChange={(value) =>
                  setFormat(value as ExportOptions["format"])
                }
              />
              <NumberField
                label="Stage export scale"
                value={scale}
                min={0.125}
                max={8}
                step={0.125}
                onChange={setScale}
              />
              <button
                className="primary"
                disabled={!ready}
                onClick={() => void exportCamera()}
              >
                Export stage
              </button>
            </div>
          </fieldset>
        </div>
        {progress && (
          <div role="status" className="stage-progress">
            {progress}
            <button onClick={() => abort.current?.abort()}>
              Cancel stage export
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

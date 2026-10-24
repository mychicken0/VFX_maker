import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../core/model.js";
import {
  stageDefaults,
  stagePlacementSchema,
  type Stage,
} from "../core/stage.js";
import { applyEdits } from "../core/operations.js";
import {
  nodeCatalog,
  addCatalogNode,
  duplicateEditorLayer,
} from "../core/catalog.js";
import { readableError } from "../core/errors.js";
import { StageRenderer } from "../render/stage.js";
import {
  exportEffect,
  zipExport,
  preview,
  toBase64,
  type ExportOptions,
} from "../render/export.js";
import { StageScene, type StageTool } from "./StageScene.js";
import { Modal } from "./Modal.js";
import { NumberField, Select } from "./controls.js";
import { AddNodeMenu } from "./AddNodeMenu.js";
import { downloadFile, safeFilename } from "./files.js";
type Props = {
  project: Project;
  selected?: string;
  time: number;
  update: (p: Project) => void;
  undo: () => void;
  redo: () => void;
  onClose: () => void;
};
export function StageStudio(props: Props) {
  const { project, update, undo, redo, onClose } = props,
    propsRef = useRef(props);
  propsRef.current = props;
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<StageScene | null>(null),
    output = useRef<StageRenderer | null>(null),
    abort = useRef<AbortController | null>(null),
    previewChain = useRef<Promise<void>>(Promise.resolve()),
    lastPreview = useRef(0);
  const [ready, setReady] = useState(false),
    [draft, setDraft] = useState<Project | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [time, setTime] = useState(Math.min(props.time, project.duration * 0.35)),
    [playing, setPlaying] = useState(false),
    [overlays, setOverlays] = useState(false),
    [selected, setSelected] = useState(
      props.selected ?? project.layers[0]?.id ?? "",
    ),
    [tool, setTool] = useState<StageTool>("translate"),
    [viewMode, setViewMode] = useState<"scene" | "camera">("scene"),
    [sceneView, setSceneView] = useState<Stage>(
      project.stage ?? stageDefaults(),
    ),
    [showLayers, setShowLayers] = useState(() => window.innerWidth > 900),
    [showProperties, setShowProperties] = useState(
      () => window.innerWidth > 900,
    ),
    [addMenu, setAddMenu] = useState(false),
    [previewUrl, setPreviewUrl] = useState(""),
    [format, setFormat] = useState<ExportOptions["format"]>("gif"),
    [scale, setScale] = useState(2),
    [progress, setProgress] = useState<string | null>(null);
  const current = draft ?? project,
    stage = current.stage ?? stageDefaults(),
    layer = current.layers.find((l) => l.id === selected),
    placement =
      stage.layers[selected] ??
      stagePlacementSchema.parse({ plane: stage.plane });
  const live = useRef({ current, selected, time, viewMode, tool, overlays });
  live.current = { current, selected, time, viewMode, tool, overlays };
  const perform = (fn: () => Project) => {
    try {
      update(fn());
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  };
  const configure = (patch: Record<string, unknown>) =>
    perform(() => applyEdits(project, [{ action: "configure_stage", patch }]));
  const place = (patch: Record<string, unknown>) =>
    perform(() =>
      applyEdits(project, [
        { action: "place_stage_layer", id: selected, patch },
      ]),
    );
  const actRef = useRef({ perform, configure, place });
  actRef.current = { perform, configure, place };
  const select = (id: string) => {
    setSelected(id);
    setShowProperties(true);
  };
  useEffect(() => {
    let alive = true;
    void Promise.all([
      StageScene.create({
        select: (id) => select(id),
        draft: setDraft,
        commit: (p) => propsRef.current.update(p),
        view: setSceneView,
        interact: () => setPlaying(false),
        error: setError,
      }),
      StageRenderer.create(),
    ])
      .then(async ([s, r]) => {
        if (!alive) {
          s.destroy();
          r.destroy();
          return;
        }
        scene.current = s;
        output.current = r;
        host.current?.append(s.canvas);
        await s.setProject(live.current.current);
        s.setActive(live.current.viewMode === "scene");
        s.select(live.current.selected);
        s.setTool(live.current.tool);
        s.setTime(live.current.time);
        if (alive) setReady(true);
      })
      .catch((e) => {
        if (alive) setError(readableError(e));
      });
    const resize = new ResizeObserver(() => {
      if (host.current)
        scene.current?.setViewport(
          host.current.clientWidth,
          host.current.clientHeight,
        );
    });
    if (host.current) resize.observe(host.current);
    return () => {
      alive = false;
      resize.disconnect();
      abort.current?.abort();
      scene.current?.destroy();
      output.current?.destroy();
      scene.current = null;
      output.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    void scene.current
      ?.setProject(current, !!draft)
      .catch((e) => setError(readableError(e)));
  }, [current, ready]);
  useEffect(() => {
    if (!ready) return;
    scene.current?.select(selected);
    scene.current?.setTool(tool);
    scene.current?.setActive(viewMode === "scene" && !progress);
    scene.current?.setGuides(overlays && viewMode === "scene");
    if (host.current)
      scene.current?.setViewport(
        host.current.clientWidth,
        host.current.clientHeight,
      );
  }, [selected, tool, viewMode, overlays, ready, showLayers, showProperties]);
  useEffect(() => {
    scene.current?.setTime(time);
  }, [time, ready]);
  useEffect(() => {
    if (!project.layers.some((l) => l.id === selected))
      setSelected(project.layers[0]?.id ?? "");
  }, [project.layers, selected]);
  useEffect(() => {
    if (!ready || abort.current) return;
    let alive = true;
    const wait = Math.max(0, 125 - (performance.now() - lastPreview.current));
    const timer = setTimeout(() => {
      lastPreview.current = performance.now();
      previewChain.current = previewChain.current
        .catch(() => {})
        .then(async () => {
          const renderer = output.current;
          if (!renderer || abort.current) return;
          await renderer.setProject(current);
          if (!alive || abort.current) return;
          const png = await preview(renderer, current, time);
          if (alive && !abort.current)
            setPreviewUrl("data:image/png;base64," + toBase64(png));
        })
        .catch((e) => {
          if (alive) setError(readableError(e));
        });
    }, wait);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [current, time, ready]);
  useEffect(() => {
    if (!playing || progress) return;
    let frame = 0,
      last = performance.now(),
      elapsed = time;
    const tick = (now: number) => {
      elapsed =
        (elapsed + Math.min(0.1, (now - last) / 1000)) % project.duration;
      last = now;
      setTime(Math.floor(elapsed * project.fps) / project.fps);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, progress, project.duration, project.fps]);
  const remove = () => {
    if (!layer) return;
    perform(() =>
      applyEdits(project, [{ action: "remove_layer", id: selected }]),
    );
  };
  const duplicate = () => {
    if (!layer) return;
    const id = `${layer.type}-${crypto.randomUUID().slice(0, 8)}`;
    perform(() => duplicateEditorLayer(project, selected, id));
    setSelected(id);
  };
  const handlers = useRef({ remove, duplicate });
  handlers.current = { remove, duplicate };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (abort.current) {
          abort.current.abort();
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        if (scene.current?.cancel()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        if (addMenu) {
          setAddMenu(false);
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
      }
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        propsRef.current.onClose();
        return;
      }
      if (abort.current) return;
      if (e.shiftKey && k === "a") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setAddMenu(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        e.stopImmediatePropagation();
        scene.current?.cancel();
        if (e.shiftKey) propsRef.current.redo();
        else propsRef.current.undo();
        return;
      }
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && k === "d") {
        e.preventDefault();
        e.stopImmediatePropagation();
        handlers.current.duplicate();
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        e.stopImmediatePropagation();
        handlers.current.remove();
        return;
      }
      if (k === "g" || k === "r" || k === "s") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setTool(k === "g" ? "translate" : k === "r" ? "rotate" : "scale");
        setViewMode("scene");
        return;
      }
      if (k === "f" || e.code === "NumpadDecimal") {
        e.preventDefault();
        e.stopImmediatePropagation();
        scene.current?.frame(e.shiftKey);
        return;
      }
      if (
        e.code === "Space" &&
        !(e.target as HTMLElement).closest("button,summary,a,[role=button]")
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPlaying((v) => !v);
        return;
      }
      const preset = (
        {
          Numpad1: "front",
          Numpad3: "right",
          Numpad7: "top",
          Numpad5: "projection",
        } as const
      )[e.code as "Numpad1"];
      if (preset) {
        e.preventDefault();
        e.stopImmediatePropagation();
        scene.current?.preset(preset);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [addMenu]);
  const add = (key: string) => {
    try {
      const id = `node-${crypto.randomUUID().slice(0, 8)}`,
        result = addCatalogNode(project, key, id, selected);
      update(result.project);
      if (key.startsWith("layer:")) select(id);
      setTime(project.duration * 0.25);
      setAddMenu(false);
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  };
  const switchMode = (mode: Stage["mode"]) => {
    const defaults = stageDefaults(mode);
    configure(project.stage ? { mode, plane: defaults.plane } : defaults);
    scene.current?.setView(defaults);
    setViewMode("scene");
  };
  const alignCamera = () => {
    try {
      const view = scene.current?.currentView();
      if (!view) return;
      configure({
        projection: view.projection,
        azimuth: view.azimuth,
        elevation: view.elevation,
        distance: view.distance,
        span: view.span,
        fov: view.fov,
        target: view.target,
      });
      setViewMode("camera");
      setMessage("Export camera updated.");
    } catch (e) {
      setError(readableError(e));
    }
  };
  const exportCamera = async () => {
    if (!output.current || abort.current) return;
    setPlaying(false);
    const controller = new AbortController();
    abort.current = controller;
    setProgress("Preparing camera export…");
    setError("");
    try {
      await previewChain.current;
      const renderer = output.current;
      await renderer.setProject(project);
      const files = await exportEffect(
        renderer,
        project,
        { view: "stage", format, scale },
        (done, total) => setProgress(`${done} / ${total} frames`),
        controller.signal,
      );
      downloadFile(
        zipExport(files),
        `${safeFilename(project.name)}-${stage.mode}-${format}.zip`,
        "application/zip",
      );
      setMessage("Camera export downloaded.");
    } catch (e) {
      setError(
        controller.signal.aborted
          ? "Stage export cancelled."
          : readableError(e),
      );
    } finally {
      abort.current = null;
      setProgress(null);
      setTime((t) => t);
    }
  };
  const vector = (kind: "position" | "rotation" | "stretch") =>
    (["x", "y", "z"] as const).map((axis) => (
      <NumberField
        key={axis}
        label={`Plane ${kind} ${axis.toUpperCase()}`}
        caption={axis.toUpperCase()}
        value={placement[kind][axis]}
        min={kind === "stretch" ? 0.01 : -4096}
        max={kind === "stretch" ? 16 : 4096}
        step={kind === "stretch" ? 0.05 : 0.1}
        onChange={(value) =>
          place({ [kind]: { ...placement[kind], [axis]: value } })
        }
      />
    ));
  const cameraNumber = (
    label: string,
    key: keyof Stage,
    value: number,
    min: number,
    max: number,
  ) => (
    <NumberField
      label={label}
      value={value}
      min={min}
      max={max}
      step={1}
      onChange={(v) => configure({ [key]: v })}
    />
  );
  const sceneItems = useMemo(
    () => nodeCatalog(project, selected).filter((i) => i.category === "Layers"),
    [project, selected],
  );
  return (
    <Modal title="2.5D / 3D Stage" onClose={onClose} busy={!!progress} wide>
      <div className="stage-studio stage-editor">
        <div className="stage-toolbar">
          <div className="segmented">
            <button
              aria-pressed={viewMode === "scene"}
              onClick={() => setViewMode("scene")}
            >
              Scene
            </button>
            <button
              aria-pressed={viewMode === "camera"}
              onClick={() => setViewMode("camera")}
            >
              Camera preview
            </button>
          </div>
          <div className="segmented" aria-label="Scene type">
            <button
              aria-label="Stage scene 2.5D"
              aria-pressed={stage.mode === "2.5d"}
              disabled={!!progress}
              onClick={() => switchMode("2.5d")}
            >
              2.5D
            </button>
            <button
              aria-label="Stage scene 3D"
              aria-pressed={stage.mode === "3d"}
              disabled={!!progress}
              onClick={() => switchMode("3d")}
            >
              3D
            </button>
          </div>
          <button
            aria-pressed={showLayers}
            onClick={() => setShowLayers((v) => !v)}
          >
            Layers
          </button>
          <button
            aria-pressed={showProperties}
            onClick={() => setShowProperties((v) => !v)}
          >
            Properties
          </button>
          <button disabled={!!progress} onClick={() => setAddMenu(true)}>
            + Add layer
          </button>
          <button
            aria-label="Undo stage edit"
            disabled={!!progress}
            onClick={undo}
          >
            Undo
          </button>
          <button
            aria-label="Redo stage edit"
            disabled={!!progress}
            onClick={redo}
          >
            Redo
          </button>
          <button
            className="camera-align"
            disabled={!ready || !!progress}
            onClick={alignCamera}
          >
            Use view for export
          </button>
        </div>
        {error && (
          <p role="alert" className="workspace-error">
            {error}
            <button
              aria-label="Dismiss stage error"
              onClick={() => setError("")}
            >
              ×
            </button>
          </p>
        )}
        {message && (
          <p role="status" className="workspace-message">
            {message}
            <button
              aria-label="Dismiss stage message"
              onClick={() => setMessage("")}
            >
              ×
            </button>
          </p>
        )}
        <div
          className={`stage-body ${showLayers ? "has-layers" : ""} ${showProperties ? "has-properties" : ""}`}
        >
          {showLayers && (
            <aside className="stage-outliner" aria-label="Scene layers">
              <h3>
                Layers <small>{project.layers.length}/64</small>
              </h3>
              {project.layers
                .slice()
                .reverse()
                .map((l) => (
                  <div
                    className={`scene-layer ${selected === l.id ? "selected" : ""}`}
                    key={l.id}
                  >
                    <button
                      aria-label={`Select ${l.name}`}
                      aria-pressed={selected === l.id}
                      onClick={() => select(l.id)}
                    >
                      <span>{l.name}</span>
                      <small>{l.type}</small>
                    </button>
                    <button
                      aria-label={`${l.visible ? "Hide" : "Show"} ${l.name}`}
                      disabled={l.locked}
                      onClick={() =>
                        perform(() =>
                          applyEdits(project, [
                            {
                              action: "update_layer",
                              id: l.id,
                              patch: { visible: !l.visible },
                            },
                          ]),
                        )
                      }
                    >
                      {l.visible ? "◉" : "○"}
                    </button>
                  </div>
                ))}
              <div className="compact-actions">
                <button disabled={!layer} onClick={duplicate}>
                  Duplicate
                </button>
                <button disabled={!layer || layer.locked} onClick={remove}>
                  Delete
                </button>
              </div>
            </aside>
          )}
          <div className="stage-view">
            <div className="stage-view-tools">
              <div className="segmented">
                {(
                  [
                    ["translate", "Move", "G"],
                    ["rotate", "Rotate", "R"],
                    ["scale", "Scale", "S"],
                    ["orbit", "Orbit", ""],
                  ] as const
                ).map(([id, name, key]) => (
                  <button
                    key={id}
                    aria-label={`Stage ${name.toLowerCase()} tool`}
                    aria-pressed={tool === id && viewMode === "scene"}
                    disabled={!!progress}
                    onClick={() => {
                      setTool(id);
                      setViewMode("scene");
                    }}
                  >
                    {name} <kbd>{key}</kbd>
                  </button>
                ))}
              </div>
              <button
                disabled={!ready}
                onClick={() => scene.current?.frame(false)}
              >
                Frame selected
              </button>
              <button
                disabled={!ready}
                onClick={() => scene.current?.frame(true)}
              >
                Frame all
              </button>
              <label className="inline-check">
                <input
                  type="checkbox"
                  aria-label="Stage grid & axes"
                  checked={overlays}
                  onChange={(e) => setOverlays(e.target.checked)}
                />
                Grid
              </label>
            </div>
            <div
              ref={host}
              className={`stage-canvas ${viewMode === "camera" ? "camera-view" : ""}`}
              aria-label="Stage camera viewport"
              data-tool={tool}
              data-view={viewMode}
              tabIndex={0}
            >
              <div className="stage-view-label">
                {viewMode === "scene"
                  ? `${sceneView.projection === "orthographic" ? "Orthographic" : "Perspective"} · Scene view`
                  : `Export camera · ${project.canvas.width} × ${project.canvas.height} pixels`}
              </div>
              {viewMode === "scene" && (
                <div className="stage-navigation">
                  {(
                    [
                      ["front", "Front", "1"],
                      ["right", "Right", "3"],
                      ["top", "Top", "7"],
                      ["isometric", "Iso", ""],
                      [
                        "projection",
                        sceneView.projection === "orthographic"
                          ? "Persp"
                          : "Ortho",
                        "5",
                      ],
                    ] as const
                  ).map(([id, name, key]) => (
                    <button key={id} onClick={() => scene.current?.preset(id)}>
                      {name}
                      <kbd>{key}</kbd>
                    </button>
                  ))}
                </div>
              )}
              {viewMode === "camera" && (
                <div className="stage-camera-output">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Exact camera output preview" />
                  ) : (
                    <p>Rendering camera…</p>
                  )}
                </div>
              )}
              {ready &&
                viewMode === "scene" &&
                Math.abs(sceneView.elevation) < 3 &&
                current.layers
                  .filter((l) => l.visible)
                  .every(
                    (l) =>
                      (stage.layers[l.id]?.plane ?? stage.plane) === "ground",
                  ) && (
                  <p className="stage-edge-hint">
                    Ground planes are edge-on here. Choose Top or Iso to see the
                    effect.
                  </p>
                )}
              {!ready && (
                <p className="stage-loading" role="status">
                  Opening scene…
                </p>
              )}
            </div>
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
              <button
                onClick={() => {
                  setPlaying(false);
                  setTime(project.duration * 0.35);
                }}
              >
                Active frame
              </button>
            </div>
            <p className="stage-navigation-hint">
              Click selects · Middle drag or Alt+drag orbits · Shift+middle drag
              pans · Wheel zooms · F frames · Esc cancels
            </p>
          </div>
          {showProperties && (
            <fieldset className="stage-settings" disabled={!!progress}>
              <legend className="sr-only">Stage settings</legend>
              <h3>{layer?.name ?? "Choose a layer"}</h3>
              <label className="sr-only">
                Stage layer
                <select
                  aria-label="Stage layer"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {project.layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset disabled={!layer || layer.locked}>
                <Select
                  label="Layer plane"
                  value={placement.plane}
                  options={["ground", "upright", "billboard"]}
                  onChange={(plane) => place({ plane })}
                />
                <h4>Position</h4>
                <div className="three-fields">{vector("position")}</div>
                <details>
                  <summary>Rotation & scale</summary>
                  <div className="three-fields">{vector("rotation")}</div>
                  <NumberField
                    label="Plane scale"
                    value={placement.scale}
                    min={0.01}
                    max={16}
                    step={0.05}
                    onChange={(scale) => place({ scale })}
                  />
                  <div className="three-fields">{vector("stretch")}</div>
                </details>
              </fieldset>
              {layer?.locked && <p className="hint">This layer is locked.</p>}
              <details>
                <summary>Export camera settings</summary>
                <div className="compact-actions">
                  <button
                    onClick={() =>
                      configure({
                        ...stageDefaults("2.5d"),
                        layers: stage.layers,
                      })
                    }
                  >
                    2.5D · game view
                  </button>
                  <button
                    onClick={() =>
                      configure({
                        ...stageDefaults("3d"),
                        layers: stage.layers,
                      })
                    }
                  >
                    3D · free camera
                  </button>
                </div>
                <Select
                  label="Stage projection"
                  value={stage.projection}
                  options={["orthographic", "perspective"]}
                  onChange={(projection) => configure({ projection })}
                />
                {stage.projection === "orthographic"
                  ? cameraNumber("Camera span", "span", stage.span, 16, 4096)
                  : cameraNumber(
                      "Camera distance",
                      "distance",
                      stage.distance,
                      16,
                      8192,
                    )}
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
                <details>
                  <summary>Lens & target</summary>
                  {cameraNumber("Camera FOV", "fov", stage.fov, 15, 100)}
                  {(["x", "y", "z"] as const).map((axis) => (
                    <NumberField
                      key={axis}
                      label={`Camera target ${axis.toUpperCase()}`}
                      value={stage.target[axis]}
                      step={0.1}
                      onChange={(v) =>
                        configure({ target: { ...stage.target, [axis]: v } })
                      }
                    />
                  ))}
                </details>
              </details>
              <details>
                <summary>Exact output preview</summary>
                {previewUrl && (
                  <img
                    className="stage-output-thumbnail"
                    src={previewUrl}
                    alt="Camera output thumbnail"
                  />
                )}
                <p className="hint">
                  {project.canvas.width} × {project.canvas.height} ·
                  Camera-baked pixels
                </p>
              </details>
              <div className="stage-export">
                <h3>Export camera</h3>
                <details>
                  <summary>Format & size</summary>
                  <Select
                    label="Stage export format"
                    value={format!}
                    options={[
                      "gif",
                      "spritesheet",
                      "sequence",
                      "godot",
                      "unity",
                    ]}
                    onChange={(v) => setFormat(v as ExportOptions["format"])}
                  />
                  <NumberField
                    label="Stage export scale"
                    value={scale}
                    min={0.125}
                    max={8}
                    step={0.125}
                    onChange={setScale}
                  />
                </details>
                <button
                  className="primary"
                  disabled={!ready}
                  onClick={() => void exportCamera()}
                >
                  Export stage
                </button>
              </div>
            </fieldset>
          )}
        </div>
        {progress && (
          <div role="status" className="stage-progress">
            {progress}
            <button onClick={() => abort.current?.abort()}>
              Cancel stage export
            </button>
          </div>
        )}
        {addMenu && (
          <AddNodeMenu
            items={sceneItems}
            onChoose={add}
            onClose={() => setAddMenu(false)}
          />
        )}
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PRESETS,
  VERSION,
  readableError,
  getPreset,
  parseProject,
  parseText,
  layerSchema,
  uniqueLayerName,
  replaceAssetPng,
  inspectPng,
  type Asset,
  type Layer,
  type Project,
} from "../core/index.js";
import { VfxRenderer } from "../render/pixi.js";
import {
  exportEffect,
  preview,
  zipExport,
  toBase64,
  type ExportOptions,
} from "../render/export.js";
import { Inspector } from "./Inspector.js";
import { Timeline } from "./Timeline.js";
import { Viewport } from "./Viewport.js";
import { NumberField } from "./controls.js";
import { PixelLab, type PixelSource } from "./PixelLab.js";
import {
  RecolorDialog,
  ExportDialog,
  ResizeDialog,
  JsonDialog,
  HelpDialog,
  RecentDialog,
} from "./WorkspaceDialogs.js";
import { useStudioLayout } from "./layout.js";
import { rememberProject, listRecent, type RecentProject } from "./recent.js";
import { downloadFile as download, safeFilename as safeName } from "./files.js";
// Keep the same autosave key so existing browser projects open automatically.
const STORAGE = "vfx-maker.0.4.autosave";
const HISTORY_BYTES = 16 * 1024 * 1024;
function initial(): Project {
  try {
    const text = localStorage.getItem(STORAGE);
    if (text) return parseText(text);
  } catch {}
  return getPreset();
}
const historyWeights = new WeakMap<Project, number>();
function trimHistory(items: Project[]) {
  let bytes = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!historyWeights.has(item))
      historyWeights.set(item, JSON.stringify(item).length * 2);
    bytes += historyWeights.get(item)!;
    if (bytes > HISTORY_BYTES || items.length - i > 50) {
      items.splice(0, i + 1);
      break;
    }
  }
}
export function App() {
  const [project, setProject] = useState(initial),
    [selected, setSelected] = useState<string | undefined>(
      () => project.layers.at(-1)?.id,
    );
  const serialized = useMemo(() => JSON.stringify(project), [project]);
  const history = useRef<{ past: Project[]; future: Project[] }>({
      past: [],
      future: [],
    }),
    [historyVersion, setHistoryVersion] = useState(0);
  const [time, setTime] = useState(0.35),
    [playing, setPlaying] = useState(true),
    [tab, setTab] = useState("layers"),
    [search, setSearch] = useState(""),
    [layerSearch, setLayerSearch] = useState(""),
    [message, setMessage] = useState(""),
    [modal, setModal] = useState<
      | "export"
      | "json"
      | "help"
      | "pixels"
      | "resize"
      | "recent"
      | "recolor"
      | null
    >(null),
    [saved, setSaved] = useState(serialized),
    [storageError, setStorageError] = useState(false),
    [solo, setSolo] = useState<string>(),
    [pixelSource, setPixelSource] = useState<PixelSource | null>(null),
    [recent, setRecent] = useState<RecentProject[]>([]);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const controller = useRef<AbortController | null>(null),
    openInput = useRef<HTMLInputElement>(null),
    assetInput = useRef<HTMLInputElement>(null),
    captureGeneration = useRef(0);
  const layout = useStudioLayout();
  const toast = useCallback((text: string) => setMessage(text), []);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 7000);
    return () => clearTimeout(id);
  }, [message]);
  const commit = useCallback(
    (next: Project) => {
      const valid = parseProject(next),
        text = JSON.stringify(valid);
      if (
        new TextEncoder().encode(JSON.stringify(valid, null, 2)).length >
        4194304
      )
        throw new Error(
          "Project exceeds 4 MiB. Optimize or remove embedded textures.",
        );
      if (text === serialized) return;
      history.current.past.push(project);
      trimHistory(history.current.past);
      history.current.future = [];
      setProject(valid);
      setHistoryVersion((n) => n + 1);
    },
    [project, serialized],
  );
  // UI controls report validation errors without losing the current document.
  const safeCommit = useCallback(
    (next: Project) => {
      try {
        commit(next);
      } catch (e) {
        toast(readableError(e));
      }
    },
    [commit, toast],
  );
  const undo = useCallback(() => {
    const p = history.current.past.pop();
    if (p) {
      history.current.future.push(project);
      trimHistory(history.current.future);
      setProject(p);
      setHistoryVersion((n) => n + 1);
    }
  }, [project]);
  const redo = useCallback(() => {
    const p = history.current.future.pop();
    if (p) {
      history.current.past.push(project);
      trimHistory(history.current.past);
      setProject(p);
      setHistoryVersion((n) => n + 1);
    }
  }, [project]);
  const updateLayer = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const layer = project.layers.find((l) => l.id === id);
      if (!layer || layer.locked) return;
      safeCommit({
        ...project,
        layers: project.layers.map((l) =>
          l.id === id ? ({ ...l, ...patch } as Layer) : l,
        ),
      });
    },
    [project, safeCommit],
  );
  const update = useCallback(
    (patch: Record<string, unknown>) => {
      if (selected) updateLayer(selected, patch);
    },
    [selected, updateLayer],
  );
  const layer = project.layers.find((l) => l.id === selected);
  useEffect(() => {
    if (!project.layers.some((l) => l.id === selected))
      setSelected(project.layers.at(-1)?.id);
    if (solo && !project.layers.some((l) => l.id === solo)) setSolo(undefined);
  }, [project, selected, solo]);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE, serialized);
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
      void rememberProject(project).catch(() => {});
    }, 500);
    return () => clearTimeout(id);
  }, [project, serialized]);
  const dirty = serialized !== saved;
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      try {
        localStorage.setItem(STORAGE, serialized);
      } catch {}
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, serialized]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0,
      previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      setTime((t) => {
        const next = t + dt;
        if (next >= project.duration) {
          if (project.loop) return next % project.duration;
          setPlaying(false);
          return project.duration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, project.duration, project.loop]);
  useEffect(() => {
    if (time > project.duration) setTime(project.duration);
  }, [time, project.duration]);
  const save = useCallback(() => {
    download(
      new TextEncoder().encode(JSON.stringify(project, null, 2) + "\n"),
      safeName(project.name) + ".vfx.json",
      "application/json",
    );
    try {
      localStorage.setItem(STORAGE, serialized);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
    void rememberProject(project).catch(() => {});
    setSaved(serialized);
    toast("Project downloaded. PNG textures are embedded.");
  }, [project, serialized, toast]);
  const closeModal = useCallback(() => {
    if (progress) return;
    captureGeneration.current++;
    setModal(null);
  }, [progress]);
  const removeSelected = useCallback(() => {
    if (layer && !layer.locked)
      safeCommit({
        ...project,
        layers: project.layers.filter((l) => l.id !== layer.id),
      });
  }, [project, layer, safeCommit]);
  const duplicate = useCallback(() => {
    if (!layer || project.layers.length >= 32) return;
    const id = layer.type + "-" + crypto.randomUUID().slice(0, 8);
    const copy = {
      ...structuredClone(layer),
      id,
      name: uniqueLayerName(
        layer.name,
        project.layers.map((l) => l.name),
      ),
      locked: false,
    };
    const layers = [...project.layers];
    layers.splice(layers.indexOf(layer) + 1, 0, copy);
    safeCommit({ ...project, layers });
    setSelected(id);
  }, [project, layer, safeCommit]);
  function moveLayer(delta: number) {
    if (!layer) return;
    const layers = [...project.layers],
      at = layers.indexOf(layer),
      to = Math.max(0, Math.min(layers.length - 1, at + delta));
    layers.splice(at, 1);
    layers.splice(to, 0, layer);
    safeCommit({ ...project, layers });
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
        layout.setDrawer(null);
        return;
      }
      if (modal) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected();
      }
      if (
        layer &&
        !layer.locked &&
        !e.ctrlKey &&
        !e.metaKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        update({
          position: {
            x:
              layer.position.x +
              (e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0),
            y:
              layer.position.y +
              (e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0),
          },
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    modal,
    closeModal,
    save,
    undo,
    redo,
    duplicate,
    removeSelected,
    layer,
    update,
    layout.setDrawer,
  ]);
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("project");
    if (!token) return;
    window.history.replaceState(null, "", location.pathname);
    void fetch("/api/project", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw Error("Cannot load the project passed to Studio");
        return r.json();
      })
      .then((value) => {
        if (value) {
          const p = parseProject(value);
          setProject(p);
          setSaved(JSON.stringify(p));
          setSelected(p.layers.at(-1)?.id);
        }
      })
      .catch((e) => toast(readableError(e)));
  }, [toast]);
  function loadProject(p: Project, fromFile = false) {
    commit(p);
    setSelected(p.layers.at(-1)?.id);
    setSolo(undefined);
    setTime(0);
    setPlaying(false);
    layout.setDrawer(null);
    if (fromFile) setSaved(JSON.stringify(p));
  }
  async function open(file?: File) {
    if (!file) return;
    try {
      if (file.size > 4194304) throw Error("Project exceeds 4 MiB");
      loadProject(parseText(await file.text()), true);
      toast("Project opened.");
    } catch (e) {
      toast(readableError(e));
    }
  }
  async function importAsset(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1048576) throw Error("PNG must be at most 1 MiB");
      const bytes = new Uint8Array(await file.arrayBuffer()),
        { width, height } = inspectPng(bytes);
      const asset: Asset = {
        id: "asset-" + crypto.randomUUID().slice(0, 8),
        name: file.name.slice(0, 100),
        data: "data:image/png;base64," + toBase64(bytes),
        width,
        height,
        columns: 1,
        rows: 1,
        frames: 1,
      };
      commit({ ...project, assets: [...project.assets, asset] });
      setTab("assets");
      toast("PNG imported. Set its grid if it is a flipbook.");
    } catch (e) {
      toast(readableError(e));
    }
  }
  function add(type: Layer["type"]) {
    if (project.layers.length >= 32) return;
    if (type === "sprite" && !project.assets.length) {
      setTab("assets");
      toast("Import a PNG first, then add a sprite.");
      return;
    }
    const id = type + "-" + crypto.randomUUID().slice(0, 8),
      name = uniqueLayerName(
        `New ${type === "path" ? "stroke" : type}`,
        project.layers.map((l) => l.name),
      );
    const next = layerSchema.parse({
      id,
      type,
      name,
      position: { x: project.canvas.width / 2, y: project.canvas.height / 2 },
      duration: project.duration,
      ...(type === "path"
        ? {
            points: [
              { x: -30, y: 20 },
              { x: 0, y: -15 },
              { x: 30, y: -25 },
            ],
          }
        : {}),
      ...(type === "sprite" ? { asset: project.assets[0].id } : {}),
    });
    safeCommit({ ...project, layers: [...project.layers, next] });
    setSelected(id);
    setTab("layers");
  }
  async function openPixels() {
    setPlaying(false);
    setPixelSource(null);
    setModal("pixels");
    const generation = ++captureGeneration.current;
    let r: VfxRenderer | undefined;
    try {
      r = await VfxRenderer.create();
      await r.setProject(project);
      const bytes = await preview(r, project, time);
      if (generation === captureGeneration.current)
        setPixelSource({ name: safeName(project.name) + "-frame.png", bytes });
    } catch (e) {
      toast(readableError(e));
    } finally {
      r?.destroy();
    }
  }
  async function runExport(options: ExportOptions) {
    const abort = new AbortController();
    controller.current = abort;
    setPlaying(false);
    setProgress({
      completed: 0,
      total: Math.ceil(project.duration * project.fps),
    });
    let r: VfxRenderer | undefined;
    try {
      const snapshot = parseProject({
        ...project,
        output: {
          ...project.output,
          ...Object.fromEntries(
            Object.entries(options).filter(([key]) => key in project.output),
          ),
        },
      });
      commit(snapshot);
      r = await VfxRenderer.create();
      await r.setProject(snapshot);
      const files = await exportEffect(
        r,
        snapshot,
        options,
        (completed, total) => setProgress({ completed, total }),
        abort.signal,
      );
      abort.signal.throwIfAborted();
      download(
        zipExport(files),
        `${safeName(project.name)}-${options.format}.zip`,
        "application/zip",
      );
      toast(
        "Export downloaded with editable project, frame timing and checksums.",
      );
      setModal(null);
    } catch (e) {
      toast(abort.signal.aborted ? "Export cancelled." : readableError(e));
    } finally {
      r?.destroy();
      controller.current = null;
      setProgress(null);
    }
  }
  const separator = (panel: "left" | "right" | "timeline") => (
    <div
      className={`panel-divider divider-${panel}`}
      role="separator"
      aria-label={`Resize ${panel === "left" ? "library" : panel === "right" ? "inspector" : "timeline"}`}
      aria-orientation={panel === "timeline" ? "horizontal" : "vertical"}
      aria-valuemin={panel === "left" ? 180 : panel === "right" ? 240 : 90}
      aria-valuemax={panel === "left" ? 380 : panel === "right" ? 420 : 400}
      aria-valuenow={layout.layout[panel]}
      tabIndex={0}
      onPointerDown={(e) => layout.drag(e, panel)}
      onKeyDown={(e) => {
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        layout.resize(
          panel,
          (["ArrowLeft", "ArrowUp"].includes(e.key) ? -10 : 10) *
            (panel === "left" ? 1 : -1),
        );
      }}
    />
  );
  return (
    <div
      className={`studio ${layout.compact ? "compact" : ""} ${layout.layout.timelineOpen ? "" : "timeline-collapsed"}`}
      data-history={historyVersion}
      style={layout.style}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        if (modal) return;
        const file = e.dataTransfer.files[0];
        if (file?.name.toLowerCase().endsWith(".png")) void importAsset(file);
        else void open(file);
      }}
    >
      <header className="topbar" inert={!!modal}>
        <div className="brand-mark">
          <svg viewBox="0 0 24 24">
            <path
              d="M4 3L12 12L5 21M13 3L21 12L14 21"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            />
          </svg>
        </div>
        <div className="brand">
          VFX<span>MAKER</span>
          <small>STUDIO</small>
        </div>
        <span className="version">{VERSION}</span>
        <span className="top-divider" />
        <div className="project-label">
          {project.name}
          <span
            className={dirty ? "unsaved-dot" : "saved-dot"}
            title={dirty ? "Changes since last file download" : "Saved file"}
          />
        </div>
        <div className="spacer" />
        <button
          title="Undo (Ctrl/⌘ Z)"
          aria-label="Undo"
          disabled={!history.current.past.length}
          onClick={undo}
        >
          ↶
        </button>
        <button
          title="Redo (Ctrl/⌘ Shift Z)"
          aria-label="Redo"
          disabled={!history.current.future.length}
          onClick={redo}
        >
          ↷
        </button>
        <button onClick={() => openInput.current?.click()}>Open</button>
        <button onClick={save}>
          Save<span className="save-long"> project</span>
        </button>
        <button
          className="primary"
          onClick={() => {
            setPlaying(false);
            setModal("export");
          }}
        >
          Export ↗
        </button>
        <button aria-label="Help" onClick={() => setModal("help")}>
          ?
        </button>
      </header>
      <nav
        className="workspace-tools"
        aria-label="Workspace tools"
        inert={!!modal}
      >
        <button
          aria-pressed={layout.leftVisible}
          onClick={() => layout.toggle("left")}
        >
          Library
        </button>
        <button
          aria-pressed={layout.rightVisible}
          onClick={() => layout.toggle("right")}
        >
          Inspector
        </button>
        <button
          aria-pressed={layout.layout.timelineOpen}
          onClick={() => layout.toggle("timeline")}
        >
          Timeline
        </button>
        <span className="toolbar-separator" />
        <button onClick={() => void openPixels()}>Pixel optimizer</button>
        <button onClick={() => setModal("resize")}>Resize canvas</button>
        <button
          onClick={() => {
            setPlaying(false);
            setModal("recolor");
          }}
        >
          Recolor
        </button>
        <button
          onClick={() => {
            void listRecent()
              .then((entries) => {
                setRecent(entries);
                setModal("recent");
              })
              .catch((e) => toast(readableError(e)));
          }}
        >
          Recent
        </button>
        <button
          onClick={() => {
            layout.reset();
            toast("Workspace layout reset.");
          }}
        >
          Reset layout
        </button>
        {solo && (
          <span className="solo-notice">
            Solo preview{" "}
            <button onClick={() => setSolo(undefined)}>Show all</button>
          </span>
        )}
      </nav>
      <main className="workspace" inert={!!modal}>
        {layout.compact && layout.drawer && (
          <button
            className="drawer-backdrop"
            aria-label="Close panel"
            onClick={() => layout.setDrawer(null)}
          />
        )}
        <aside
          className={`library ${layout.leftVisible ? "panel-visible" : "panel-hidden"}`}
          aria-label="Library"
          inert={!layout.leftVisible}
        >
          <div className="library-tabs">
            {["layers", "effects", "assets"].map((t) => (
              <button
                className={tab === t ? "active" : ""}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "layers" && (
            <>
              <div className="panel-heading">
                <span>COMPOSITION</span>
                <small>{project.layers.length} / 32</small>
              </div>
              <div className="search">
                <input
                  aria-label="Search layers"
                  placeholder="Find a layer…"
                  value={layerSearch}
                  onChange={(e) => setLayerSearch(e.target.value)}
                />
              </div>
              <div className="layer-list">
                {[...project.layers]
                  .reverse()
                  .filter((l) =>
                    l.name.toLowerCase().includes(layerSearch.toLowerCase()),
                  )
                  .map((l) => (
                    <div
                      key={l.id}
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/vfx-layer", l.id)
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/vfx-layer");
                        const layers = [...project.layers],
                          from = layers.findIndex((x) => x.id === id),
                          to = layers.indexOf(l);
                        if (from < 0 || from === to) return;
                        const moved = layers.splice(from, 1)[0];
                        layers.splice(to, 0, moved);
                        safeCommit({ ...project, layers });
                      }}
                      className={`layer-row ${selected === l.id ? "selected" : ""} ${!l.visible ? "muted" : ""}`}
                    >
                      <button
                        className="layer-visibility"
                        aria-label={`${l.visible ? "Hide" : "Show"} ${l.name}`}
                        onClick={() =>
                          safeCommit({
                            ...project,
                            layers: project.layers.map((x) =>
                              x.id === l.id ? { ...x, visible: !x.visible } : x,
                            ),
                          })
                        }
                      >
                        {l.visible ? "◉" : "○"}
                      </button>
                      <button
                        className="layer-select"
                        onClick={() => setSelected(l.id)}
                      >
                        <span className={`type-dot ${l.type}`} />
                        <span>
                          {l.name}
                          <small>{l.type === "path" ? "stroke" : l.type}</small>
                        </span>
                      </button>
                      <button
                        className="lock-button"
                        title={l.locked ? "Unlock layer" : "Lock layer"}
                        aria-label={`${l.locked ? "Unlock" : "Lock"} ${l.name}`}
                        onClick={() =>
                          safeCommit({
                            ...project,
                            layers: project.layers.map((x) =>
                              x.id === l.id ? { ...x, locked: !x.locked } : x,
                            ),
                          })
                        }
                      >
                        {l.locked ? "◆" : "◇"}
                      </button>
                    </div>
                  ))}
              </div>
              <div className="layer-actions">
                <button
                  onClick={duplicate}
                  disabled={!layer || project.layers.length >= 32}
                  title="Duplicate selected layer"
                >
                  Duplicate
                </button>
                <button
                  disabled={!layer || layer.locked}
                  onClick={removeSelected}
                >
                  Delete
                </button>
                <button
                  title="Edit project as JSON"
                  onClick={() => {
                    setModal("json");
                  }}
                >
                  {"{ }"}
                </button>
              </div>
              <div className="layer-tools">
                <button
                  aria-label="Raise layer"
                  disabled={!layer || project.layers.at(-1)?.id === layer.id}
                  onClick={() => moveLayer(1)}
                >
                  ↑ Raise
                </button>
                <button
                  aria-label="Lower layer"
                  disabled={!layer || project.layers[0]?.id === layer.id}
                  onClick={() => moveLayer(-1)}
                >
                  ↓ Lower
                </button>
                <button
                  aria-label="Solo selected layer"
                  aria-pressed={!!solo}
                  disabled={!layer}
                  onClick={() =>
                    setSolo((v) => (v === selected ? undefined : selected))
                  }
                >
                  Solo
                </button>
              </div>
              <div className="add-section">
                <span className="panel-label">ADD A LAYER</span>
                <div className="add-grid">
                  {(["particles", "path", "ring", "sprite"] as const).map(
                    (type) => (
                      <button
                        key={type}
                        aria-label={`Add ${type === "path" ? "stroke" : type}`}
                        disabled={project.layers.length >= 32}
                        onClick={() => add(type)}
                      >
                        <span className={`add-icon ${type}`}>
                          {type === "particles"
                            ? "✦"
                            : type === "path"
                              ? "╱"
                              : type === "ring"
                                ? "◯"
                                : "▧"}
                        </span>
                        {type === "path"
                          ? "Stroke"
                          : type[0].toUpperCase() + type.slice(1)}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div className="library-tip">
                <span>MAKE IT YOURS</span>
                <p>
                  Select a stroke and drag its points. Every effect is a
                  starting point.
                </p>
                <button onClick={() => setTab("effects")}>
                  Browse 18 effects →
                </button>
              </div>
            </>
          )}
          {tab === "effects" && (
            <>
              <div className="search">
                <input
                  aria-label="Search effects"
                  placeholder="Search effects…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <small>{PRESETS.length}</small>
              </div>
              <div className="preset-list">
                {PRESETS.filter((p) =>
                  `${p.name} ${p.tags.join(" ")}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ).map((p, i) => (
                  <button
                    key={p.id}
                    className="preset-card"
                    onClick={() => {
                      safeCommit(getPreset(p.id));
                      setTime(0);
                      setPlaying(true);
                      setSelected(p.project.layers.at(-1)?.id);
                      setSolo(undefined);
                      layout.setDrawer(null);
                    }}
                  >
                    <div className={`preset-art art-${i % 6}`}>
                      <img
                        src={`${import.meta.env.BASE_URL}thumbnails/${p.id}.png`}
                        alt={p.name}
                      />
                      <small>{p.tags[0]}</small>
                    </div>
                    <b>{p.name}</b>
                    <p>{p.description}</p>
                  </button>
                ))}
              </div>
              <div className="library-bottom">
                Loading an effect can be undone.
              </div>
            </>
          )}
          {tab === "assets" && (
            <>
              <div className="panel-heading">
                <span>EMBEDDED TEXTURES</span>
                <small>{project.assets.length} / 8</small>
              </div>
              <button
                className="import-asset"
                onClick={() => assetInput.current?.click()}
              >
                + Import PNG / flipbook
              </button>
              <div className="asset-list">
                {project.assets.map((a) => (
                  <div className="asset-card" key={a.id}>
                    <div className="asset-preview checker">
                      <img src={a.data} alt={a.name} />
                    </div>
                    <b>{a.name}</b>
                    <small>
                      {a.width} × {a.height} · {a.frames} frames
                    </small>
                    <div className="two-fields">
                      <NumberField
                        label="Columns"
                        value={a.columns}
                        min={1}
                        max={64}
                        onChange={(columns) =>
                          safeCommit({
                            ...project,
                            assets: project.assets.map((v) =>
                              v.id === a.id ? { ...v, columns } : v,
                            ),
                          })
                        }
                      />
                      <NumberField
                        label="Rows"
                        value={a.rows}
                        min={1}
                        max={64}
                        onChange={(rows) =>
                          safeCommit({
                            ...project,
                            assets: project.assets.map((v) =>
                              v.id === a.id ? { ...v, rows } : v,
                            ),
                          })
                        }
                      />
                    </div>
                    <NumberField
                      label="Frames"
                      value={a.frames}
                      min={1}
                      max={a.columns * a.rows}
                      onChange={(frames) =>
                        safeCommit({
                          ...project,
                          assets: project.assets.map((v) =>
                            v.id === a.id ? { ...v, frames } : v,
                          ),
                        })
                      }
                    />
                    <button
                      onClick={() => {
                        setPixelSource({
                          name: a.name,
                          assetId: a.id,
                          bytes: Uint8Array.from(
                            atob(a.data.split(",")[1]),
                            (c) => c.charCodeAt(0),
                          ),
                        });
                        setModal("pixels");
                      }}
                    >
                      Optimize PNG
                    </button>
                    <button
                      onClick={() =>
                        safeCommit({
                          ...project,
                          assets: project.assets.filter((v) => v.id !== a.id),
                        })
                      }
                    >
                      Remove texture
                    </button>
                  </div>
                ))}
              </div>
              <div className="library-tip">
                <p>
                  Textures travel inside your project. Set columns, rows and
                  frame count, then select the texture on a sprite layer.
                </p>
              </div>
            </>
          )}
        </aside>{" "}
        {layout.leftVisible && !layout.compact && separator("left")}
        <div className="center-column">
          <Viewport
            project={project}
            layer={layer}
            time={time}
            update={update}
            onError={toast}
            onInteract={() => setPlaying(false)}
            solo={solo}
          />
          {layout.layout.timelineOpen && separator("timeline")}
          <Timeline
            project={project}
            selected={selected}
            select={setSelected}
            time={time}
            setTime={setTime}
            playing={playing}
            setPlaying={setPlaying}
            updateLayer={updateLayer}
          />
        </div>
        {layout.rightVisible && !layout.compact && separator("right")}
        <div
          className={`inspector-panel ${layout.rightVisible ? "panel-visible" : "panel-hidden"}`}
          inert={!layout.rightVisible}
        >
          <Inspector
            layer={layer}
            project={project}
            update={update}
            updateProject={safeCommit}
          />
        </div>
      </main>
      <footer className="statusbar" inert={!!modal}>
        <span className={storageError ? "warning" : ""}>
          {storageError
            ? "Autosave unavailable — download your project"
            : "● Local autosave on"}
        </span>
        <span className="status-shortcut">
          Ctrl / ⌘ S to save <i>·</i> No account needed
        </span>
        <div className="spacer" />
        <button onClick={() => setModal("help")}>CLI + MCP ready ↗</button>
      </footer>
      <input
        ref={openInput}
        type="file"
        hidden
        accept=".json"
        onChange={(e) => {
          void open(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={assetInput}
        type="file"
        hidden
        accept="image/png"
        onChange={(e) => {
          void importAsset(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {message && (
        <div role="status" className="toast">
          <span>{message}</span>
          <button aria-label="Dismiss message" onClick={() => setMessage("")}>
            ×
          </button>
        </div>
      )}
      {modal === "pixels" && (
        <PixelLab
          source={pixelSource}
          onSource={(source) => {
            captureGeneration.current++;
            setPixelSource(source);
          }}
          onClose={closeModal}
          initial={project.output}
          onOutput={(output) => {
            safeCommit({ ...project, output });
            closeModal();
            toast("Pixel settings applied to exports.");
          }}
          onAsset={(source, png, stats) => {
            try {
              commit(
                replaceAssetPng(
                  project,
                  source.assetId!,
                  png,
                  stats.width,
                  stats.height,
                ),
              );
              closeModal();
              toast("Texture replaced. Undo restores the original.");
            } catch (e) {
              toast(readableError(e));
            }
          }}
        />
      )}
      {modal === "export" && (
        <ExportDialog
          project={project}
          progress={progress}
          onClose={closeModal}
          onExport={(options) => void runExport(options)}
          onCancel={() => controller.current?.abort()}
        />
      )}
      {modal === "recolor" && (
        <RecolorDialog
          project={project}
          selected={selected}
          time={time}
          onApply={commit}
          onClose={closeModal}
        />
      )}
      {modal === "resize" && (
        <ResizeDialog project={project} onApply={commit} onClose={closeModal} />
      )}
      {modal === "json" && (
        <JsonDialog project={project} onApply={commit} onClose={closeModal} />
      )}
      {modal === "recent" && (
        <RecentDialog
          entries={recent}
          onLoad={(p) => loadProject(parseProject(p))}
          onClose={closeModal}
        />
      )}
      {modal === "help" && <HelpDialog onClose={closeModal} />}
    </div>
  );
}

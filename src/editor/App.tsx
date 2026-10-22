import { useCallback, useEffect, useRef, useState } from "react";
import {
  PRESETS,
  readableError,
  getPreset,
  parseProject,
  parseText,
  layerSchema,
  type Asset,
  type Layer,
  type Project,
} from "../core/index.js";
import { VfxRenderer } from "../render/pixi.js";
import {
  exportEffect,
  zipExport,
  type ExportOptions,
} from "../render/export.js";
import { Inspector } from "./Inspector.js";
import { Timeline } from "./Timeline.js";
import { Viewport } from "./Viewport.js";
import { NumberField, Select } from "./controls.js";
const STORAGE = "vfx-maker.0.4.autosave";
function initial(): Project {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) return parseText(saved);
  } catch {
    /* An invalid autosave must not prevent opening the editor. */
  }
  return getPreset();
}
function download(
  bytes: Uint8Array,
  name: string,
  mime = "application/octet-stream",
) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: mime }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safeName = (s: string) =>
  s.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-|-$/g, "") || "effect";
export function App() {
  const [project, setProject] = useState(initial),
    [selected, setSelected] = useState<string | undefined>(
      () => project.layers.at(-1)?.id,
    );
  const history = useRef<{ past: Project[]; future: Project[] }>({
      past: [],
      future: [],
    }),
    [historyVersion, setHistoryVersion] = useState(0);
  const [time, setTime] = useState(0.35),
    [playing, setPlaying] = useState(true),
    [tab, setTab] = useState("layers"),
    [search, setSearch] = useState(""),
    [message, setMessage] = useState(""),
    [modal, setModal] = useState<"export" | "json" | "help" | null>(null),
    [jsonDraft, setJsonDraft] = useState(""),
    [saved, setSaved] = useState(JSON.stringify(project)),
    [storageError, setStorageError] = useState(false);
  const [format, setFormat] = useState("gif"),
    [scale, setScale] = useState(3),
    [progress, setProgress] = useState<{
      completed: number;
      total: number;
    } | null>(null);
  const controller = useRef<AbortController | null>(null),
    openInput = useRef<HTMLInputElement>(null),
    assetInput = useRef<HTMLInputElement>(null);
  const toast = useCallback((text: string) => setMessage(text), []);
  useEffect(() => {
    if (message) {
      const id = setTimeout(() => setMessage(""), 7000);
      return () => clearTimeout(id);
    }
  }, [message]);
  const commit = useCallback(
    (next: Project) => {
      try {
        const valid = parseProject(next);
        if (JSON.stringify(valid) === JSON.stringify(project)) return;
        history.current.past.push(project);
        if (history.current.past.length > 50) history.current.past.shift();
        history.current.future = [];
        setProject(valid);
        setHistoryVersion((n) => n + 1);
      } catch (e) {
        toast(readableError(e));
      }
    },
    [project, toast],
  );
  const undo = useCallback(() => {
    const previous = history.current.past.pop();
    if (previous) {
      history.current.future.push(project);
      setProject(previous);
      setHistoryVersion((n) => n + 1);
    }
  }, [project]);
  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (next) {
      history.current.past.push(project);
      setProject(next);
      setHistoryVersion((n) => n + 1);
    }
  }, [project]);
  const updateLayer = (id: string, patch: Record<string, unknown>) => {
    const l = project.layers.find((l) => l.id === id);
    if (!l || l.locked) return;
    commit({
      ...project,
      layers: project.layers.map((l) =>
        l.id === id ? ({ ...l, ...patch } as Layer) : l,
      ),
    });
  };
  const layer = project.layers.find((l) => l.id === selected);
  const update = (patch: Record<string, unknown>) =>
    selected && updateLayer(selected, patch);
  useEffect(() => {
    if (!project.layers.some((l) => l.id === selected))
      setSelected(project.layers.at(-1)?.id);
  }, [project, selected]);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(project));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    }, 500);
    return () => clearTimeout(id);
  }, [project]);
  const dirty = JSON.stringify(project) !== saved;
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(project));
      } catch {}
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, project]);
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
  }, [project.duration, time]);
  const save = useCallback(() => {
    download(
      new TextEncoder().encode(JSON.stringify(project, null, 2) + "\n"),
      safeName(project.name) + ".vfx.json",
      "application/json",
    );
    try {
      localStorage.setItem(STORAGE, JSON.stringify(project));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
    setSaved(JSON.stringify(project));
    toast("Project downloaded. PNG textures are embedded in the file.");
  }, [project, toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !progress) setModal(null);
      const input = (e.target as HTMLElement).closest(
        "input,textarea,select,[contenteditable]",
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
      if (input || modal) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, save, modal, progress]);
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("project");
    if (!token) return;
    window.history.replaceState(null, "", location.pathname);
    void fetch("/api/project", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Cannot load the project passed to Studio");
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
  }, []);
  async function open(file?: File) {
    if (!file) return;
    try {
      if (file.size > 4194304) throw new Error("Project exceeds 4 MiB");
      const p = parseText(await file.text());
      commit(p);
      setSelected(p.layers.at(-1)?.id);
      setSaved(JSON.stringify(p));
      setTime(0);
      setPlaying(false);
      toast("Project opened.");
    } catch (e) {
      toast(readableError(e));
    }
  }
  async function importAsset(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1048576) throw new Error("PNG must be at most 1 MiB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.slice(0, 8).join(",") !== "137,80,78,71,13,10,26,10")
        throw new Error("Choose a PNG image");
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const img = new Image();
      img.src = data;
      await img.decode();
      const asset: Asset = {
        id: "asset-" + crypto.randomUUID().slice(0, 8),
        name: file.name,
        data,
        width: img.width,
        height: img.height,
        columns: 1,
        rows: 1,
        frames: 1,
      };
      commit({ ...project, assets: [...project.assets, asset] });
      toast("PNG imported. Set its grid below if it is a flipbook.");
    } catch (e) {
      toast(readableError(e));
    }
  }
  function add(type: Layer["type"]) {
    if (type === "sprite" && !project.assets.length) {
      setTab("assets");
      toast("Import a PNG first, then add a sprite layer.");
      return;
    }
    const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
    const newLayer = layerSchema.parse({
      id,
      type,
      name: `New ${type === "path" ? "stroke" : type}`,
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
    commit({ ...project, layers: [...project.layers, newLayer] });
    setSelected(id);
    setTab("layers");
  }
  function duplicate() {
    if (!layer) return;
    const id = layer.type + "-" + crypto.randomUUID().slice(0, 8),
      copy = {
        ...structuredClone(layer),
        id,
        name: layer.name + " copy",
        locked: false,
      };
    const layers = [...project.layers];
    layers.splice(layers.indexOf(layer) + 1, 0, copy);
    commit({ ...project, layers });
    setSelected(id);
  }
  async function runExport() {
    const abort = new AbortController();
    controller.current = abort;
    setProgress({
      completed: 0,
      total: Math.ceil(project.duration * project.fps),
    });
    let r: VfxRenderer | undefined;
    try {
      r = await VfxRenderer.create();
      await r.setProject(project);
      const files = await exportEffect(
        r,
        project,
        { format, scale } as ExportOptions,
        (completed, total) => setProgress({ completed, total }),
        abort.signal,
      );
      abort.signal.throwIfAborted();
      download(
        zipExport(files),
        `${safeName(project.name)}-${format}.zip`,
        "application/zip",
      );
      toast(
        "Export complete. ZIP includes your editable project and timing metadata.",
      );
      setModal(null);
    } catch (e) {
      toast(abort.signal.aborted ? "Export cancelled." : String(e));
    } finally {
      r?.destroy();
      controller.current = null;
      setProgress(null);
    }
  }
  return (
    <div className="studio" data-history={historyVersion}>
      <header className="topbar">
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
        <span className="version">0.4.0</span>
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
        <span className="top-divider" />
        <button onClick={() => openInput.current?.click()}>Open</button>
        <button onClick={save}>Save project</button>
        <button className="primary" onClick={() => setModal("export")}>
          Export <span>↗</span>
        </button>
        <button aria-label="Help" onClick={() => setModal("help")}>
          ?
        </button>
      </header>
      <main className="workspace">
        <aside className="library">
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
              <div className="layer-list">
                {[...project.layers].reverse().map((l) => (
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
                      commit({ ...project, layers });
                    }}
                    className={`layer-row ${selected === l.id ? "selected" : ""} ${!l.visible ? "muted" : ""}`}
                  >
                    <button
                      className="layer-visibility"
                      aria-label={`${l.visible ? "Hide" : "Show"} ${l.name}`}
                      onClick={() =>
                        commit({
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
                        commit({
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
                  disabled={!layer}
                  title="Duplicate selected layer"
                >
                  Duplicate
                </button>
                <button
                  disabled={!layer || layer.locked}
                  onClick={() => {
                    if (layer)
                      commit({
                        ...project,
                        layers: project.layers.filter((l) => l.id !== layer.id),
                      });
                  }}
                >
                  Delete
                </button>
                <button
                  title="Edit project as JSON"
                  onClick={() => {
                    setJsonDraft(JSON.stringify(project, null, 2));
                    setModal("json");
                  }}
                >
                  {"{ }"}
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
                      commit(getPreset(p.id));
                      setTime(0);
                      setPlaying(true);
                      setSelected(p.project.layers.at(-1)?.id);
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
                          commit({
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
                          commit({
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
                        commit({
                          ...project,
                          assets: project.assets.map((v) =>
                            v.id === a.id ? { ...v, frames } : v,
                          ),
                        })
                      }
                    />
                    <button
                      onClick={() =>
                        commit({
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
        </aside>
        <div className="center-column">
          <Viewport
            project={project}
            layer={layer}
            time={time}
            update={update}
            onError={toast}
            onInteract={() => setPlaying(false)}
          />
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
        <Inspector
          layer={layer}
          project={project}
          update={update}
          updateProject={commit}
        />
      </main>
      <footer className="statusbar">
        <span className={storageError ? "warning" : ""}>
          {storageError
            ? "Autosave unavailable — download your project"
            : "● Local autosave on"}
        </span>
        <span>
          Ctrl / ⌘ S to save <i>·</i> No account needed
        </span>
        <div className="spacer" />
        <button onClick={() => setModal("help")}>CLI + MCP ready ↗</button>
      </footer>
      <input
        ref={openInput}
        type="file"
        hidden
        accept=".json,.vfxproj"
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
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!progress) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "json" ? "json-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "export"
                ? "Export effect"
                : modal === "json"
                  ? "Project JSON"
                  : "Studio help"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>
                {modal === "export"
                  ? "Export your effect"
                  : modal === "json"
                    ? "Project source"
                    : "Your VFX workspace"}
              </h2>
              <button
                disabled={!!progress}
                aria-label="Close dialog"
                onClick={() => setModal(null)}
              >
                ×
              </button>
            </div>
            {modal === "export" && (
              <>
                <p>
                  Render with the same PixiJS engine as your preview. Every ZIP
                  includes the editable project and frame timing metadata.
                </p>
                <Select
                  label="Export format"
                  value={format}
                  options={["gif", "spritesheet", "sequence", "godot", "unity"]}
                  onChange={setFormat}
                />
                {format === "gif" && (
                  <>
                    <NumberField
                      label="GIF scale"
                      value={scale}
                      min={1}
                      max={8}
                      onChange={setScale}
                    />
                    <label className="field">
                      <span>GIF background</span>
                      <input
                        aria-label="GIF background"
                        type="color"
                        value={project.canvas.background}
                        onChange={(e) =>
                          commit({
                            ...project,
                            canvas: {
                              ...project.canvas,
                              background: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <p className="hint">
                      GIF uses an opaque background. PNG exports preserve
                      transparency. GIF timing rounds cumulative frame times to
                      centiseconds.
                    </p>
                  </>
                )}
                {["godot", "unity"].includes(format) && (
                  <p className="hint">
                    Exports a baked atlas animation for{" "}
                    {format === "godot"
                      ? "Godot 4"
                      : "Unity 2022.3+ (2D Sprite package)"}
                    , with import instructions.
                  </p>
                )}
                <div className="export-summary">
                  <span>
                    {Math.ceil(project.duration * project.fps)} frames
                  </span>
                  <span>
                    {project.canvas.width} × {project.canvas.height}
                  </span>
                  <span>{project.fps} fps</span>
                </div>
                {progress ? (
                  <>
                    <progress max={progress.total} value={progress.completed} />
                    <p className="hint">
                      Rendering {progress.completed} / {progress.total}
                    </p>
                    <button onClick={() => controller.current?.abort()}>
                      Cancel export
                    </button>
                  </>
                ) : (
                  <button
                    className="primary wide"
                    onClick={() => void runExport()}
                  >
                    Render & download ZIP ↗
                  </button>
                )}
              </>
            )}
            {modal === "json" && (
              <>
                <p>
                  Optional source editing. All changes are validated before
                  applying.
                </p>
                <textarea
                  aria-label="Project JSON source"
                  spellCheck={false}
                  value={jsonDraft}
                  onChange={(e) => setJsonDraft(e.target.value)}
                />
                <button
                  className="primary"
                  onClick={() => {
                    try {
                      const p = parseText(jsonDraft);
                      commit(p);
                      setModal(null);
                    } catch (e) {
                      toast(readableError(e));
                    }
                  }}
                >
                  Apply changes
                </button>
              </>
            )}
            {modal === "help" && (
              <>
                <p>
                  Build an effect from layers, or start with one of 18 editable
                  examples. The project is stored locally in your browser;
                  download a project file to share it or continue on another
                  device.
                </p>
                <dl>
                  <dt>Drag in preview</dt>
                  <dd>
                    Move the center handle to position a layer. Move numbered
                    points to reshape a stroke; double-click to add a point.
                  </dd>
                  <dt>Keyframes</dt>
                  <dd>
                    Expand a curve to edit time, value and easing. Double-click
                    its graph to add a key.
                  </dd>
                  <dt>Timeline</dt>
                  <dd>
                    Drag a clip to change its start; drag its right edge to
                    change duration. Space plays or pauses.
                  </dd>
                  <dt>Use in any folder</dt>
                  <dd>
                    <code>vfx studio effect.vfx.json</code>
                    <br />
                    <code>
                      vfx export effect.vfx.json --format gif --out render
                    </code>
                  </dd>
                  <dt>Connect an agent</dt>
                  <dd>
                    <code>
                      codex mcp add vfx -- vfx-mcp --root /path/to/effects
                    </code>
                  </dd>
                </dl>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

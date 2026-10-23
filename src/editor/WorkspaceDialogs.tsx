import { useMemo, useState } from "react";
import { exportPlan, type ExportOptions } from "../core/export-options.js";
import {
  recolorProject,
  resizeProject,
  setProjectGradient,
} from "../core/authoring.js";
import { parseText, type Project } from "../core/model.js";
import { readableError } from "../core/errors.js";
import { Viewport } from "./Viewport.js";
import { Modal } from "./Modal.js";
import { NumberField, Select, Check, GradientEditor } from "./controls.js";
import type { Gradient } from "../core/model.js";
import { type RecentProject, removeRecent } from "./recent.js";

export function ExportDialog({
  project,
  progress,
  onClose,
  onExport,
  onCancel,
}: {
  project: Project;
  progress: { completed: number; total: number } | null;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  onCancel: () => void;
}) {
  const [format, setFormat] = useState<ExportOptions["format"]>("gif"),
    [settings, setSettings] = useState(project.output),
    [padding, setPadding] = useState(2),
    [extrude, setExtrude] = useState(false);
  const [rangeOnly, setRangeOnly] = useState(false);
  const range =
    rangeOnly && project.editor.range
      ? { start: project.editor.range.start, end: project.editor.range.end }
      : {};
  let error = "",
    summary = "";
  try {
    const plan = exportPlan(project, {
      format,
      ...settings,
      padding,
      extrude,
      ...range,
    });
    summary = `${plan.count} frames · ${plan.width} × ${plan.height} · ${plan.fps} fps${plan.atlas ? ` · atlas ${plan.atlas.width} × ${plan.atlas.height}` : ""}`;
  } catch (e) {
    error = readableError(e);
  }
  return (
    <Modal title="Export effect" onClose={onClose} busy={!!progress}>
      <p>
        Every ZIP includes the editable project, frame timing and SHA-256 file
        checksums.
      </p>
      <fieldset disabled={!!progress}>
        <Select
          label="Export format"
          value={format ?? "gif"}
          options={["gif", "spritesheet", "sequence", "godot", "unity"]}
          onChange={(f) => setFormat(f as ExportOptions["format"])}
        />
        <Select
          label="Export scale"
          value={String(settings.scale)}
          options={[
            ...new Set([
              "0.125",
              "0.25",
              "0.5",
              "1",
              "2",
              "3",
              "4",
              "8",
              String(settings.scale),
            ]),
          ]}
          onChange={(scale) =>
            setSettings((s) => ({ ...s, scale: Number(scale) }))
          }
        />
        {project.editor.range && (
          <Check
            label="Export only loop range"
            value={rangeOnly}
            onChange={setRangeOnly}
          />
        )}
        <details className="advanced-export">
          <summary>Advanced export settings</summary>
          <div className="two-fields">
            <Select
              label="Export colors"
              value={String(settings.colors)}
              options={[
                ...new Set([
                  "0",
                  "4",
                  "8",
                  "16",
                  "32",
                  "64",
                  "128",
                  "256",
                  String(settings.colors),
                ]),
              ]}
              onChange={(colors) =>
                setSettings((s) => ({ ...s, colors: Number(colors) }))
              }
            />
            <Select
              label="Export alpha levels"
              value={String(settings.alphaLevels)}
              options={[
                ...new Set([
                  "0",
                  "2",
                  "4",
                  "8",
                  "16",
                  "32",
                  "64",
                  "256",
                  String(settings.alphaLevels),
                ]),
              ]}
              onChange={(alphaLevels) =>
                setSettings((s) => ({ ...s, alphaLevels: Number(alphaLevels) }))
              }
            />
          </div>
          <NumberField
            label="Export pixel block"
            value={settings.pixelSize}
            min={1}
            max={16}
            onChange={(pixelSize) => setSettings((s) => ({ ...s, pixelSize }))}
          />
          <Check
            label="Export dithering"
            value={settings.dither}
            onChange={(dither) => setSettings((s) => ({ ...s, dither }))}
          />
          {!["gif", "sequence"].includes(format ?? "gif") && (
            <div className="two-fields">
              <NumberField
                label="Atlas padding"
                value={padding}
                min={0}
                max={16}
                onChange={setPadding}
              />
              <Check
                label="Extrude edges"
                value={extrude}
                onChange={setExtrude}
              />
            </div>
          )}
        </details>
      </fieldset>
      <p className="hint">
        0 colors/alpha keeps source values. Palette, alpha, pixel block and
        scale changes can lose detail. PNG encoding preserves the resulting
        pixels.
      </p>
      {format === "gif" && (
        <p className="hint">
          GIF uses the canvas background ({project.canvas.background}) and a
          shared palette across frames. PNG preserves transparency.
        </p>
      )}
      {format === "godot" && (
        <p className="hint">Includes a Godot 4 SpriteFrames resource.</p>
      )}
      {format === "unity" && (
        <p className="hint">
          Includes a Unity 2022.3+ importer; requires the 2D Sprite package.
        </p>
      )}
      <div className="export-summary">{summary}</div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {progress ? (
        <>
          <progress value={progress.completed} max={progress.total} />
          <p role="status">
            {progress.completed === 0
              ? "Sampling frames and preparing palette…"
              : progress.completed === progress.total
                ? "Finalizing files…"
                : `Encoding ${progress.completed} / ${progress.total}`}
          </p>
          <button onClick={onCancel}>Cancel export</button>
        </>
      ) : (
        <button
          className="primary wide"
          disabled={!!error}
          onClick={() =>
            onExport({ format, ...settings, padding, extrude, ...range })
          }
        >
          Render & download ZIP ↗
        </button>
      )}
    </Modal>
  );
}
export function ResizeDialog({
  project,
  onApply,
  onClose,
}: {
  project: Project;
  onApply: (p: Project) => void;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(project.canvas.width),
    [height, setHeight] = useState(project.canvas.height),
    [mode, setMode] = useState<"scale" | "canvas">("scale");
  let next: Project | undefined,
    error = "";
  try {
    next = resizeProject(project, width, height, mode);
  } catch (e) {
    error = readableError(e);
  }
  return (
    <Modal title="Resize canvas" onClose={onClose}>
      <p>
        Scale the composition uniformly to fit, or change its canvas bounds.
        This is one undoable edit.
      </p>
      <div className="two-fields">
        <NumberField
          label="New canvas width"
          value={width}
          min={16}
          max={512}
          onChange={setWidth}
        />
        <NumberField
          label="New canvas height"
          value={height}
          min={16}
          max={512}
          onChange={setHeight}
        />
      </div>
      <Select
        label="Resize behavior"
        value={mode}
        options={["scale", "canvas"]}
        onChange={(m) => setMode(m as typeof mode)}
      />
      <p className="hint">
        {mode === "scale"
          ? "Scale: centers the composition and scales positions, motion and layer sizes together. Locked layers participate in this whole-project change."
          : "Canvas: crops or expands the canvas; layer positions and sizes stay the same."}
      </p>
      <p>
        {project.canvas.width} × {project.canvas.height} → {width} × {height}
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={!next}
        onClick={() => {
          if (next) {
            onApply(next);
            onClose();
          }
        }}
      >
        Apply resize
      </button>
    </Modal>
  );
}
export function JsonDialog({
  project,
  onApply,
  onClose,
}: {
  project: Project;
  onApply: (p: Project) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(JSON.stringify(project, null, 2)),
    [error, setError] = useState("");
  return (
    <Modal title="Project JSON" wide onClose={onClose}>
      <p>All changes are validated before applying.</p>
      <textarea
        className="project-json"
        aria-label="Project JSON source"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <button
        className="primary"
        onClick={() => {
          try {
            onApply(parseText(text));
            onClose();
          } catch (e) {
            setError(readableError(e));
          }
        }}
      >
        Apply changes
      </button>
    </Modal>
  );
}
export function RecentDialog({
  entries,
  onLoad,
  onClose,
}: {
  entries: RecentProject[];
  onLoad: (p: Project) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState(entries),
    [error, setError] = useState("");
  return (
    <Modal title="Recent projects" onClose={onClose}>
      <p>
        Up to eight project names are backed up in this browser. Download a
        project file for a portable copy.
      </p>
      {!items.length && (
        <p>No backups yet. Make an edit or save a project to create one.</p>
      )}
      <div className="recent-list">
        {items.map((e) => (
          <div key={e.name}>
            <button
              onClick={() => {
                onLoad(e.project);
                onClose();
              }}
            >
              <b>{e.name}</b>
              <small>
                {new Date(e.updated).toLocaleString()} ·{" "}
                {e.project.layers.length} layers
              </small>
            </button>
            <button
              aria-label={`Forget ${e.name}`}
              onClick={() => {
                void removeRecent(e.name)
                  .then(() =>
                    setItems((i) => i.filter((v) => v.name !== e.name)),
                  )
                  .catch((e) => setError(readableError(e)));
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Studio help" onClose={onClose}>
      <p>
        Start with an editable effect, reshape its layers and export an
        animation. Projects and textures stay on your device.
      </p>
      <dl>
        <dt>Preview</dt>
        <dd>
          Drag the center or numbered points. Double-click to add points. Fit
          recenters; Hand or middle mouse pans; Ctrl/⌘ wheel zooms around the
          pointer. Grid appears at 400% or higher.
        </dd>
        <dt>Keyboard</dt>
        <dd>
          Space: play/pause. Ctrl/⌘ S: save. Ctrl/⌘ Shift S: Save As. Ctrl/⌘ Z /
          Shift Z: undo/redo. Ctrl/⌘ D: duplicate. Delete: remove unlocked
          layer. Arrow keys: move one pixel; Shift: ten.
        </dd>
        <dt>Saving and recovery</dt>
        <dd>
          Save writes the connected file and retains five distinct backups.
          Project menu contains Save As, Download project and File backups.
          Unsaved browser work can be recovered after reopening. Use the same
          browser profile and Studio address to access browser recovery.
        </dd>
        <dt>Selection and drawing</dt>
        <dd>
          Ctrl/⌘-click or Shift-click layers to select several. Group them and
          apply transforms together. Freehand draws a new stroke; Bezier edits
          tangents. Enable Layer mask in the Inspector, then use Mask edit.
        </dd>
        <dt>Animation and reference</dt>
        <dd>
          Keyframes opens the timeline graph: double-click to add, drag to edit.
          Onion shows adjacent frames. Loop range repeats a work area without
          trimming exports. Reference images help preview size and placement;
          they are excluded from exported files.
        </dd>
        <dt>Workspace</dt>
        <dd>
          Toggle Library, Inspector and Timeline. Drag the dividers or focus a
          divider and use arrow keys. Layout is remembered locally. On narrow
          screens panels open as drawers.
        </dd>
        <dt>Pixel optimizer</dt>
        <dd>
          Compare a current frame or PNG before/after. Reduce colors, alpha
          levels, resolution or block pixels. Apply settings to exports or
          replace an embedded texture.
        </dd>
        <dt>Terminal</dt>
        <dd>
          <code>vfx studio effect.vfx.json</code>
          <br />
          <code>vfx optimize image.png --out smaller.png --colors 32</code>
        </dd>
        <dt>Agents via MCP</dt>
        <dd>
          <code>codex mcp add vfx -- vfx-mcp --root /path/to/effects</code>
          <p>
            Ask the agent to observe a storyboard, preview its edits, then
            verify the saved effect. Observations include images, layer IDs and
            canvas coordinates. If your AI app hides images, the agent can save
            a PNG for its image viewer or read the position data.
          </p>
        </dd>
      </dl>
    </Modal>
  );
}

export function RecolorDialog({
  project,
  selected,
  time,
  onApply,
  onClose,
}: {
  project: Project;
  selected?: string;
  time: number;
  onApply: (p: Project) => void;
  onClose: () => void;
}) {
  const [hue, setHue] = useState(0),
    [colorMode, setColorMode] = useState("Rotate hue"),
    [gradient, setGradient] = useState<Gradient>([{ t: 0, color: "#804cff" }]),
    [includeLocked, setIncludeLocked] = useState(false),
    [scope, setScope] = useState("all");
  const next = useMemo(
    () =>
      colorMode === "Set gradient"
        ? setProjectGradient(
            project,
            gradient,
            includeLocked,
            scope === "selected" && selected ? [selected] : undefined,
          )
        : recolorProject(
            project,
            hue,
            includeLocked,
            scope === "selected" && selected ? [selected] : undefined,
          ),
    [project, hue, includeLocked, scope, selected, colorMode, gradient],
  );
  const swatches = [
    ...new Map(
      project.layers.flatMap((l, j) =>
        l.colors.map((s, i) => {
          const to =
            next.layers[j].colors[Math.min(i, next.layers[j].colors.length - 1)]
              .color;
          return [s.color + to, { from: s.color, to }] as const;
        }),
      ),
    ).values(),
  ].slice(0, 24);
  const [error, setError] = useState("");
  return (
    <Modal title="Recolor effect" wide onClose={onClose}>
      <p>
        Rotate existing colors, or set a new gradient to color gray smoke too.
        Texture pixels and canvas background stay unchanged.
      </p>
      <div className="recolor-layout">
        <div className="recolor-preview">
          <Viewport
            project={next}
            time={time}
            update={() => {}}
            onError={setError}
            onInteract={() => {}}
          />
        </div>
        <div>
          <Select
            label="Recolor scope"
            value={scope}
            options={selected ? ["all", "selected"] : ["all"]}
            onChange={setScope}
          />
          <Select
            label="Color action"
            value={colorMode}
            options={["Rotate hue", "Set gradient"]}
            onChange={setColorMode}
          />
          {colorMode === "Set gradient" ? (
            <>
              <GradientEditor stops={gradient} onChange={setGradient} />
              <p className="hint">
                Sets gradient/tint colors directly. Hue controls are neutralized
                for changed layers so the requested colors stay exact.
              </p>
            </>
          ) : (
            <>
              <NumberField
                label="Hue rotation"
                value={hue}
                min={-180}
                max={180}
                onChange={setHue}
                unit="°"
              />
              <input
                aria-label="Hue slider"
                type="range"
                min={-180}
                max={180}
                step={1}
                value={hue}
                onChange={(e) => setHue(Number(e.target.value))}
              />
            </>
          )}
          <Check
            label="Include locked layers"
            value={includeLocked}
            onChange={setIncludeLocked}
          />
          <div className="hue-swatches">
            {swatches.map(({ from, to }) => (
              <div key={from + to} title={`${from} → ${to}`}>
                <span style={{ background: from }} />
                <span style={{ background: to }} />
              </div>
            ))}
          </div>
          <p className="hint">
            Preview is paused at {time.toFixed(2)}s. Apply makes one undoable
            edit. Locked layers are skipped by default.
          </p>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <button
            className="primary"
            disabled={!!error}
            onClick={() => {
              try {
                onApply(next);
                onClose();
              } catch (e) {
                setError(readableError(e));
              }
            }}
          >
            Apply colors
          </button>
        </div>
      </div>
    </Modal>
  );
}

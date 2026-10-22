import { useEffect, useRef, useState } from "react";
import {
  makeComponent,
  insertComponent,
  parseComponent,
  type Component,
} from "../core/components.js";
import type { Project } from "../core/model.js";
import { readableError } from "../core/errors.js";
import { VfxRenderer } from "../render/pixi.js";
import { preview, toBase64 } from "../render/export.js";
import { downloadFile, safeFilename } from "./files.js";
import {
  listComponents,
  saveComponent,
  removeComponent,
  type LibraryItem,
} from "./component-library.js";

export function ComponentPanel({
  project,
  selection,
  time,
  insert,
}: {
  project: Project;
  selection: string[];
  time: number;
  insert: (p: Project, ids: string[]) => void;
}) {
  const [items, setItems] = useState<LibraryItem[]>([]),
    [name, setName] = useState("My effect part"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    mounted = useRef(true);
  const refresh = async () => {
    const items = await listComponents();
    if (mounted.current) setItems(items);
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e) => setError(readableError(e)));
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = async (component: Component) => {
    setBusy(true);
    setError("");
    let renderer: VfxRenderer | undefined;
    try {
      renderer = await VfxRenderer.create();
      const p = {
        ...component.project,
        layers: component.project.layers.map((l) => ({
          ...l,
          position: {
            x: l.position.x + component.project.canvas.width / 2,
            y: l.position.y + component.project.canvas.height / 2,
          },
        })),
      };
      await renderer.setProject(p);
      const thumbnail =
        "data:image/png;base64," +
        toBase64(
          await preview(renderer, p, Math.min(time, p.duration - 0.001)),
        );
      await saveComponent({
        id: crypto.randomUUID(),
        updated: Date.now(),
        component,
        thumbnail,
      });
      await refresh();
    } catch (e) {
      if (mounted.current) setError(readableError(e));
    } finally {
      renderer?.destroy();
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="component-panel">
      <div className="panel-heading">
        <span>MY COMPONENTS</span>
        <small>{items.length} / 24</small>
      </div>
      <p className="library-description">
        Save an effect or selected parts, then reuse them in another project.
      </p>
      <div className="component-save">
        <label className="field">
          <span>Component name</span>
          <input
            aria-label="Component name"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !selection.length || !name.trim()}
          onClick={() => {
            try {
              void save(makeComponent(project, selection, name.trim()));
            } catch (e) {
              setError(readableError(e));
            }
          }}
        >
          {busy ? "Saving…" : `Save selection (${selection.length})`}
        </button>
        <button disabled={busy} onClick={() => file.current?.click()}>
          Import component
        </button>
      </div>
      {!items.length && (
        <p className="empty-state">
          Your saved components will appear here. Select layers to save the
          parts you want.
        </p>
      )}
      <div className="component-list">
        {items.map((item) => (
          <article className="component-card" key={item.id}>
            <img src={item.thumbnail} alt="" />
            <div>
              <strong>{item.component.name}</strong>
              <small>
                {item.component.project.layers.length} layers ·{" "}
                {item.component.project.controls.length} controls
              </small>
            </div>
            <div className="compact-actions">
              <button
                aria-label={`Insert ${item.component.name}`}
                onClick={() => {
                  try {
                    const result = insertComponent(project, item.component);
                    insert(result.project, result.ids);
                    setError("");
                  } catch (e) {
                    setError(readableError(e));
                  }
                }}
              >
                Insert
              </button>
              <button
                aria-label={`Download ${item.component.name}`}
                onClick={() =>
                  downloadFile(
                    new TextEncoder().encode(
                      JSON.stringify(item.component, null, 2),
                    ),
                    safeFilename(item.component.name) + ".vfx-component.json",
                    "application/json",
                  )
                }
              >
                ↓
              </button>
              <button
                aria-label={`Remove ${item.component.name} from library`}
                onClick={() =>
                  void removeComponent(item.id)
                    .then(refresh)
                    .catch((e) => setError(readableError(e)))
                }
              >
                ×
              </button>
            </div>
          </article>
        ))}
      </div>
      <p className="library-description">
        Saved in this browser. Download components to keep portable copies.
        Inserted parts are independent editable copies.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <input
        ref={file}
        hidden
        type="file"
        accept=".json,application/json"
        aria-label="Import component file"
        onChange={async (e) => {
          const chosen = e.target.files?.[0];
          e.target.value = "";
          if (!chosen) return;
          try {
            if (chosen.size > 4194304) throw Error("Component exceeds 4 MiB");
            await save(parseComponent(JSON.parse(await chosen.text())));
          } catch (e) {
            setError(readableError(e));
          }
        }}
      />
    </div>
  );
}

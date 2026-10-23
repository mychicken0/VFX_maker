import { useEffect, useRef, useState } from "react";
import {
  parameterTargets,
  quickControls,
  setControl,
} from "../core/parameters.js";
import { editCreative } from "../core/creative.js";
import { controlSchema, type Control } from "../core/creative-schema.js";
import type { Project } from "../core/model.js";
import { readableError } from "../core/errors.js";
import { NumberField } from "./controls.js";

function ControlSlider({
  control: c,
  project,
  update,
  preview,
}: {
  control: Control;
  project: Project;
  update: (p: Project) => void;
  preview: (p: Project | null) => void;
}) {
  const [draft, setDraft] = useState(c.value),
    [error, setError] = useState("");
  const pending = useRef(c.value),
    committed = useRef(c.value);
  useEffect(() => {
    pending.current = committed.current = c.value;
    setDraft(c.value);
  }, [c.value]);
  const commit = () => {
    try {
      if (
        pending.current !== c.value &&
        pending.current !== committed.current
      ) {
        const next = setControl(project, c.id, pending.current);
        committed.current = pending.current;
        update(next);
      }
      setError("");
    } catch (e) {
      pending.current = committed.current = c.value;
      setDraft(c.value);
      setError(readableError(e));
    } finally {
      preview(null);
    }
  };
  return (
    <div className="effect-knob">
      <div>
        <label htmlFor={`control-${c.id}`}>{c.name}</label>
        <span className="control-value" aria-hidden="true">
          {Number(draft.toFixed(3))}
          {c.bindings.some((b) => b.target === "colors.hue") ? "°" : ""}
        </span>
      </div>
      <input
        id={`control-${c.id}`}
        aria-label={`Control ${c.name}`}
        type="range"
        min={c.min}
        max={c.max}
        step={c.step}
        value={draft}
        onChange={(e) => {
          const value = Number(e.target.value);
          pending.current = value;
          setDraft(value);
          try {
            preview(setControl(project, c.id, value));
            setError("");
          } catch (e) {
            preview(null);
            setError(readableError(e));
          }
        }}
        onPointerUp={commit}
        onKeyUp={(e) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "Home",
              "End",
              "PageUp",
              "PageDown",
            ].includes(e.key)
          )
            commit();
          if (e.key === "Escape") {
            pending.current = committed.current = c.value;
            setDraft(c.value);
            preview(null);
          }
        }}
        onBlur={commit}
        onPointerCancel={() => {
          pending.current = committed.current = c.value;
          setDraft(c.value);
          preview(null);
        }}
      />
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function EffectControls({
  project: p,
  update,
  preview,
}: {
  project: Project;
  update: (p: Project) => void;
  preview: (p: Project | null) => void;
}) {
  const [error, setError] = useState(""),
    [editing, setEditing] = useState<string>(),
    [name, setName] = useState("My control");
  const apply = (operation: Parameters<typeof editCreative>[1]) => {
    try {
      update(editCreative(p, operation));
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  };
  const selected = p.controls.find((c) => c.id === editing),
    firstLayer = p.layers[0];
  return (
    <details className="effect-controls" aria-label="Effect controls">
      <summary>Make it yours · size & color</summary>
      <div className="quick-heading">
        <strong>Make it yours</strong>
        <small>{p.controls.length} controls</small>
      </div>
      {p.controls.map((c) => (
        <ControlSlider
          key={c.id}
          control={c}
          project={p}
          update={update}
          preview={preview}
        />
      ))}
      {!p.controls.length && (
        <>
          <p className="field-help">
            Add simple size, intensity and hue controls for this effect.
          </p>
          <button
            disabled={!p.layers.length}
            onClick={() => {
              try {
                update(quickControls(p));
              } catch (e) {
                setError(readableError(e));
              }
            }}
          >
            Add quick controls
          </button>
        </>
      )}
      <details className="control-setup">
        <summary>Advanced · edit controls</summary>
        <p className="field-help">
          A control can change several layer properties. Layer fields remain the
          original values; controls apply when rendering.
        </p>
        <label className="field">
          <span>Control to edit</span>
          <select
            aria-label="Control to edit"
            value={editing ?? ""}
            onChange={(e) => setEditing(e.target.value)}
          >
            <option value="">Choose a control…</option>
            {p.controls.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <>
            <label className="field">
              <span>Name</span>
              <input
                aria-label="Control name"
                value={selected.name}
                onChange={(e) =>
                  e.target.value &&
                  apply({
                    action: "put_control",
                    control: { ...selected, name: e.target.value },
                  })
                }
              />
            </label>
            <div className="two-fields">
              <NumberField
                label="Control minimum"
                value={selected.min}
                step={0.01}
                onChange={(min) =>
                  apply({
                    action: "put_control",
                    control: { ...selected, min },
                  })
                }
              />
              <NumberField
                label="Control maximum"
                value={selected.max}
                step={0.01}
                onChange={(max) =>
                  apply({
                    action: "put_control",
                    control: { ...selected, max },
                  })
                }
              />
            </div>
            {selected.bindings.map((b, index) => {
              const layer = p.layers.find((l) => l.id === b.layer)!;
              const patch = (changes: object) =>
                apply({
                  action: "put_control",
                  control: {
                    ...selected,
                    bindings: selected.bindings.map((v, i) =>
                      i === index ? { ...v, ...changes } : v,
                    ),
                  },
                });
              return (
                <details className="binding-item" key={index}>
                  <summary>
                    {layer.name} · {b.target}
                  </summary>
                  <label className="field">
                    <span>Layer</span>
                    <select
                      aria-label={`Binding ${index + 1} layer`}
                      value={b.layer}
                      onChange={(e) =>
                        patch({ layer: e.target.value, target: "scale" })
                      }
                    >
                      {p.layers.map((l) => (
                        <option value={l.id} key={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Property</span>
                    <select
                      aria-label={`Binding ${index + 1} property`}
                      value={b.target}
                      onChange={(e) => patch({ target: e.target.value })}
                    >
                      {parameterTargets(layer).map((t) => (
                        <option value={t.path} key={t.path}>
                          {t.path}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Change</span>
                    <select
                      aria-label={`Binding ${index + 1} mode`}
                      value={b.mode}
                      onChange={(e) => patch({ mode: e.target.value })}
                    >
                      <option value="multiply">Multiply original</option>
                      <option value="add">Add to original</option>
                      <option value="set">Set value</option>
                    </select>
                  </label>
                  <div className="two-fields">
                    <NumberField
                      label={`Binding ${index + 1} factor`}
                      value={b.factor}
                      step={0.01}
                      onChange={(factor) => patch({ factor })}
                    />
                    <NumberField
                      label={`Binding ${index + 1} offset`}
                      value={b.offset}
                      step={0.01}
                      onChange={(offset) => patch({ offset })}
                    />
                  </div>
                  <button
                    onClick={() =>
                      apply({
                        action: "put_control",
                        control: {
                          ...selected,
                          bindings: selected.bindings.filter(
                            (_, i) => i !== index,
                          ),
                        },
                      })
                    }
                  >
                    Remove binding
                  </button>
                </details>
              );
            })}
            <button
              disabled={!firstLayer || selected.bindings.length >= 64}
              onClick={() =>
                apply({
                  action: "put_control",
                  control: {
                    ...selected,
                    bindings: [
                      ...selected.bindings,
                      {
                        layer: firstLayer.id,
                        target: "scale",
                        mode: "multiply",
                      },
                    ],
                  },
                })
              }
            >
              Add binding
            </button>
            <button
              className="danger-text"
              onClick={() =>
                apply({ action: "remove_control", id: selected.id })
              }
            >
              Remove control
            </button>
          </>
        )}
        <label className="field">
          <span>New control</span>
          <input
            aria-label="New control name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          disabled={!name.trim() || p.controls.length >= 16}
          onClick={() => {
            const id = "control-" + crypto.randomUUID().slice(0, 8);
            apply({
              action: "put_control",
              control: controlSchema.parse({ id, name: name.trim() }),
            });
            setEditing(id);
          }}
        >
          Create control
        </button>
      </details>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </details>
  );
}

import { useState } from "react";
import { transformLayers, patchLayers } from "../core/editing.js";
import { readableError } from "../core/errors.js";
import type { Project } from "../core/model.js";
import { NumberField, Check, Select } from "./controls.js";
export function BatchPanel({
  project,
  ids,
  onApply,
}: {
  project: Project;
  ids: string[];
  onApply: (p: Project) => void;
}) {
  const [x, setX] = useState(0),
    [y, setY] = useState(0),
    [rotation, setRotation] = useState(0),
    [scale, setScale] = useState(1),
    [includeLocked, setIncludeLocked] = useState(false),
    [blend, setBlend] = useState("add"),
    [opacity, setOpacity] = useState(1),
    [error, setError] = useState("");
  const group = project.groups.find(
    (g) => g.ids.length === ids.length && g.ids.every((id) => ids.includes(id)),
  );
  const apply = (run: () => Project) => {
    try {
      onApply(run());
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  };
  return (
    <aside className="inspector batch-panel">
      <div className="panel-heading">
        <span>SELECTION</span>
        <small>{ids.length} layers</small>
      </div>
      <div className="inspector-scroll">
        {group && (
          <label className="field">
            <span>Group name</span>
            <input
              aria-label="Group name"
              key={group.id + group.name}
              defaultValue={group.name}
              maxLength={100}
              onBlur={(e) => {
                const name = e.currentTarget.value.trim();
                if (name && name !== group.name)
                  apply(() => ({
                    ...project,
                    groups: project.groups.map((g) =>
                      g.id === group.id ? { ...g, name } : g,
                    ),
                  }));
                else e.currentTarget.value = group.name;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
        )}
        <details open>
          <summary>Transform selection</summary>
          <p className="hint">
            Offsets and rotation apply around the selected layer anchors.
            Changes make one undoable edit.
          </p>
          <div className="two-fields">
            <NumberField label="Selection move X" value={x} onChange={setX} />
            <NumberField label="Selection move Y" value={y} onChange={setY} />
          </div>
          <NumberField
            label="Selection rotation"
            value={rotation}
            min={-360}
            max={360}
            onChange={setRotation}
            unit="°"
          />
          <NumberField
            label="Selection scale"
            value={scale}
            min={0.01}
            max={16}
            step={0.01}
            onChange={setScale}
          />
          <Check
            label="Include locked in selection edits"
            value={includeLocked}
            onChange={setIncludeLocked}
          />
          <button
            className="primary wide"
            onClick={() =>
              apply(() => {
                const p = transformLayers(project, ids, {
                  x,
                  y,
                  rotation,
                  scale,
                  includeLocked,
                });
                setX(0);
                setY(0);
                setRotation(0);
                setScale(1);
                return p;
              })
            }
          >
            Apply transform
          </button>
        </details>
        <details open>
          <summary>Shared settings</summary>
          <Select
            label="Selection blend"
            value={blend}
            options={["normal", "add", "screen", "multiply"]}
            onChange={setBlend}
          />
          <button
            onClick={() =>
              apply(() => patchLayers(project, ids, { blend }, includeLocked))
            }
          >
            Apply blend
          </button>
          <NumberField
            label="Selection opacity multiplier"
            value={opacity}
            min={0}
            max={2}
            step={0.05}
            onChange={setOpacity}
          />
          <button
            onClick={() =>
              apply(() => ({
                ...project,
                layers: project.layers.map((l) =>
                  ids.includes(l.id) && (!l.locked || includeLocked)
                    ? {
                        ...l,
                        opacity: l.opacity.map((k) => ({
                          ...k,
                          value: k.value * opacity,
                        })),
                      }
                    : l,
                ),
              }))
            }
          >
            Multiply opacity curves
          </button>
          <div className="pixel-actions">
            <button
              onClick={() =>
                apply(() =>
                  patchLayers(project, ids, { visible: true }, includeLocked),
                )
              }
            >
              Show selection
            </button>
            <button
              onClick={() =>
                apply(() =>
                  patchLayers(project, ids, { visible: false }, includeLocked),
                )
              }
            >
              Hide selection
            </button>
          </div>
        </details>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}

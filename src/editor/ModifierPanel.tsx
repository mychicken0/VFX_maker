import { useState } from "react";
import {
  modifierSchema,
  modifierRange,
  type Modifier,
} from "../core/creative-schema.js";
import { editCreative } from "../core/creative.js";
import type { Layer, Project } from "../core/model.js";
import { readableError } from "../core/errors.js";
import { Check, NumberField } from "./controls.js";

export const MODIFIER_NAMES: Record<Modifier["type"], string> = {
  outline: "Outline",
  pixelate: "Pixel blocks",
  "color-replace": "Replace color",
  ramp: "Color ramp",
  shockwave: "Shockwave",
  "noise-warp": "Noise warp",
  dissolve: "Dissolve",
};
const names: Record<string, string> = {
  thickness: "Thickness",
  alpha: "Opacity",
  size: "Pixel size",
  tolerance: "Tolerance",
  amplitude: "Strength",
  wavelength: "Wave width",
  speed: "Speed",
  radius: "Radius",
  strength: "Strength",
  frequency: "Detail",
  amount: "Amount",
  edge: "Edge width",
  low: "Dark color",
  high: "Light color",
  from: "Original color",
  to: "New color",
  color: "Color",
};
export function ModifierPanel({
  layer,
  project,
  update,
}: {
  layer: Layer;
  project: Project;
  update: (p: Project) => void;
}) {
  const [type, setType] = useState<Modifier["type"]>("outline"),
    [error, setError] = useState("");
  const apply = (operation: Parameters<typeof editCreative>[1]) => {
    try {
      update(editCreative(project, operation));
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  };
  return (
    <details className="modifier-panel">
      <summary>
        Modifiers <small>{layer.modifiers.length} / 8</small>
      </summary>
      <p className="field-help">
        Applied from top to bottom. Use the arrows to change the order.
      </p>
      {layer.modifiers.map((m, index) => (
        <details key={m.id} className="modifier-item">
          <summary>
            {MODIFIER_NAMES[m.type]}
            {!m.enabled && " · off"}
          </summary>
          <Check
            label={`${MODIFIER_NAMES[m.type]} enabled`}
            value={m.enabled}
            onChange={(enabled) =>
              apply({
                action: "put_modifier",
                layer: layer.id,
                modifier: { ...m, enabled },
              })
            }
          />
          <div className="compact-actions">
            <button
              disabled={index === 0}
              aria-label={`Move ${MODIFIER_NAMES[m.type]} up`}
              onClick={() =>
                apply({
                  action: "put_modifier",
                  layer: layer.id,
                  modifier: m,
                  index: index - 1,
                })
              }
            >
              ↑
            </button>
            <button
              disabled={index === layer.modifiers.length - 1}
              aria-label={`Move ${MODIFIER_NAMES[m.type]} down`}
              onClick={() =>
                apply({
                  action: "put_modifier",
                  layer: layer.id,
                  modifier: m,
                  index: index + 1,
                })
              }
            >
              ↓
            </button>
            <button
              onClick={() =>
                apply({ action: "remove_modifier", layer: layer.id, id: m.id })
              }
            >
              Remove
            </button>
          </div>
          {Object.entries(m)
            .filter(([key]) => !["id", "type", "enabled"].includes(key))
            .map(([key, value]) =>
              typeof value === "number" ? (
                <NumberField
                  key={key}
                  label={`${MODIFIER_NAMES[m.type]} ${names[key] ?? key}`}
                  value={value}
                  {...modifierRange(m.type, key)}
                  onChange={(v) =>
                    apply({
                      action: "put_modifier",
                      layer: layer.id,
                      modifier: { ...m, [key]: v },
                    })
                  }
                />
              ) : (
                <label className="field" key={key}>
                  <span>{names[key] ?? key}</span>
                  <input
                    type="color"
                    aria-label={`${MODIFIER_NAMES[m.type]} ${names[key] ?? key}`}
                    value={String(value)}
                    onChange={(e) =>
                      apply({
                        action: "put_modifier",
                        layer: layer.id,
                        modifier: { ...m, [key]: e.target.value },
                      })
                    }
                  />
                </label>
              ),
            )}
        </details>
      ))}
      <div className="modifier-add">
        <select
          aria-label="Modifier type"
          value={type}
          onChange={(e) => setType(e.target.value as Modifier["type"])}
        >
          {Object.entries(MODIFIER_NAMES).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <button
          disabled={layer.modifiers.length >= 8}
          onClick={() =>
            apply({
              action: "put_modifier",
              layer: layer.id,
              modifier: modifierSchema.parse({
                id: "modifier-" + crypto.randomUUID().slice(0, 8),
                type,
              }),
            })
          }
        >
          Add modifier
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </details>
  );
}

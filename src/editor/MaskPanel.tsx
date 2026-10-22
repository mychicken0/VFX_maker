import { maskSchema, type Layer } from "../core/model.js";
import { Check, NumberField, Select } from "./controls.js";
export function MaskPanel({
  layer,
  update,
}: {
  layer: Layer;
  update: (p: Record<string, unknown>) => void;
}) {
  const mask = layer.mask;
  return (
    <details>
      <summary>Layer mask</summary>
      <Check
        label="Enable layer mask"
        value={!!mask}
        onChange={(enabled) =>
          update({ mask: enabled ? maskSchema.parse({}) : undefined })
        }
      />
      {mask && (
        <>
          <Select
            label="Mask shape"
            value={mask.shape}
            options={["rectangle", "ellipse", "polygon"]}
            onChange={(shape) => update({ mask: { ...mask, shape } })}
          />
          <div className="two-fields">
            <NumberField
              label="Mask X"
              value={mask.position.x}
              onChange={(x) =>
                update({ mask: { ...mask, position: { ...mask.position, x } } })
              }
            />
            <NumberField
              label="Mask Y"
              value={mask.position.y}
              onChange={(y) =>
                update({ mask: { ...mask, position: { ...mask.position, y } } })
              }
            />
          </div>
          {mask.shape !== "polygon" && (
            <div className="two-fields">
              <NumberField
                label="Mask width"
                value={mask.width}
                min={1}
                max={1024}
                onChange={(width) => update({ mask: { ...mask, width } })}
              />
              <NumberField
                label="Mask height"
                value={mask.height}
                min={1}
                max={1024}
                onChange={(height) => update({ mask: { ...mask, height } })}
              />
            </div>
          )}
          <p className="hint">
            Mask edit in the preview moves the mask, resizes it, or edits
            polygon vertices. The mask clips this layer and its glow in exports
            too.
          </p>
        </>
      )}
    </details>
  );
}

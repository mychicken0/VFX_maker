import { layerSchema, type Layer, type Project } from "./model.js";
import { uniqueLayerName } from "./authoring.js";
import { modifierSchema, controlSchema } from "./creative-schema.js";
import { MAX_LAYERS } from "./limits.js";
import { applyEdits, type EditOperation } from "./operations.js";
export const LAYER_NAMES: Record<Layer["type"], string> = {
  particles: "Particles",
  path: "Stroke",
  ring: "Ring",
  sprite: "Sprite",
  field: "Texture",
};
export const MODIFIER_LABELS = {
  outline: "Outline",
  pixelate: "Pixel blocks",
  "color-replace": "Replace color",
  ramp: "Color ramp",
  shockwave: "Shockwave",
  "noise-warp": "Noise warp",
  dissolve: "Dissolve",
} as const;
export type CatalogEntry = {
  id: string;
  name: string;
  category: "Layers" | "Modifiers" | "Controls";
  description: string;
  disabled?: string;
};
export function nodeCatalog(p: Project, layerId?: string): CatalogEntry[] {
  const l = p.layers.find((l) => l.id === layerId);
  return [
    ...Object.entries(LAYER_NAMES).map(([type, name]) => ({
      id: `layer:${type}`,
      name,
      category: "Layers" as const,
      description: (
        {
          particles: "Animated particle emitter",
          path: "Editable line and Bezier path",
          ring: "Expanding circle or shock ring",
          sprite: "An imported image or flipbook",
          field: "Generated noise and shapes",
        } as Record<string, string>
      )[type],
      disabled:
        p.layers.length >= MAX_LAYERS
          ? `Layer limit reached (${MAX_LAYERS}). Delete a layer first.`
          : type === "sprite" && !p.assets.length
            ? "Import a PNG in Library → Assets first."
            : undefined,
    })),
    ...Object.entries(MODIFIER_LABELS).map(([type, name]) => ({
      id: `modifier:${type}`,
      name,
      category: "Modifiers" as const,
      description: l ? `Apply to ${l.name}` : "Apply to the selected layer",
      disabled: !l
        ? "Select a layer first."
        : l.locked
          ? "Unlock the selected layer first."
          : l.modifiers.length >= 8
            ? "This layer already has 8 modifiers."
            : undefined,
    })),
    {
      id: "control:number",
      name: "Number control",
      category: "Controls",
      description: "A value you can wire to a layer parameter",
      disabled:
        p.controls.length >= 16
          ? "16 controls already exist. Delete one to add another."
          : undefined,
    },
  ];
}
export function starterLayer(
  p: Project,
  type: Layer["type"],
  id: string,
): Layer {
  if (type === "sprite" && !p.assets.length)
    throw Error("Import a PNG in Library → Assets first.");
  const width = p.canvas.width,
    height = p.canvas.height,
    size = Math.min(width, height);
  const curve = (...values: number[]) =>
    values.map((value, index) => ({
      t: values.length === 1 ? 0 : index / (values.length - 1),
      value,
      ease: "linear",
    }));
  const fittedAsset = type === "sprite" ? p.assets[0] : undefined;
  const cellWidth = fittedAsset ? fittedAsset.width / fittedAsset.columns : 1,
    cellHeight = fittedAsset ? fittedAsset.height / fittedAsset.rows : 1;
  const fit = fittedAsset
    ? Math.min((width * 0.6) / cellWidth, (height * 0.6) / cellHeight)
    : 1;
  return layerSchema.parse({
    id,
    type,
    name: uniqueLayerName(
      `New ${LAYER_NAMES[type].toLowerCase()}`,
      p.layers.map((l) => l.name),
    ),
    duration: p.duration,
    position: { x: width / 2, y: height / 2 },
    ...(type === "path"
      ? {
          points: [
            { x: -width * 0.25, y: height * 0.16 },
            { x: 0, y: -height * 0.1 },
            { x: width * 0.25, y: -height * 0.2 },
          ],
          width: curve(
            Math.max(1, size * 0.035),
            Math.max(0.5, size * 0.025),
            0,
          ),
        }
      : {}),
    ...(type === "ring"
      ? {
          radius: [
            { t: 0, value: size * 0.05, ease: "linear" },
            { t: 0.4, value: size * 0.3, ease: "linear" },
            { t: 1, value: size * 0.36, ease: "linear" },
          ],
          width: curve(
            Math.max(1, size * 0.025),
            Math.max(0.5, size * 0.02),
            0,
          ),
        }
      : {}),
    ...(type === "particles"
      ? {
          count: 36,
          speed: [
            Math.min(1000, (size * 0.2) / p.duration),
            Math.min(1000, (size * 0.5) / p.duration),
          ],
          gravity: { x: 0, y: 0 },
          size: curve(Math.max(1, size * 0.035), Math.max(0.5, size * 0.02), 0),
          life: [
            Math.max(0.02, p.duration * 0.4),
            Math.max(0.04, p.duration * 0.9),
          ],
        }
      : {}),
    ...(type === "sprite"
      ? {
          asset: fittedAsset!.id,
          width: curve(cellWidth * fit),
          height: curve(cellHeight * fit),
        }
      : {}),
    ...(type === "field"
      ? { width: curve(width * 0.6), height: curve(height * 0.6) }
      : {}),
  });
}
export function addCatalogNode(
  p: Project,
  key: string,
  id: string,
  layerId?: string,
) {
  const entry = nodeCatalog(p, layerId).find((e) => e.id === key);
  if (!entry) throw Error(`Unknown node: ${key}`);
  if (entry.disabled) throw Error(entry.disabled);
  const [kind, type] = key.split(":");
  let edit: EditOperation, node: string;
  if (kind === "layer") {
    edit = {
      action: "add_layer",
      layer: starterLayer(p, type as Layer["type"], id),
    };
    node = `layer:${id}`;
  } else if (kind === "modifier") {
    edit = {
      action: "creative",
      operation: {
        action: "put_modifier",
        layer: layerId!,
        modifier: modifierSchema.parse({ id, type }),
      },
    };
    node = `modifier:${layerId}:${id}`;
  } else {
    edit = {
      action: "creative",
      operation: {
        action: "put_control",
        control: controlSchema.parse({
          id,
          min: -4096,
          max: 4096,
          value: 1,
          step: 0.1,
          name: uniqueLayerName(
            "New control",
            p.controls.map((c) => c.name),
          ),
        }),
      },
    };
    node = `control:${id}`;
  }
  return { project: applyEdits(p, [edit]), edit, node };
}
export function duplicateEditorLayer(p: Project, source: string, id: string) {
  const layer = p.layers.find((l) => l.id === source);
  if (!layer) throw Error("Choose a layer to duplicate.");
  const edits: EditOperation[] = [
    {
      action: "add_layer",
      layer: {
        ...structuredClone(layer),
        id,
        locked: false,
        name: uniqueLayerName(
          `${layer.name} copy`,
          p.layers.map((l) => l.name),
        ),
      },
    },
  ];
  for (const control of p.controls) {
    const bindings = control.bindings
      .filter((b) => b.layer === source)
      .map((b) => ({ ...b, layer: id }));
    if (bindings.length)
      edits.push({
        action: "creative",
        operation: {
          action: "put_control",
          control: { ...control, bindings: [...control.bindings, ...bindings] },
        },
      });
  }
  if (p.stage?.layers[source])
    edits.push({
      action: "place_stage_layer",
      id,
      patch: p.stage.layers[source],
    });
  return applyEdits(p, edits);
}

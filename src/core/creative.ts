import { MAX_LAYERS } from "./limits.js";
import { z } from "zod";
import { modifierSchema, controlSchema } from "./creative-schema.js";
import { parseProject, type Project } from "./model.js";
import {
  parameterTargets,
  setControl,
  captureVariant,
  applyVariant,
} from "./parameters.js";
import { cleanupGroups, retimeProject, staggerLayers } from "./editing.js";

export const creativeEditSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("put_modifier"),
      layer: z.string(),
      modifier: modifierSchema,
      index: z.number().int().min(0).max(7).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("remove_modifier"),
      layer: z.string(),
      id: z.string(),
    })
    .strict(),
  z
    .object({ action: z.literal("put_control"), control: controlSchema })
    .strict(),
  z.object({ action: z.literal("remove_control"), id: z.string() }).strict(),
  z
    .object({
      action: z.literal("set_control"),
      id: z.string(),
      value: z.number().finite(),
    })
    .strict(),
  z
    .object({
      action: z.literal("capture_variant"),
      id: z.string(),
      name: z.string(),
    })
    .strict(),
  z.object({ action: z.literal("apply_variant"), id: z.string() }).strict(),
  z.object({ action: z.literal("remove_variant"), id: z.string() }).strict(),
  z
    .object({
      action: z.literal("retime"),
      duration: z.number().finite().min(0.1).max(10),
    })
    .strict(),
  z
    .object({
      action: z.literal("stagger"),
      ids: z.array(z.string()).min(1).max(MAX_LAYERS),
      seconds: z.number().finite().min(-10).max(10),
    })
    .strict(),
]);
export type CreativeEdit = z.input<typeof creativeEditSchema>;
export function editCreative(p: Project, input: CreativeEdit): Project {
  const op = creativeEditSchema.parse(input);
  if (op.action === "set_control") return setControl(p, op.id, op.value);
  if (op.action === "capture_variant") return captureVariant(p, op.id, op.name);
  if (op.action === "apply_variant") return applyVariant(p, op.id);
  if (op.action === "retime") return retimeProject(p, op.duration);
  if (op.action === "stagger") return staggerLayers(p, op.ids, op.seconds);
  if (op.action === "remove_variant")
    return parseProject({
      ...p,
      variants: p.variants.filter((v) => v.id !== op.id),
    });
  if (op.action === "put_control") {
    const controls = [...p.controls],
      index = controls.findIndex((c) => c.id === op.control.id);
    if (index < 0) controls.push(op.control);
    else controls[index] = op.control;
    return parseProject({
      ...p,
      controls,
    });
  }
  if (op.action === "remove_control")
    return parseProject({
      ...p,
      controls: p.controls.filter((c) => c.id !== op.id),
      variants: p.variants.map((v) => ({
        ...v,
        values: Object.fromEntries(
          Object.entries(v.values).filter(([id]) => id !== op.id),
        ),
      })),
    });
  const layer = p.layers.find((l) => l.id === op.layer);
  if (!layer || layer.locked) throw Error("Choose an unlocked layer");
  let modifiers = layer.modifiers.filter(
    (m) => m.id !== (op.action === "put_modifier" ? op.modifier.id : op.id),
  );
  if (op.action === "put_modifier") {
    const prior = layer.modifiers.findIndex((m) => m.id === op.modifier.id);
    const index = op.index ?? (prior < 0 ? modifiers.length : prior);
    modifiers.splice(index, 0, op.modifier);
  }
  return cleanupGroups({
    ...p,
    layers: p.layers.map((l) => (l.id === layer.id ? { ...l, modifiers } : l)),
  });
}
export function creativeCapabilities(p: Project) {
  return {
    controls: p.controls,
    variants: p.variants,
    layers: p.layers.map((layer) => ({
      id: layer.id,
      modifiers: layer.modifiers,
      targets: parameterTargets(layer),
    })),
  };
}

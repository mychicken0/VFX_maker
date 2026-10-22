import { z } from "zod";
import { layerSchema, parseProject, vecSchema, type Project } from "./model.js";
import {
  cleanupGroups,
  groupLayers,
  transformLayers,
  putKeyframe,
} from "./editing.js";
import { creativeEditSchema, editCreative } from "./creative.js";
import { resolveControls } from "./parameters.js";
import { pointToLocal } from "./spatial.js";

/** The same merge semantics are used by single edits and transactions. */
export function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    return patch as T;
  if (!base || typeof base !== "object" || Array.isArray(base))
    return patch as T;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw Error("Invalid property name");
    out[key] = merge(out[key], value);
  }
  return out as T;
}
const id = z.string().min(1).max(64),
  patch = z.record(z.string(), z.unknown()),
  ids = z.array(id).min(1).max(32);
export const editOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update_project"), patch }).strict(),
  z.object({ action: z.literal("add_layer"), layer: patch }).strict(),
  z.object({ action: z.literal("update_layer"), id, patch }).strict(),
  z.object({ action: z.literal("remove_layer"), id }).strict(),
  z
    .object({ action: z.literal("reorder_layers"), ids: z.array(id).max(32) })
    .strict(),
  z
    .object({
      action: z.literal("group_layers"),
      id,
      name: z.string().min(1).max(100),
      ids,
    })
    .strict(),
  z
    .object({
      action: z.literal("transform_layers"),
      ids,
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      rotation: z.number().min(-360).max(360).optional(),
      scale: z.number().positive().max(16).optional(),
      pivot: vecSchema.optional(),
      includeLocked: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("put_keyframe"),
      id,
      channel: z.string().min(1).max(80),
      time: z.number().min(0).max(1),
      value: z.number().finite(),
      ease: z.enum(["linear", "smooth", "hold"]).default("linear"),
    })
    .strict(),
  z
    .object({ action: z.literal("creative"), operation: creativeEditSchema })
    .strict(),
  z
    .object({
      action: z.literal("set_path_points"),
      id,
      space: z.enum(["local", "canvas", "normalized"]).default("canvas"),
      time: z.number().min(0).max(10).default(0),
      points: z.array(vecSchema).min(2).max(64),
      handles: z
        .array(z.object({ in: vecSchema, out: vecSchema }).strict())
        .min(2)
        .max(64)
        .optional(),
      closed: z.boolean().optional(),
    })
    .strict(),
]);
export const editBatchSchema = z.array(editOperationSchema).min(1).max(64);
export type EditOperation = z.infer<typeof editOperationSchema>;
export class EditBatchError extends Error {
  constructor(
    readonly index: number,
    readonly action: string,
    readonly original: unknown,
  ) {
    super(
      `Operation ${index + 1} (${action}): ${original instanceof Error ? original.message : String(original)}`,
    );
    this.name = "EditBatchError";
  }
}
export function updateLayerData(
  p: Project,
  id: string,
  patch: unknown,
): Project {
  const index = p.layers.findIndex((l) => l.id === id);
  if (index < 0) throw Error(`Unknown layer ${id}`);
  if (
    p.layers[index].locked &&
    !(
      patch &&
      typeof patch === "object" &&
      Object.keys(patch).length === 1 &&
      "locked" in patch &&
      patch.locked === false
    )
  )
    throw Error("Unlock the layer before editing");
  const layers = [...p.layers];
  layers[index] = layerSchema.parse(merge(layers[index], patch));
  return parseProject({ ...p, layers });
}
export function updateProjectData(p: Project, patch: unknown): Project {
  const next = parseProject(merge(p, patch));
  for (const locked of p.layers.filter((l) => l.locked)) {
    const changed = next.layers.find((l) => l.id === locked.id);
    if (
      !changed ||
      JSON.stringify({ ...changed, locked: true }) !== JSON.stringify(locked)
    )
      throw Error(
        `Unlock the layer before editing or removing it: ${locked.id}`,
      );
  }
  resolveControls(next);
  return next;
}
export function removeLayerData(p: Project, id: string): Project {
  const l = p.layers.find((l) => l.id === id);
  if (!l) throw Error(`Unknown layer ${id}`);
  if (l.locked) throw Error("Unlock the layer before removing it");
  return cleanupGroups({ ...p, layers: p.layers.filter((l) => l.id !== id) });
}
export function reorderLayerData(p: Project, ids: string[]): Project {
  if (
    ids.length !== p.layers.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !p.layers.some((l) => l.id === id))
  )
    throw Error("Supply each existing layer ID exactly once, bottom to top");
  return parseProject({
    ...p,
    layers: ids.map((id) => p.layers.find((l) => l.id === id)!),
  });
}
export function applyEdit(p: Project, op: EditOperation): Project {
  switch (op.action) {
    case "update_project":
      return updateProjectData(p, op.patch);
    case "add_layer":
      return parseProject({
        ...p,
        layers: [...p.layers, layerSchema.parse(op.layer)],
      });
    case "update_layer":
      return updateLayerData(p, op.id, op.patch);
    case "remove_layer":
      return removeLayerData(p, op.id);
    case "reorder_layers":
      return reorderLayerData(p, op.ids);
    case "group_layers":
      return groupLayers(p, op.id, op.name, op.ids);
    case "transform_layers":
      return transformLayers(p, op.ids, op);
    case "put_keyframe":
      return putKeyframe(p, op.id, op.channel, op.time, op.value, op.ease);
    case "creative":
      return editCreative(p, op.operation);
    case "set_path_points": {
      if (op.time > p.duration)
        throw Error("Time is outside the effect duration");
      const l = resolveControls(p).layers.find((l) => l.id === op.id);
      if (!l) throw Error(`Unknown layer ${op.id}`);
      if (l.type !== "path")
        throw Error("Canvas point editing requires a path layer");
      return updateLayerData(p, op.id, {
        points: op.points.map((q) => pointToLocal(p, l, q, op.space, op.time)),
        handles: op.handles?.map((h) => ({
          in: pointToLocal(p, l, h.in, op.space, op.time, true),
          out: pointToLocal(p, l, h.out, op.space, op.time, true),
        })),
        ...(op.closed === undefined ? {} : { closed: op.closed }),
      });
    }
  }
}
/** Validate each step on an isolated value; the caller writes only the final result. */
export function applyEdits(project: Project, input: unknown): Project {
  const operations = editBatchSchema.parse(input);
  let next = structuredClone(project);
  for (const [index, op] of operations.entries()) {
    try {
      next = applyEdit(next, op);
      resolveControls(next);
    } catch (e) {
      throw new EditBatchError(index, op.action, e);
    }
  }
  return next;
}
export function summarizeChanges(before: Project, after: Project) {
  const old = new Map(before.layers.map((l) => [l.id, l]));
  return {
    added: after.layers.filter((l) => !old.has(l.id)).map((l) => l.id),
    removed: before.layers
      .filter((l) => !after.layers.some((n) => n.id === l.id))
      .map((l) => l.id),
    changed: after.layers
      .filter(
        (l) =>
          old.has(l.id) && JSON.stringify(old.get(l.id)) !== JSON.stringify(l),
      )
      .map((l) => l.id),
    reordered:
      before.layers
        .filter((l) => after.layers.some((n) => n.id === l.id))
        .map((l) => l.id)
        .join("\0") !==
      after.layers
        .filter((l) => old.has(l.id))
        .map((l) => l.id)
        .join("\0"),
    controlsChanged:
      JSON.stringify(before.controls) !== JSON.stringify(after.controls),
  };
}

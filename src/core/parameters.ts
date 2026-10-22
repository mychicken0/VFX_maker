import {
  layerSchema,
  parseProject,
  type Layer,
  type Project,
  type Curve,
} from "./model.js";
import { modifierRange, type Binding } from "./creative-schema.js";
import { shiftColorHue } from "./authoring.js";

export interface ParameterTarget {
  path: string;
  kind: "number" | "curve" | "hue";
  integer?: boolean;
}
/** An explicit field registry prevents arbitrary property traversal and code execution. */
export function parameterTargets(layer: Layer): ParameterTarget[] {
  const integers = new Set(["count", "segments", "octaves"]);
  const numbers = [
    "position.x",
    "position.y",
    "rotation",
    "scale",
    "glow.strength",
    "glow.blur",
  ];
  const curves = [
    "opacity",
    "motion.x",
    "motion.y",
    "motion.rotation",
    "motion.scale",
  ];
  if (layer.type === "particles") {
    numbers.push(
      "count",
      "rate",
      "speed.0",
      "speed.1",
      "angle",
      "spread",
      "spawn.radius",
      "spawn.width",
      "spawn.height",
      "gravity.x",
      "gravity.y",
      "drag",
      "turbulence",
      "frequency",
      "stretch",
      "trail.seconds",
      "trail.width",
      "trail.opacity",
    );
    curves.push("size");
  }
  if (layer.type === "path") {
    numbers.push("taper");
    curves.push("width", "draw");
  }
  if (layer.type === "ring") {
    numbers.push("arc", "segments");
    curves.push("radius", "width");
  }
  if (layer.type === "sprite" || layer.type === "field")
    curves.push("width", "height");
  if (layer.type === "field") {
    numbers.push("frequency", "speed", "octaves", "softness", "falloff");
    curves.push("cutoff");
  }
  for (const modifier of layer.modifiers)
    for (const [key, value] of Object.entries(modifier))
      if (typeof value === "number") {
        const path = `modifiers.${modifier.id}.${key}`;
        numbers.push(path);
        if (modifierRange(modifier.type, key).step === 1) integers.add(path);
      }
  return [
    ...numbers.map((path) => ({
      path,
      kind: "number" as const,
      integer: integers.has(path),
    })),
    ...curves.map((path) => ({ path, kind: "curve" as const })),
    { path: "colors.hue", kind: "hue" },
  ];
}
function applyBinding(layer: Layer, binding: Binding, value: number): void {
  const descriptor = parameterTargets(layer).find(
    (t) => t.path === binding.target,
  );
  if (!descriptor)
    throw Error(`Unknown parameter ${binding.layer}.${binding.target}`);
  const amount = value * binding.factor + binding.offset;
  if (!Number.isFinite(amount)) throw Error("Parameter result must be finite");
  if (descriptor.kind === "hue") {
    layer.colors = layer.colors.map((stop) => ({
      ...stop,
      color: shiftColorHue(stop.color, amount),
    }));
    return;
  }
  const parts = binding.target.split(".");
  let parent: Record<string, unknown> = layer as unknown as Record<
    string,
    unknown
  >;
  if (parts[0] === "modifiers") {
    parent = layer.modifiers.find(
      (m) => m.id === parts[1],
    )! as unknown as Record<string, unknown>;
    parts.splice(0, 2);
  }
  while (parts.length > 1)
    parent = parent[parts.shift()!] as Record<string, unknown>;
  const key = parts[0];
  const calculate = (base: number) => {
    const n =
      binding.mode === "set"
        ? amount
        : binding.mode === "add"
          ? base + amount
          : base * amount;
    return descriptor.integer ? Math.round(n) : n;
  };
  parent[key] =
    descriptor.kind === "curve"
      ? (parent[key] as Curve).map((k) => ({ ...k, value: calculate(k.value) }))
      : calculate(parent[key] as number);
}
function resolvedLayers(p: Project): Layer[] {
  const layers = structuredClone(p.layers);
  for (const c of p.controls)
    for (const b of c.bindings) {
      const layer = layers.find((l) => l.id === b.layer);
      if (!layer) throw Error(`Control ${c.name}: unknown layer ${b.layer}`);
      applyBinding(layer, b, c.value);
    }
  return layers;
}
/** Runs within project validation. Base fields stay untouched, so edits never compound. */
export function validateControls(p: Project): string[] {
  const issues: string[] = [];
  if (new Set(p.controls.map((c) => c.id)).size !== p.controls.length)
    issues.push("Control IDs must be unique");
  if (new Set(p.variants.map((v) => v.id)).size !== p.variants.length)
    issues.push("Variant IDs must be unique");
  for (const v of p.variants)
    for (const [id, value] of Object.entries(v.values)) {
      const c = p.controls.find((c) => c.id === id);
      if (!c || value < c.min || value > c.max)
        issues.push(`Variant ${v.name}: invalid control ${id}`);
    }
  if (!p.controls.length) return issues;
  try {
    const layers = resolvedLayers(p);
    for (const layer of layers) {
      const result = layerSchema.safeParse(layer);
      if (!result.success)
        issues.push(
          `Controls produce invalid ${layer.id}: ${result.error.issues[0].message}`,
        );
      if (layer.motion.scale.some((k) => k.value < 0.01 || k.value > 16))
        issues.push(`Controls: ${layer.id}.motion.scale must stay in 0.01..16`);
      for (const key of [
        "opacity",
        "size",
        "width",
        "height",
        "radius",
        "cutoff",
      ])
        if (key in layer) {
          const curve = (layer as unknown as Record<string, Curve>)[key];
          if (
            curve.some(
              (k) =>
                k.value < 0 ||
                (["opacity", "cutoff"].includes(key) && k.value > 1),
            )
          )
            issues.push(
              `Controls: ${layer.id}.${key} is outside its allowed range`,
            );
        }
    }
    const births = layers.reduce(
      (n, l) =>
        n +
        (l.type !== "particles"
          ? 0
          : l.mode === "stream"
            ? Math.ceil(l.rate * l.duration)
            : l.count),
      0,
    );
    if (births > 4000)
      issues.push("Controls exceed 4000 particle births per cycle");
    const segments = layers.reduce(
      (n, l) =>
        n +
        (l.type === "particles"
          ? (l.mode === "stream" ? Math.ceil(l.rate * l.duration) : l.count) *
            l.trail.samples
          : 0),
      0,
    );
    if (segments > 16000)
      issues.push("Controls exceed 16000 trail segments per cycle");
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return issues;
}
export function resolveControls(p: Project): Project {
  return p.controls.length
    ? parseProject({
        ...p,
        layers: resolvedLayers(p),
        controls: [],
        variants: [],
      })
    : p;
}
export function setControl(p: Project, id: string, value: number): Project {
  if (!p.controls.some((c) => c.id === id))
    throw Error(`Unknown control ${id}`);
  return parseProject({
    ...p,
    controls: p.controls.map((c) => (c.id === id ? { ...c, value } : c)),
  });
}
export function captureVariant(p: Project, id: string, name: string): Project {
  const variant = {
    id,
    name,
    seed: p.seed,
    values: Object.fromEntries(p.controls.map((c) => [c.id, c.value])),
  };
  return parseProject({
    ...p,
    variants: [...p.variants.filter((v) => v.id !== id), variant],
  });
}
export function applyVariant(p: Project, id: string): Project {
  const v = p.variants.find((v) => v.id === id);
  if (!v) throw Error(`Unknown variant ${id}`);
  return parseProject({
    ...p,
    seed: v.seed,
    controls: p.controls.map((c) => ({
      ...c,
      value: v.values[c.id] ?? c.value,
    })),
  });
}

/** Useful controls are inferred from layer capabilities, never from a preset ID. */
export function quickControls(p: Project): Project {
  const occupied = new Set(p.controls.map((c) => c.id));
  const id = (base: string) => {
    let result = base,
      n = 2;
    while (occupied.has(result)) result = `${base}-${n++}`;
    occupied.add(result);
    return result;
  };
  const binding = (layer: string, target: string): Binding => ({
    layer,
    target,
    mode: "multiply",
    factor: 1,
    offset: 0,
  });
  return parseProject({
    ...p,
    controls: [
      ...p.controls,
      {
        id: id("size"),
        name: "Size",
        min: 0.25,
        max: Math.min(3, ...p.layers.map((l) => 16 / l.scale)),
        value: 1,
        step: 0.05,
        bindings: p.layers.map((l) => binding(l.id, "scale")),
      },
      {
        id: id("intensity"),
        name: "Intensity",
        min: 0.1,
        max: 2,
        value: 1,
        step: 0.05,
        bindings: p.layers.flatMap((l) => {
          const target =
            l.type === "particles"
              ? "size"
              : l.type === "path" || l.type === "ring"
                ? "width"
                : undefined;
          return target ? [binding(l.id, target)] : [];
        }),
      },
      {
        id: id("hue"),
        name: "Hue",
        min: -180,
        max: 180,
        value: 0,
        step: 1,
        bindings: p.layers.map((l) => ({
          ...binding(l.id, "colors.hue"),
          mode: "set",
        })),
      },
    ],
  });
}

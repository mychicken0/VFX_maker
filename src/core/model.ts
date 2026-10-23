import { MAX_LAYERS } from "./limits.js";
import { z } from "zod";
import { inspectPng } from "./pixels.js";
import { pixelOptionsSchema } from "./pixel-options.js";
import {
  modifierSchema,
  controlSchema,
  variantSchema,
} from "./creative-schema.js";
import { validateControls } from "./parameters.js";
import { emissionPixels } from "./emission.js";

export const VERSION = "0.7.3" as const;
const finite = z.number().finite();
const bounded = (min: number, max: number) => finite.min(min).max(max);
export const vecSchema = z
  .object({ x: bounded(-4096, 4096), y: bounded(-4096, 4096) })
  .strict();
export const colorSchema = z
  .string()
  .regex(/^#[\da-fA-F]{6}$/, "Use a six-digit hex color");
export const curveSchema = z
  .array(
    z
      .object({
        t: bounded(0, 1),
        value: bounded(-4096, 4096),
        ease: z.enum(["linear", "smooth", "hold"]).default("linear"),
      })
      .strict(),
  )
  .min(1)
  .max(32)
  .refine(
    (keys) => keys.every((k, i) => i === 0 || k.t > keys[i - 1].t),
    "Keyframe times must increase",
  );
export const gradientSchema = z
  .array(z.object({ t: bounded(0, 1), color: colorSchema }).strict())
  .min(1)
  .max(16)
  .refine(
    (keys) => keys.every((k, i) => i === 0 || k.t > keys[i - 1].t),
    "Color stops must increase",
  );
const range = (min: number, max: number) =>
  z
    .tuple([bounded(min, max), bounded(min, max)])
    .refine((v) => v[0] <= v[1], "Minimum must not exceed maximum");
const curveDefault = (a: number, b = a) => [
  { t: 0, value: a, ease: "linear" as const },
  { t: 1, value: b, ease: "linear" as const },
];
export const maskSchema = z
  .object({
    shape: z.enum(["rectangle", "ellipse", "polygon"]).default("rectangle"),
    position: vecSchema.default({ x: 0, y: 0 }),
    width: bounded(1, 1024).default(64),
    height: bounded(1, 1024).default(64),
    points: z
      .array(vecSchema)
      .min(3)
      .max(64)
      .default([
        { x: -32, y: 32 },
        { x: 0, y: -32 },
        { x: 32, y: 32 },
      ]),
  })
  .strict();
const common = {
  id: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
  name: z.string().min(1).max(100),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  mask: maskSchema.optional(),
  modifiers: z.array(modifierSchema).max(8).default([]),
  start: bounded(0, 20).default(0),
  duration: bounded(0.02, 20).default(1),
  repeat: z.boolean().default(false),
  position: vecSchema.default({ x: 64, y: 64 }),
  rotation: bounded(-3600, 3600).default(0),
  scale: bounded(0.01, 16).default(1),
  opacity: curveSchema.default(curveDefault(1, 0)),
  motion: z
    .object({
      x: curveSchema.default(curveDefault(0)),
      y: curveSchema.default(curveDefault(0)),
      rotation: curveSchema.default(curveDefault(0)),
      scale: curveSchema.default(curveDefault(1)),
    })
    .strict()
    .default({
      x: curveDefault(0),
      y: curveDefault(0),
      rotation: curveDefault(0),
      scale: curveDefault(1),
    }),
  blend: z.enum(["normal", "add", "screen", "multiply"]).default("add"),
  glow: z
    .object({
      strength: bounded(0, 4).default(0),
      blur: bounded(0, 16).default(3),
    })
    .strict()
    .default({ strength: 0, blur: 3 }),
};
export const particleSchema = z
  .object({
    ...common,
    type: z.literal("particles"),
    mode: z.enum(["burst", "stream", "path"]).default("burst"),
    count: z.number().int().min(1).max(2000).default(48),
    rate: bounded(1, 1000).default(60),
    life: range(0.02, 10).default([0.3, 0.8]),
    speed: range(0, 1000).default([30, 90]),
    angle: bounded(-3600, 3600).default(-90),
    spread: bounded(0, 360).default(360),
    spawn: z
      .object({
        shape: z
          .enum(["point", "disk", "ring", "box", "image"])
          .default("point"),
        asset: z.string().max(64).optional(),
        threshold: bounded(0, 1).default(0.1),
        radius: bounded(0, 512).default(10),
        width: bounded(0, 1024).default(20),
        height: bounded(0, 1024).default(20),
      })
      .strict()
      .default({
        shape: "point",
        radius: 10,
        width: 20,
        height: 20,
        threshold: 0.1,
      }),
    trail: z
      .object({
        samples: z.number().int().min(0).max(12).default(0),
        seconds: bounded(0.01, 2).default(0.12),
        width: bounded(0.1, 8).default(1),
        opacity: bounded(0, 1).default(0.5),
      })
      .strict()
      .default({ samples: 0, seconds: 0.12, width: 1, opacity: 0.5 }),
    points: z
      .array(vecSchema)
      .min(2)
      .max(64)
      .default([
        { x: -35, y: -35 },
        { x: 35, y: 35 },
      ]),
    travel: bounded(0.01, 10).default(0.2),
    gravity: vecSchema.default({ x: 0, y: 45 }),
    drag: bounded(0, 20).default(0.6),
    turbulence: bounded(0, 300).default(0),
    frequency: bounded(0.1, 30).default(4),
    shape: z.enum(["circle", "square", "spark", "sprite"]).default("spark"),
    asset: z.string().max(64).optional(),
    size: curveSchema.default(curveDefault(2, 0)),
    colors: gradientSchema.default([
      { t: 0, color: "#fff2b5" },
      { t: 1, color: "#ff4b22" },
    ]),
    spin: range(-3600, 3600).default([-180, 180]),
    stretch: bounded(1, 16).default(2),
    frameMode: z.enum(["life", "loop", "once", "pingpong"]).default("life"),
    frameFps: bounded(1, 120).default(12),
  })
  .strict();
export const pathSchema = z
  .object({
    ...common,
    type: z.literal("path"),
    points: z.array(vecSchema).min(2).max(64),
    handles: z
      .array(z.object({ in: vecSchema, out: vecSchema }).strict())
      .min(2)
      .max(64)
      .optional(),
    closed: z.boolean().default(false),
    width: curveSchema.default(curveDefault(5, 0)),
    draw: curveSchema.default([
      { t: 0, value: 0, ease: "linear" },
      { t: 0.2, value: 1, ease: "smooth" },
      { t: 1, value: 1, ease: "linear" },
    ]),
    taper: bounded(0, 1).default(0.8),
    colors: gradientSchema.default([
      { t: 0, color: "#fff6df" },
      { t: 1, color: "#ff2459" },
    ]),
  })
  .strict();
export const ringSchema = z
  .object({
    ...common,
    type: z.literal("ring"),
    radius: curveSchema.default(curveDefault(2, 42)),
    width: curveSchema.default(curveDefault(4, 0)),
    arc: bounded(1, 360).default(360),
    segments: z.number().int().min(3).max(128).default(64),
    colors: gradientSchema.default([
      { t: 0, color: "#ffffff" },
      { t: 1, color: "#ff3159" },
    ]),
  })
  .strict();
export const spriteSchema = z
  .object({
    ...common,
    type: z.literal("sprite"),
    asset: z.string().min(1).max(64),
    width: curveSchema.default(curveDefault(32, 48)),
    height: curveSchema.default(curveDefault(32, 48)),
    frameMode: z.enum(["life", "loop", "once", "pingpong"]).default("life"),
    frameFps: bounded(1, 120).default(12),
    colors: gradientSchema.default([{ t: 0, color: "#ffffff" }]),
  })
  .strict();
export const fieldSchema = z
  .object({
    ...common,
    type: z.literal("field"),
    pattern: z
      .enum(["noise", "cells", "radial", "box", "stripes"])
      .default("noise"),
    width: curveSchema.default(curveDefault(64)),
    height: curveSchema.default(curveDefault(64)),
    frequency: bounded(0.1, 64).default(6),
    speed: bounded(0, 20).default(1),
    octaves: z.number().int().min(1).max(5).default(3),
    cutoff: curveSchema.default(curveDefault(0.2, 0.85)),
    softness: bounded(0.001, 1).default(0.2),
    falloff: bounded(0, 1).default(0),
    highlight: colorSchema.default("#fff2b5"),
    colors: gradientSchema.default([
      { t: 0, color: "#ff3159" },
      { t: 1, color: "#7e1b70" },
    ]),
  })
  .strict();
export const layerSchema = z.discriminatedUnion("type", [
  particleSchema,
  pathSchema,
  ringSchema,
  spriteSchema,
  fieldSchema,
]);
// Retain a small validation cache so dragging a layer does not re-inflate its textures.
const validatedAssets = new Map<string, ReturnType<typeof inspectPng>>();
export const assetSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
    name: z.string().min(1).max(100),
    data: z
      .string()
      .max(1400000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
    width: z.number().int().min(1).max(1024),
    height: z.number().int().min(1).max(1024),
    columns: z.number().int().min(1).max(64).default(1),
    rows: z.number().int().min(1).max(64).default(1),
    frames: z.number().int().min(1).max(256).default(1),
  })
  .strict()
  .refine(
    (a) =>
      a.width % a.columns === 0 &&
      a.height % a.rows === 0 &&
      a.frames <= a.columns * a.rows,
    "Flipbook grid must divide the image and contain all frames",
  )
  .refine((a) => {
    try {
      if (a.data.length > 1400000) return false;
      let info = validatedAssets.get(a.data);
      if (!info) {
        const bytes = Uint8Array.from(atob(a.data.split(",")[1]), (c) =>
          c.charCodeAt(0),
        );
        if (bytes.length > 1048576) return false;
        info = inspectPng(bytes);
        if (validatedAssets.size >= 8)
          validatedAssets.delete(validatedAssets.keys().next().value!);
        validatedAssets.set(a.data, info);
      }
      return info.width === a.width && info.height === a.height;
    } catch {
      return false;
    }
  }, "Asset must be a valid static sRGB PNG of at most 1 MiB with matching dimensions (up to 8-bit)");
export const groupSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
    name: z.string().min(1).max(100),
    ids: z.array(z.string()).min(1).max(MAX_LAYERS),
  })
  .strict();
export const editorSchema = z
  .object({
    range: z
      .object({ start: bounded(0, 10), end: bounded(0, 10) })
      .strict()
      .optional(),
    reference: z
      .object({
        image: assetSchema,
        position: vecSchema.default({ x: 64, y: 64 }),
        scale: bounded(0.125, 8).default(1),
        opacity: bounded(0, 1).default(0.7),
        visible: z.boolean().default(true),
        plane: z.enum(["behind", "above"]).default("behind"),
      })
      .strict()
      .optional(),
  })
  .strict();
export const projectSchema = z
  .object({
    format: z.literal("vfx-maker").default("vfx-maker"),
    version: z
      .literal(VERSION, {
        error: `Unsupported project version; expected ${VERSION}`,
      })
      .default(VERSION),
    name: z.string().min(1).max(100).default("Untitled effect"),
    seed: z.number().int().min(0).max(0xffffffff).default(42),
    canvas: z
      .object({
        width: z.number().int().min(16).max(512),
        height: z.number().int().min(16).max(512),
        pixelArt: z.boolean().default(true),
        background: colorSchema.default("#110f19"),
      })
      .strict()
      .default({
        width: 128,
        height: 128,
        pixelArt: true,
        background: "#110f19",
      }),
    duration: bounded(0.1, 10).default(1.2),
    fps: z.number().int().min(1).max(60).default(30),
    loop: z.boolean().default(true),
    layers: z.array(layerSchema).max(MAX_LAYERS).default([]),
    assets: z.array(assetSchema).max(8).default([]),
    groups: z.array(groupSchema).max(MAX_LAYERS).default([]),
    controls: z.array(controlSchema).max(16).default([]),
    variants: z.array(variantSchema).max(12).default([]),
    editor: editorSchema.default({}),
    output: pixelOptionsSchema.default({
      scale: 1,
      colors: 0,
      dither: false,
      pixelSize: 1,
      alphaLevels: 0,
    }),
  })
  .strict()
  .superRefine((p, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set(p.layers.map((l) => l.id)).size !== p.layers.length)
      fail("Layer IDs must be unique");
    if (new Set(p.assets.map((a) => a.id)).size !== p.assets.length)
      fail("Asset IDs must be unique");
    if (new Set(p.groups.map((g) => g.id)).size !== p.groups.length)
      fail("Group IDs must be unique");
    const grouped = new Set<string>();
    for (const group of p.groups)
      for (const id of group.ids) {
        if (!p.layers.some((l) => l.id === id))
          fail(`Group ${group.id}: unknown layer ${id}`);
        if (grouped.has(id)) fail(`Layer ${id} belongs to more than one group`);
        grouped.add(id);
      }
    if (
      p.editor.range &&
      (p.editor.range.start >= p.editor.range.end ||
        p.editor.range.end > p.duration)
    )
      fail("Playback range must have start < end within effect duration");
    const assets = new Set(p.assets.map((a) => a.id));
    for (const issue of validateControls(p)) fail(issue);
    for (const l of p.layers) {
      if (
        l.type === "particles" &&
        l.mode !== "path" &&
        l.spawn.shape === "image" &&
        (!l.spawn.asset || !assets.has(l.spawn.asset))
      )
        fail(`${l.id}: image emission needs an existing PNG asset`);
      if (
        l.type === "particles" &&
        l.mode !== "path" &&
        l.spawn.shape === "image" &&
        l.spawn.asset &&
        assets.has(l.spawn.asset)
      ) {
        try {
          emissionPixels(
            p.assets.find((a) => a.id === l.spawn.asset)!,
            l.spawn.threshold,
          );
        } catch (e) {
          fail(`${l.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (new Set(l.modifiers.map((m) => m.id)).size !== l.modifiers.length)
        fail(`${l.id}: modifier IDs must be unique`);
      if (
        l.type === "field" &&
        l.cutoff.some((k) => k.value < 0 || k.value > 1)
      )
        fail(`${l.id}.cutoff must stay in 0..1`);
      if (
        l.type === "path" &&
        l.handles &&
        l.handles.length !== l.points.length
      )
        fail(`${l.id}: every Bezier anchor needs matching handles`);
      if (l.motion.scale.some((k) => k.value < 0.01 || k.value > 16))
        fail(`${l.id}.motion.scale must stay in 0.01..16`);
      if (
        (l.type === "sprite" ||
          (l.type === "particles" && l.shape === "sprite")) &&
        (!l.asset || !assets.has(l.asset))
      )
        fail(`Layer ${l.id} needs an existing sprite asset`);
      if (l.type === "particles" && l.repeat && l.life[1] > l.duration)
        fail(`Repeating layer ${l.id}: lifetime must fit in its cycle`);
      for (const key of [
        "opacity",
        "size",
        "width",
        "height",
        "radius",
      ] as const) {
        if (key in l) {
          const keys = (l as unknown as Record<string, Curve>)[key];
          if (
            keys.some((k) => k.value < 0 || (key === "opacity" && k.value > 1))
          )
            fail(`${l.id}.${key} is outside its allowed range`);
        }
      }
    }
    const births = p.layers.reduce(
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
      fail("A project supports at most 4000 particle births per cycle");
    const trailSegments = p.layers.reduce(
      (n, l) =>
        n +
        (l.type === "particles"
          ? (l.mode === "stream" ? Math.ceil(l.rate * l.duration) : l.count) *
            l.trail.samples
          : 0),
      0,
    );
    if (trailSegments > 16000)
      fail("Particle trails exceed 16000 segments per cycle");
    if (Math.ceil(p.duration * p.fps) > 300)
      fail("A project supports at most 300 frames");
    if (
      p.assets.reduce((n, a) => n + a.width * a.height, 0) +
        (p.editor.reference
          ? p.editor.reference.image.width * p.editor.reference.image.height
          : 0) >
      1048576
    )
      fail("Combined textures exceed one million pixels");
  });
export type Curve = z.infer<typeof curveSchema>;
export type Gradient = z.infer<typeof gradientSchema>;
export type Vec = z.infer<typeof vecSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type Particles = z.infer<typeof particleSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Project = z.infer<typeof projectSchema>;
export type LayerInput = z.input<typeof layerSchema>;
export type ProjectInput = z.input<typeof projectSchema>;
export function parseProject(value: unknown): Project {
  if (
    value &&
    typeof value === "object" &&
    "version" in value &&
    ["0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.7.1", "0.7.2"].includes(
      String(value.version),
    )
  )
    value = { ...value, version: VERSION };
  return projectSchema.parse(value);
}

export function parseText(text: string): Project {
  if (new TextEncoder().encode(text).length > 4 * 1024 * 1024)
    throw new Error("Project exceeds 4 MiB");
  const value: unknown = JSON.parse(text);
  if (value && typeof value === "object" && "schema_version" in value)
    throw new Error(
      "Unsupported project format. Use a vfx-maker .vfx.json project.",
    );
  return parseProject(value);
}

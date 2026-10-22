import { z } from "zod";
import { VERSION, type Project, type Layer } from "./model.js";
import { evaluate, frameIndex } from "./math.js";
import { COORDINATES, layerTransform, mapPoint } from "./spatial.js";
import { ParticleSampler } from "./simulation.js";

const time = z.number().finite().min(0).max(10);
export const observationSchema = z
  .object({
    view: z.enum(["frame", "storyboard", "layers"]).default("frame"),
    time: time.optional(),
    times: z.array(time).min(1).max(9).optional(),
    ids: z.array(z.string().min(1).max(64)).min(1).max(32).optional(),
    crop: z
      .object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().min(1).max(512),
        height: z.number().int().min(1).max(512),
      })
      .strict()
      .optional(),
    scale: z.number().finite().min(0.25).max(8).optional(),
    grid: z.boolean().default(true),
    guides: z.boolean().default(true),
    background: z.enum(["checker", "dark", "transparent"]).default("checker"),
    includeReference: z.boolean().default(true),
    point: z
      .object({
        x: z.number().finite().min(0),
        y: z.number().finite().min(0),
        threshold: z.number().int().min(1).max(255).default(8),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ObservationInput = z.input<typeof observationSchema>;
export type ObservationOptions = z.infer<typeof observationSchema>;
export type Rect = { x: number; y: number; width: number; height: number };
export interface PixelMetrics {
  visiblePixels: number;
  alphaMass: number;
  bounds: Rect | null;
  touches: ("left" | "top" | "right" | "bottom")[];
}
/** Bounds are measured from rendered alpha, not guessed from a layer's anchor. */
export function pixelMetrics(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  crop: Rect = { x: 0, y: 0, width, height },
): PixelMetrics {
  let left = width,
    top = height,
    right = -1,
    bottom = -1,
    visiblePixels = 0,
    alpha = 0;
  for (let y = crop.y; y < crop.y + crop.height; y++)
    for (let x = crop.x; x < crop.x + crop.width; x++) {
      const a = rgba[(y * width + x) * 4 + 3];
      if (!a) continue;
      visiblePixels++;
      alpha += a;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  const touches: PixelMetrics["touches"] = [];
  if (visiblePixels) {
    if (left === 0) touches.push("left");
    if (top === 0) touches.push("top");
    if (right === width - 1) touches.push("right");
    if (bottom === height - 1) touches.push("bottom");
  }
  return {
    visiblePixels,
    alphaMass: Math.round((alpha / 255) * 1000) / 1000,
    bounds: visiblePixels
      ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
      : null,
    touches,
  };
}
export function timelineTimes(p: Project, count = 6) {
  const frames = Math.max(1, Math.ceil(p.duration * p.fps - 1e-9)),
    n = Math.min(count, frames);
  return Array.from({ length: n }, (_, i) =>
    n === 1 ? 0 : Math.round((i * (frames - 1)) / (n - 1)) / p.fps,
  );
}
export function candidateTimes(p: Project): number[] {
  const all = new Set(timelineTimes(p, 8));
  for (const l of p.layers) {
    all.add(l.start + Math.min(l.duration / 4, 0.5 / p.fps));
    all.add(l.start + l.duration / 2);
    for (const k of l.opacity) all.add(l.start + k.t * l.duration);
  }
  const sorted = [...all]
    .filter((t) => t >= 0 && t < p.duration)
    .sort((a, b) => a - b);
  return sorted.length <= 20
    ? sorted
    : Array.from(
        { length: 20 },
        (_, i) => sorted[Math.round((i * (sorted.length - 1)) / 19)],
      );
}
export function validateObservation(p: Project, o: ObservationOptions) {
  if (
    (o.time !== undefined && o.time > p.duration) ||
    o.times?.some((t) => t > p.duration)
  )
    throw Error("Observation time is outside the effect duration");
  if (o.times && o.view !== "storyboard")
    throw Error(
      "Use times only with storyboard view; use time for a single frame or layer sheet",
    );
  if (o.view === "storyboard" && o.time !== undefined)
    throw Error("Use times with storyboard view, not time");
  if (
    o.ids &&
    (new Set(o.ids).size !== o.ids.length ||
      o.ids.some((id) => !p.layers.some((l) => l.id === id)))
  )
    throw Error(
      "Supply distinct existing layer IDs; inspect the scene to discover IDs",
    );
  if (
    o.crop &&
    (o.crop.x + o.crop.width > p.canvas.width ||
      o.crop.y + o.crop.height > p.canvas.height)
  )
    throw Error("Crop must lie inside the canvas in original canvas pixels");
  if (o.point && (o.point.x >= p.canvas.width || o.point.y >= p.canvas.height))
    throw Error(
      "Pick point must be inside the canvas in original canvas pixels",
    );
}
const rounded = (n: number) => Math.round(n * 10000) / 10000;
const roundPoint = (p: { x: number; y: number }) => ({
  x: rounded(p.x),
  y: rounded(p.y),
});
function describeLayer(
  p: Project,
  source: Layer,
  l: Layer,
  time: number,
  sampler: ParticleSampler,
  controls: Project["controls"],
) {
  const transform = layerTransform(l, time),
    u = transform.progress;
  const geometry = (() => {
    switch (l.type) {
      case "path":
        return {
          type: l.type,
          worldPoints: l.points.map((q) =>
            roundPoint(mapPoint(transform.localToCanvas, q)),
          ),
          localPoints: l.points,
          handles: l.handles,
          closed: l.closed,
          width: evaluate(l.width, u),
          draw: evaluate(l.draw, u),
          taper: l.taper,
        };
      case "ring":
        return {
          type: l.type,
          radius: evaluate(l.radius, u),
          width: evaluate(l.width, u),
          arc: l.arc,
        };
      case "field":
        return {
          type: l.type,
          width: evaluate(l.width, u),
          height: evaluate(l.height, u),
          pattern: l.pattern,
          cutoff: evaluate(l.cutoff, u),
        };
      case "sprite": {
        const asset = p.assets.find((a) => a.id === l.asset)!;
        return {
          type: l.type,
          asset: l.asset,
          width: evaluate(l.width, u),
          height: evaluate(l.height, u),
          frame: frameIndex(
            l.frameMode,
            transform.localTime ?? 0,
            l.duration,
            l.frameFps,
            asset.frames,
          ),
          frames: asset.frames,
        };
      }
      case "particles": {
        const particles = sampler
          .sample(l, time)
          .filter((s) => s.alpha > 0 && s.size > 0);
        return {
          type: l.type,
          mode: l.mode,
          alive: particles.length,
          sampleLimit: 12,
          samples: particles.slice(0, 12).map((s) => ({
            id: s.id,
            ...roundPoint(mapPoint(transform.localToCanvas, s)),
            size: rounded(s.size * Math.abs(transform.scale)),
            alpha: rounded(s.alpha),
            color: "#" + s.color.toString(16).padStart(6, "0"),
          })),
        };
      }
    }
  })();
  return {
    id: l.id,
    name: l.name,
    type: l.type,
    order: p.layers.indexOf(l),
    visible: l.visible,
    locked: l.locked,
    baseTransform: {
      position: source.position,
      rotation: source.rotation,
      scale: source.scale,
    },
    resolvedTransform: {
      position: l.position,
      rotation: l.rotation,
      scale: l.scale,
    },
    transform,
    timing: {
      start: l.start,
      end: l.start + l.duration,
      duration: l.duration,
      repeat: l.repeat,
      active: transform.localTime !== null,
    },
    opacity:
      l.type === "particles" ? "per-particle age" : evaluate(l.opacity, u),
    geometry,
    mask: l.mask ?? null,
    modifiers: l.modifiers.map((m) => ({
      id: m.id,
      type: m.type,
      enabled: m.enabled,
    })),
    drivenBy: controls.flatMap((c) =>
      c.bindings
        .filter((b) => b.layer === l.id)
        .map((b) => ({
          control: c.id,
          value: c.value,
          target: b.target,
          mode: b.mode,
          factor: b.factor,
          offset: b.offset,
        })),
    ),
  };
}
export function describeScene(
  source: Project,
  resolved: Project,
  time: number,
  ids?: string[],
) {
  const sampler = new ParticleSampler(resolved);
  return {
    version: VERSION,
    name: source.name,
    seed: source.seed,
    canvas: source.canvas,
    duration: source.duration,
    fps: source.fps,
    loop: source.loop,
    coordinates: COORDINATES,
    time,
    layerCount: source.layers.length,
    scope: ids ?? source.layers.map((l) => l.id),
    controls: source.controls.map((c) => ({
      id: c.id,
      name: c.name,
      value: c.value,
      min: c.min,
      max: c.max,
    })),
    layers: resolved.layers
      .filter((l) => !ids || ids.includes(l.id))
      .map((l) =>
        describeLayer(
          resolved,
          source.layers.find((s) => s.id === l.id)!,
          l,
          time,
          sampler,
          source.controls,
        ),
      ),
  };
}
export type DescribedLayer = ReturnType<typeof describeScene>["layers"][number];
export type ObservedLayer = DescribedLayer & {
  pixels: PixelMetrics;
  geometryBounds: Rect | null;
  state: string;
  pickAlpha?: number;
};
export interface ObservedFrame extends PixelMetrics {
  time: number;
  frameIndex: number | null;
  cropPixels: number;
}
export interface ObservationTile {
  time: number;
  layer?: string;
  image: string;
  viewport: Rect;
  crop: Rect;
  pixelsPerCanvasPixel: number;
}
export interface ObservationImage {
  name: string;
  role: "annotated" | "frame" | "layer";
  width: number;
  height: number;
  time?: number;
  layer?: string;
}
export interface ObservationReport extends Omit<
  ReturnType<typeof describeScene>,
  "layers"
> {
  view: ObservationOptions["view"];
  draft: boolean;
  layers: ObservedLayer[];
  frames: ObservedFrame[];
  sampling: { automatic: boolean; times: number[]; basis: string };
  reference: {
    displayed: boolean;
    excludedFromPixels: true;
    name?: string;
    position?: { x: number; y: number };
    scale?: number;
    plane?: string;
  };
  point?: { x: number; y: number; threshold: number };
  hits?: string[];
  warnings: { code: string; message: string; ids?: string[] }[];
  images: ObservationImage[];
  tiles: ObservationTile[];
  omittedLayerIds: string[];
}

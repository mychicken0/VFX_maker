import { z } from "zod";
const n = (min: number, max: number) => z.number().finite().min(min).max(max);
export const stageVectorSchema = z
  .object({ x: n(-4096, 4096), y: n(-4096, 4096), z: n(-4096, 4096) })
  .strict();
export const stagePlacementSchema = z
  .object({
    plane: z.enum(["ground", "upright", "billboard"]).default("ground"),
    position: stageVectorSchema.default({ x: 0, y: 0, z: 0 }),
    rotation: stageVectorSchema.default({ x: 0, y: 0, z: 0 }),
    scale: n(0.01, 16).default(1),
    stretch: z
      .object({ x: n(0.01, 16), y: n(0.01, 16), z: n(0.01, 16) })
      .strict()
      .default({ x: 1, y: 1, z: 1 }),
  })
  .strict();
export const stageSchema = z
  .object({
    mode: z.enum(["2.5d", "3d"]).default("2.5d"),
    projection: z.enum(["orthographic", "perspective"]).default("orthographic"),
    azimuth: n(-360, 360).default(45),
    elevation: n(-85, 89).default(35.264),
    distance: n(16, 8192).default(320),
    span: n(16, 4096).default(192),
    fov: n(15, 100).default(45),
    target: stageVectorSchema.default({ x: 0, y: 0, z: 0 }),
    plane: z.enum(["ground", "upright", "billboard"]).default("ground"),
    layers: z
      .record(z.string().regex(/^[a-zA-Z][\w-]{0,63}$/), stagePlacementSchema)
      .refine((v) => Object.keys(v).length <= 64, "At most 64 stage placements")
      .default({}),
  })
  .strict();
export type Stage = z.infer<typeof stageSchema>;
export type StagePlacement = z.infer<typeof stagePlacementSchema>;
export const STAGE_COORDINATES = {
  units: "canvas-pixel world units",
  x: "right",
  y: "up",
  z: "world front (+Z); camera orbits independently",
  rotation: "local XYZ Euler degrees",
  source:
    "each layer is its full original canvas rendered on a plane, centered at world origin",
  export:
    "camera-baked RGBA; grid, axes and reference character are preview-only",
  geometry:
    "textured effect planes, not volumetric XYZ particles or mesh simulation",
} as const;
export function stageDefaults(mode: Stage["mode"] = "2.5d"): Stage {
  return stageSchema.parse(
    mode === "2.5d"
      ? {}
      : {
          mode,
          projection: "perspective",
          plane: "upright",
          azimuth: 25,
          elevation: 20,
          distance: 240,
        },
  );
}

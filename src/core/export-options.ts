import { z } from "zod";
import { pixelOptionsSchema } from "./pixel-options.js";
import type { Project } from "./model.js";
export const exportOptionsSchema = z
  .object({
    view: z.enum(["effect", "stage"]).default("effect"),
    format: z
      .enum(["gif", "spritesheet", "sequence", "godot", "unity"])
      .default("spritesheet"),
    fps: z.number().int().min(1).max(60).optional(),
    start: z.number().finite().min(0).max(10).optional(),
    end: z.number().finite().min(0).max(10).optional(),
    scale: pixelOptionsSchema.shape.scale.removeDefault().optional(),
    colors: pixelOptionsSchema.shape.colors.removeDefault().optional(),
    dither: pixelOptionsSchema.shape.dither.removeDefault().optional(),
    pixelSize: pixelOptionsSchema.shape.pixelSize.removeDefault().optional(),
    alphaLevels: pixelOptionsSchema.shape.alphaLevels
      .removeDefault()
      .optional(),
    padding: z.number().int().min(0).max(16).default(2),
    extrude: z.boolean().default(false),
    matte: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();
export type ExportOptions = z.input<typeof exportOptionsSchema>;

/** Fit rectangular frames into an engine-compatible atlas, including padding. */
export function atlasLayout(
  width: number,
  height: number,
  frames: number,
  padding = 2,
) {
  if (!Number.isInteger(padding) || padding < 0 || padding > 16)
    throw new Error("Atlas padding must be an integer in 0..16");
  if (![width, height, frames].every((n) => Number.isInteger(n) && n > 0))
    throw new Error(
      "Atlas dimensions and frame count must be positive integers",
    );
  const cellWidth = width + padding * 2,
    cellHeight = height + padding * 2;
  const columns = Math.min(
    frames,
    Math.max(1, Math.ceil(Math.sqrt((frames * cellHeight) / cellWidth))),
    Math.floor(8192 / cellWidth),
  );
  const rows = Math.ceil(frames / columns);
  if (columns < 1 || rows * cellHeight > 8192)
    throw new Error("Atlas exceeds the 8192-pixel engine texture limit");
  return {
    columns,
    rows,
    padding,
    width: columns * cellWidth,
    height: rows * cellHeight,
  };
}

export interface BudgetCheck {
  resource: string;
  used: number;
  limit: number;
  passed: boolean;
}
/** The same preflight is used by exports, batch preparation and the agent tool. */
export function preflightExport(project: Project, input: ExportOptions = {}) {
  const options = exportOptionsSchema.parse(input),
    pixels = pixelOptionsSchema.parse({
      ...project.output,
      ...Object.fromEntries(
        Object.entries(options).filter(
          ([key, value]) => key in project.output && value !== undefined,
        ),
      ),
    });
  const fps = options.fps ?? project.fps,
    start = options.start ?? 0,
    end = options.end ?? project.duration,
    duration = end - start;
  if (start >= end || end > project.duration)
    throw Error("Export range must have start < end within effect duration");
  const count = Math.ceil(duration * fps - 1e-9),
    source = project.canvas,
    size = {
      width: Math.max(1, Math.round(source.width * pixels.scale)),
      height: Math.max(1, Math.round(source.height * pixels.scale)),
    };
  const check = (
    resource: string,
    used: number,
    limit: number,
  ): BudgetCheck => ({ resource, used, limit, passed: used <= limit });
  const checks = [
    check("imageWidth", size.width, 4096),
    check("imageHeight", size.height, 4096),
    check("imagePixels", size.width * size.height, 4194304),
    check("frames", count, 300),
    check("sourcePixels", count * source.width * source.height, 16777216),
    check(
      "outputPixels",
      count * size.width * size.height,
      options.format === "gif" ? 33554432 : 16777216,
    ),
  ];
  if (options.view === "stage")
    checks.push(
      check(
        "stageLayerPixels",
        count *
          source.width *
          source.height *
          project.layers.filter((l) => l.visible).length,
        67108864,
      ),
    );
  let atlas: ReturnType<typeof atlasLayout> | null = null,
    layoutError: string | undefined;
  if (!["gif", "sequence"].includes(options.format)) {
    try {
      atlas = atlasLayout(size.width, size.height, count, options.padding);
      checks.push(check("atlasPixels", atlas.width * atlas.height, 33554432));
    } catch (e) {
      layoutError = e instanceof Error ? e.message : String(e);
    }
  }
  const plan = {
    options,
    pixels,
    fps,
    count,
    start,
    end,
    duration,
    ...size,
    atlas,
  };
  const ok = checks.every((c) => c.passed) && !layoutError;
  return {
    ok,
    checks,
    plan,
    layoutError,
    estimatedSourceRgbaBytes: count * source.width * source.height * 4,
    estimatedOutputRgbaBytes: count * size.width * size.height * 4,
    suggestions: ok
      ? []
      : [
          "Reduce frame rate, duration or output scale; use sequence export when the atlas layout is too large.",
        ],
  };
}
export class ExportBudgetError extends Error {
  constructor(readonly preflight: ReturnType<typeof preflightExport>) {
    super(
      "Export budget exceeded: " +
        [
          ...preflight.checks
            .filter((c) => !c.passed)
            .map((c) => `${c.resource} ${c.used} / ${c.limit}`),
          ...(preflight.layoutError ? [preflight.layoutError] : []),
        ].join("; "),
    );
  }
}
export function exportPlan(project: Project, input: ExportOptions = {}) {
  const report = preflightExport(project, input);
  if (!report.ok) throw new ExportBudgetError(report);
  return report.plan;
}

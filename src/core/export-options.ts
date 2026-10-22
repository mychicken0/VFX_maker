import { z } from "zod";
import { outputSize, pixelOptionsSchema } from "./pixel-options.js";
import type { Project } from "./model.js";
export const exportOptionsSchema = z
  .object({
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

/** Validate memory budgets before allocating frame buffers or opening an export. */
export function exportPlan(project: Project, input: ExportOptions = {}) {
  const options = exportOptionsSchema.parse(input);
  const pixels = pixelOptionsSchema.parse({
    ...project.output,
    ...Object.fromEntries(
      Object.entries(options).filter(
        ([key, value]) => key in project.output && value !== undefined,
      ),
    ),
  });
  const fps = options.fps ?? project.fps;
  const start = options.start ?? 0,
    end = options.end ?? project.duration,
    duration = end - start;
  if (start >= end || end > project.duration)
    throw Error("Export range must have start < end within effect duration");
  const count = Math.ceil(duration * fps - 1e-9);
  const source = project.canvas;
  if (count > 300 || count * source.width * source.height > 16777216)
    throw new Error(
      "Export budget exceeded (300 frames / 16 million source pixels)",
    );
  const size = outputSize(source.width, source.height, pixels.scale);
  if (
    count * size.width * size.height >
    (options.format === "gif" ? 33554432 : 16777216)
  )
    throw new Error(
      "Output pixel budget exceeded. Reduce scale, frame rate or duration.",
    );
  const atlas = ["gif", "sequence"].includes(options.format)
    ? null
    : atlasLayout(size.width, size.height, count, options.padding);
  if (atlas && atlas.width * atlas.height > 33554432)
    throw new Error("Atlas pixel budget exceeded. Reduce scale or padding.");
  return { options, pixels, fps, count, start, end, duration, ...size, atlas };
}

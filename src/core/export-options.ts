import { z } from "zod";
export const exportOptionsSchema = z
  .object({
    format: z
      .enum(["gif", "spritesheet", "sequence", "godot", "unity"])
      .default("spritesheet"),
    fps: z.number().int().min(1).max(60).optional(),
    scale: z.number().int().min(1).max(8).default(1),
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

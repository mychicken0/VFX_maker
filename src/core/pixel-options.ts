import { z } from "zod";
export const pixelOptionsSchema = z
  .object({
    scale: z.number().finite().min(0.125).max(8).default(1),
    colors: z
      .union([z.literal(0), z.number().int().min(2).max(256)])
      .default(0),
    dither: z.boolean().default(false),
    pixelSize: z.number().int().min(1).max(16).default(1),
    alphaLevels: z
      .union([z.literal(0), z.number().int().min(2).max(256)])
      .default(0),
  })
  .strict();
export type PixelOptions = z.infer<typeof pixelOptionsSchema>;
export type PixelInput = z.input<typeof pixelOptionsSchema>;
export function outputSize(
  width: number,
  height: number,
  scale: number,
  limit = 4194304,
) {
  if (
    ![width, height].every((n) => Number.isInteger(n) && n > 0) ||
    !Number.isFinite(scale) ||
    scale < 0.125 ||
    scale > 8
  )
    throw new Error("Invalid image dimensions or scale");
  const w = Math.max(1, Math.round(width * scale)),
    h = Math.max(1, Math.round(height * scale));
  if (w > 4096 || h > 4096 || w * h > limit)
    throw new Error(
      "Resized image exceeds the 4096-side / four-million-pixel limit",
    );
  return { width: w, height: h };
}

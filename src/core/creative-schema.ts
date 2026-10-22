import { z } from "zod";

export const identifier = z.string().regex(/^[a-zA-Z][\w-]{0,63}$/);
const number = (min: number, max: number) =>
  z.number().finite().min(min).max(max);
const color = z.string().regex(/^#[\da-fA-F]{6}$/);
const common = { id: identifier, enabled: z.boolean().default(true) };
/** Ordered, portable operations. No preset names or executable expressions. */
export const modifierSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("outline"),
      thickness: number(0, 16).default(1),
      color: color.default("#ffffff"),
      alpha: number(0, 1).default(1),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("pixelate"),
      size: number(1, 16).int().default(2),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("color-replace"),
      from: color.default("#ffffff"),
      to: color.default("#ff3159"),
      tolerance: number(0, 1).default(0.1),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("ramp"),
      low: color.default("#470b35"),
      high: color.default("#fff2b5"),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("shockwave"),
      amplitude: number(0, 32).default(8),
      wavelength: number(1, 256).default(32),
      speed: number(0, 1000).default(90),
      radius: number(1, 1024).default(128),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("noise-warp"),
      strength: number(0, 32).default(4),
      frequency: number(0.1, 64).default(6),
      speed: number(0, 20).default(1),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("dissolve"),
      amount: number(0, 1).default(0.3),
      frequency: number(0.1, 64).default(8),
      speed: number(0, 20).default(0),
      edge: number(0, 0.5).default(0.06),
      color: color.default("#ffdd77"),
    })
    .strict(),
]);
export const bindingSchema = z
  .object({
    layer: identifier,
    target: z.string().min(1).max(160),
    mode: z.enum(["set", "multiply", "add"]).default("multiply"),
    factor: number(-4096, 4096).default(1),
    offset: number(-4096, 4096).default(0),
  })
  .strict();
export const controlSchema = z
  .object({
    id: identifier,
    name: z.string().min(1).max(100),
    min: number(-4096, 4096).default(0),
    max: number(-4096, 4096).default(2),
    value: number(-4096, 4096).default(1),
    step: number(0.001, 4096).default(0.01),
    bindings: z.array(bindingSchema).max(64).default([]),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.min >= c.max || c.value < c.min || c.value > c.max)
      ctx.addIssue({
        code: "custom",
        message: "Control value must fit within min < max",
      });
  });
export const variantSchema = z
  .object({
    id: identifier,
    name: z.string().min(1).max(100),
    seed: z.number().int().min(0).max(0xffffffff),
    values: z.record(identifier, number(-4096, 4096)),
  })
  .strict();
export type Modifier = z.infer<typeof modifierSchema>;
export type Control = z.infer<typeof controlSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export type Variant = z.infer<typeof variantSchema>;

export function modifierRange(type: Modifier["type"], key: string) {
  const option = modifierSchema.options.find(
    (option) => option.shape.type.value === type,
  )!;
  let schema = (option.shape as Record<string, z.ZodType>)[key];
  while (schema instanceof z.ZodDefault) schema = schema.unwrap() as z.ZodType;
  if (!(schema instanceof z.ZodNumber))
    throw Error("Not a numeric modifier parameter");
  return {
    min: schema.minValue ?? -4096,
    max: schema.maxValue ?? 4096,
    step: schema.isInt ? 1 : 0.01,
  };
}

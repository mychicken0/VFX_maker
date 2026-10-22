import {
  layerSchema,
  parseProject,
  type Curve,
  type Gradient,
  type LayerInput,
  type Project,
  type ProjectInput,
  type Vec,
} from "./model.js";
export const curve = (...values: number[]): Curve =>
  values.map((value, i) => ({
    t: values.length === 1 ? 0 : i / (values.length - 1),
    value,
    ease: "linear",
  }));
export const colors = (...values: string[]): Gradient =>
  values.map((color, i) => ({
    t: values.length === 1 ? 0 : i / (values.length - 1),
    color,
  }));
export const defineEffect = (project: ProjectInput): Project =>
  parseProject(project);
type InputOf<T extends LayerInput["type"]> = Omit<
  Extract<LayerInput, { type: T }>,
  "type"
>;
export const particles = (input: InputOf<"particles">) =>
  layerSchema.parse({ ...input, type: "particles" });
export const path = (input: InputOf<"path">) =>
  layerSchema.parse({ ...input, type: "path" });
export const ring = (input: InputOf<"ring">) =>
  layerSchema.parse({ ...input, type: "ring" });
export const sprite = (input: InputOf<"sprite">) =>
  layerSchema.parse({ ...input, type: "sprite" });
export function arcPoints(
  radius: number,
  from = 0,
  to = 360,
  steps = 32,
): Vec[] {
  if (!Number.isInteger(steps) || steps < 1 || steps > 63)
    throw new Error("Use 1..63 arc steps");
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
}
export const serialize = (project: Project) =>
  JSON.stringify(parseProject(project), null, 2) + "\n";

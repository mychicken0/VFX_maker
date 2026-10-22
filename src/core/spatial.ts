import { evaluate } from "./math.js";
import { localTime } from "./simulation.js";
import type { Layer, Project, Vec } from "./model.js";

/** Canvas uses top-left origin, +X right, +Y down, clockwise degrees. */
export const COORDINATES = {
  origin: "top-left",
  x: "right",
  y: "down",
  units: "canvas pixels before export scaling",
  rotation: "clockwise degrees; zero points right",
  position: "layer anchor in canvas pixels, before animated motion",
  points: "layer-local offsets from the animated anchor",
  geometry:
    "width/radius/handle offsets and masks are layer-local; worldPoints and pixel bounds are canvas coordinates",
  normalized: "x * canvas.width, y * canvas.height",
  time: "project seconds; keyframe t is normalized within each layer",
  layerOrder: "bottom to top; the last layer is in front",
} as const;
export type Matrix = [number, number, number, number, number, number];
export function mapPoint(m: Matrix, p: Vec): Vec {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}
export function layerTransform(layer: Layer, time: number) {
  const t = localTime(layer, time),
    u =
      t === null
        ? Math.max(0, Math.min(1, (time - layer.start) / layer.duration))
        : t / layer.duration,
    rotation = layer.rotation + evaluate(layer.motion.rotation, u),
    scale = layer.scale * evaluate(layer.motion.scale, u),
    radians = (rotation * Math.PI) / 180,
    a = Math.cos(radians) * scale,
    b = Math.sin(radians) * scale,
    x = layer.position.x + evaluate(layer.motion.x, u),
    y = layer.position.y + evaluate(layer.motion.y, u),
    matrix: Matrix = [a, b, -b, a, x, y],
    det = a * a + b * b,
    inverse: Matrix | null =
      det < 1e-16
        ? null
        : [
            a / det,
            -b / det,
            b / det,
            a / det,
            (-a * x - b * y) / det,
            (b * x - a * y) / det,
          ];
  return {
    anchor: { x, y },
    rotation,
    scale,
    localTime: t,
    progress: u,
    localToCanvas: matrix,
    canvasToLocal: inverse,
  };
}
export function pointToLocal(
  p: Project,
  l: Layer,
  point: Vec,
  space: "local" | "canvas" | "normalized",
  time: number,
  vector = false,
): Vec {
  if (space === "local") return { ...point };
  const transform = layerTransform(l, time),
    inverse = transform.canvasToLocal;
  if (!inverse)
    throw Error(
      "Layer scale is zero at this time; choose a visible time for canvas-coordinate editing",
    );
  const q =
    space === "normalized"
      ? { x: point.x * p.canvas.width, y: point.y * p.canvas.height }
      : point;
  return mapPoint(
    vector ? [inverse[0], inverse[1], inverse[2], inverse[3], 0, 0] : inverse,
    q,
  );
}

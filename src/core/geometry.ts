import type { Layer, Vec } from "./model.js";
export type PathLayer = Extract<Layer, { type: "path" }>;
export function defaultHandles(points: Vec[], closed = false) {
  return points.map((p, i) => {
    const prev = points[i - 1] ?? (closed ? points.at(-1)! : p),
      next = points[i + 1] ?? (closed ? points[0] : p),
      x = (next.x - prev.x) / 6,
      y = (next.y - prev.y) / 6;
    return { in: { x: -x, y: -y }, out: { x, y } };
  });
}
/** Editing a path must keep its optional Bezier handles aligned with anchors. */
export function editPathPoints(
  layer: PathLayer,
  index: number,
  action: "insert" | "remove" | "smooth" | "corner",
): PathLayer {
  if (!Number.isInteger(index) || !layer.points[index])
    throw Error("Choose a valid path point");
  if (layer.locked) throw Error("Unlock the path before editing its points");
  const next = structuredClone(layer);
  if (action === "insert") {
    if (next.points.length >= 64)
      throw Error("A path can have up to 64 points");
    const a = next.points[index],
      b =
        next.points[index + 1] ??
        (next.closed ? next.points[0] : { x: a.x + 12, y: a.y });
    next.points.splice(index + 1, 0, {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
    next.handles?.splice(index + 1, 0, {
      in: { x: 0, y: 0 },
      out: { x: 0, y: 0 },
    });
  } else if (action === "remove") {
    if (next.points.length <= 2)
      throw Error("A path needs at least two points");
    next.points.splice(index, 1);
    next.handles?.splice(index, 1);
  } else {
    next.handles ??= next.points.map(() => ({
      in: { x: 0, y: 0 },
      out: { x: 0, y: 0 },
    }));
    next.handles[index] =
      action === "smooth"
        ? defaultHandles(next.points, next.closed)[index]
        : { in: { x: 0, y: 0 }, out: { x: 0, y: 0 } };
  }
  return next;
}
export function pathPolyline(layer: PathLayer): Vec[] {
  if (!layer.handles)
    return layer.closed ? [...layer.points, layer.points[0]] : layer.points;
  const out: Vec[] = [layer.points[0]],
    segments = layer.closed ? layer.points.length : layer.points.length - 1;
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % layer.points.length,
      a = layer.points[i],
      b = layer.points[next],
      ha = layer.handles[i].out,
      hb = layer.handles[next].in;
    const distance =
        Math.hypot(b.x - a.x, b.y - a.y) +
        Math.hypot(ha.x, ha.y) +
        Math.hypot(hb.x, hb.y),
      steps = Math.max(4, Math.min(64, Math.ceil(distance / 2)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps,
        u = 1 - t;
      out.push({
        x:
          u * u * u * a.x +
          3 * u * u * t * (a.x + ha.x) +
          3 * u * t * t * (b.x + hb.x) +
          t * t * t * b.x,
        y:
          u * u * u * a.y +
          3 * u * u * t * (a.y + ha.y) +
          3 * u * t * t * (b.y + hb.y) +
          t * t * t * b.y,
      });
    }
  }
  return out;
}
function distanceSquared(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t =
      dx || dy
        ? Math.max(
            0,
            Math.min(
              1,
              ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy),
            ),
          )
        : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}
function simplify(points: Vec[], epsilon: number): Vec[] {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]),
    stack: [[number, number]] | [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let at = -1,
      max = epsilon * epsilon;
    for (let i = start + 1; i < end; i++) {
      const d = distanceSquared(points[i], points[start], points[end]);
      if (d > max) {
        max = d;
        at = i;
      }
    }
    if (at >= 0) {
      keep.add(at);
      stack.push([start, at], [at, end]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}
/** Bounded simplification keeps the original endpoints and expressive corners. */
export function simplifyStroke(points: Vec[], tolerance = 0.75): Vec[] {
  const clean = points.filter(
    (p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y,
  );
  if (
    clean.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
    clean.length > 20000
  )
    throw Error("Invalid or oversized stroke");
  let result = simplify(clean, tolerance);
  while (result.length > 64) {
    tolerance = Math.max(0.01, tolerance * 1.5);
    result = simplify(clean, tolerance);
  }
  return result;
}

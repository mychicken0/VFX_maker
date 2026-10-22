import type { Curve, Gradient, Vec } from "./model.js";
export const clamp = (v: number, lo = 0, hi = 1) =>
  Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function evaluate(keys: Curve, t: number): number {
  if (t <= keys[0].t) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i];
    if (t <= b.t) {
      if (t === b.t) return b.value;
      let u = (t - a.t) / (b.t - a.t);
      if (a.ease === "hold") u = 0;
      if (a.ease === "smooth") u = u * u * (3 - 2 * u);
      return lerp(a.value, b.value, u);
    }
  }
  return keys.at(-1)!.value;
}
export function colorAt(stops: Gradient, t: number): number {
  const rgb = (s: string) => parseInt(s.slice(1), 16);
  if (t <= stops[0].t) return rgb(stops[0].color);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1],
      b = stops[i];
    if (t <= b.t) {
      const u = (t - a.t) / (b.t - a.t),
        x = rgb(a.color),
        y = rgb(b.color);
      return (
        (Math.round(lerp(x >> 16, y >> 16, u)) << 16) |
        (Math.round(lerp((x >> 8) & 255, (y >> 8) & 255, u)) << 8) |
        Math.round(lerp(x & 255, y & 255, u))
      );
    }
  }
  return rgb(stops.at(-1)!.color);
}
export function hash(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function random(seed: number): () => number {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pointOnPath(points: Vec[], u: number): Vec {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total === 0) return { ...points[0] };
  let d = clamp(u) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (d <= lengths[i] && lengths[i] > 0)
      return {
        x: lerp(points[i].x, points[i + 1].x, d / lengths[i]),
        y: lerp(points[i].y, points[i + 1].y, d / lengths[i]),
      };
    d -= lengths[i];
  }
  return { ...points.at(-1)! };
}
export function frameIndex(
  mode: string,
  age: number,
  life: number,
  fps: number,
  frames: number,
): number {
  const f = Math.floor(Math.max(0, age) * fps);
  if (mode === "life")
    return Math.min(frames - 1, Math.floor(clamp(age / life) * frames));
  if (mode === "once") return Math.min(frames - 1, f);
  if (mode === "pingpong") {
    const period = Math.max(1, 2 * frames - 2),
      k = f % period;
    return k < frames ? k : period - k;
  }
  return f % frames;
}

import type { Particles, Project, Vec } from "./model.js";
import { colorAt, evaluate, hash, lerp, pointOnPath, random } from "./math.js";
import { emissionPixels } from "./emission.js";
export interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: number;
  alpha: number;
  rotation: number;
  age: number;
  life: number;
}
export function localTime(
  layer: { start: number; duration: number; repeat: boolean },
  time: number,
): number | null {
  const t = time - layer.start;
  if (t < 0 || (!layer.repeat && t >= layer.duration)) return null;
  if (!layer.repeat) return t;
  const wrapped = Math.round((t % layer.duration) * 1e9) / 1e9;
  return wrapped >= layer.duration ? 0 : wrapped;
}
interface Seed {
  birth: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  phase: number;
}
/** Stateless sampling: scrubbing and export do not depend on previous frames. */
export class ParticleSampler {
  private seeds = new Map<string, Seed[]>();
  constructor(readonly project: Project) {
    for (const l of project.layers)
      if (l.type === "particles") this.seeds.set(l.id, this.compile(l));
  }
  private compile(l: Particles): Seed[] {
    const result: Seed[] = [],
      count = l.mode === "stream" ? Math.ceil(l.rate * l.duration) : l.count;
    let emission: ReturnType<typeof emissionPixels> | undefined;
    if (l.mode !== "path" && l.spawn.shape === "image") {
      const a = this.project.assets.find((a) => a.id === l.spawn.asset);
      if (!a) throw Error(`Layer ${l.id}: missing emission image`);
      emission = emissionPixels(a, l.spawn.threshold);
    }
    for (let i = 0; i < count; i++) {
      const rng = random(
        this.project.seed ^ hash(l.id) ^ Math.imul(i + 1, 0x9e3779b9),
      );
      let p: Vec = { x: 0, y: 0 };
      if (l.mode === "path")
        p = pointOnPath(l.points, count === 1 ? 0 : i / (count - 1));
      else if (emission) {
        const pixel =
          emission.pixels[Math.floor(rng() * emission.pixels.length)];
        p = {
          x:
            (((pixel % emission.width) + 0.5) / emission.width - 0.5) *
            l.spawn.width,
          y:
            ((Math.floor(pixel / emission.width) + 0.5) / emission.height -
              0.5) *
            l.spawn.height,
        };
      } else if (l.spawn.shape === "box")
        p = {
          x: (rng() - 0.5) * l.spawn.width,
          y: (rng() - 0.5) * l.spawn.height,
        };
      else if (l.spawn.shape !== "point") {
        const angle = rng() * Math.PI * 2,
          radius =
            l.spawn.radius * (l.spawn.shape === "ring" ? 1 : Math.sqrt(rng()));
        p = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      }
      const angle = ((l.angle + (rng() - 0.5) * l.spread) * Math.PI) / 180,
        speed = lerp(...l.speed, rng());
      result.push({
        ...p,
        birth:
          l.mode === "stream"
            ? i / l.rate
            : l.mode === "path"
              ? (count === 1 ? 0 : i / (count - 1)) * l.travel
              : 0,
        life: lerp(...l.life, rng()),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: lerp(...l.spin, rng()),
        phase: rng() * Math.PI * 2,
      });
    }
    return result;
  }
  sample(l: Particles, time: number): Particle[] {
    const local = localTime(l, time);
    if (local === null) return [];
    const result: Particle[] = [];
    for (const [id, s] of (this.seeds.get(l.id) ?? []).entries()) {
      let age = local - s.birth;
      if (l.repeat && age < 0) age += l.duration;
      if (age < 0 || age >= s.life) continue;
      const u = age / s.life;
      const integrate = (v: number, a: number) =>
        l.drag < 1e-5
          ? v * age + (a * age * age) / 2
          : ((v - a / l.drag) * (1 - Math.exp(-l.drag * age))) / l.drag +
            (a * age) / l.drag;
      const f = l.frequency,
        wobble = l.turbulence / (f * f);
      const dx =
        wobble *
        (Math.sin(f * age + s.phase) -
          Math.sin(s.phase) -
          f * age * Math.cos(s.phase));
      const dy =
        wobble *
        (Math.cos(f * age + s.phase) -
          Math.cos(s.phase) +
          f * age * Math.sin(s.phase));
      result.push({
        id,
        x: s.x + integrate(s.vx, l.gravity.x) + dx,
        y: s.y + integrate(s.vy, l.gravity.y) + dy,
        age,
        life: s.life,
        size: Math.max(0, evaluate(l.size, u)),
        color: colorAt(l.colors, u),
        alpha: Math.max(0, Math.min(1, evaluate(l.opacity, u))),
        rotation: Math.atan2(s.vy, s.vx) + (s.spin * age * Math.PI) / 180,
      });
    }
    return result;
  }
}

import {
  parseProject,
  type Project,
  type Layer,
  type Curve,
  type Vec,
} from "./model.js";
import { evaluate } from "./math.js";
export function cleanupGroups(project: Project): Project {
  return parseProject({
    ...project,
    groups: project.groups
      .map((g) => ({
        ...g,
        ids: g.ids.filter((id) => project.layers.some((l) => l.id === id)),
      }))
      .filter((g) => g.ids.length),
  });
}
export function groupLayers(
  project: Project,
  id: string,
  name: string,
  ids: string[],
): Project {
  if (
    ids.length < 1 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !project.layers.some((l) => l.id === id))
  )
    throw Error("Choose distinct existing layers");
  if (project.groups.some((g) => g.id === id))
    throw Error("Group ID already exists");
  return parseProject({
    ...project,
    groups: [
      ...project.groups
        .map((g) => ({ ...g, ids: g.ids.filter((x) => !ids.includes(x)) }))
        .filter((g) => g.ids.length),
      { id, name, ids },
    ],
  });
}
export function transformLayers(
  project: Project,
  ids: string[],
  options: {
    x?: number;
    y?: number;
    rotation?: number;
    scale?: number;
    pivot?: Vec;
    includeLocked?: boolean;
  },
): Project {
  if (ids.some((id) => !project.layers.some((l) => l.id === id)))
    throw Error("Unknown layer in transform selection");
  const selected = project.layers.filter(
    (l) => ids.includes(l.id) && (!l.locked || options.includeLocked),
  );
  if (!selected.length) return project;
  const pivot = options.pivot ?? {
    x: selected.reduce((n, l) => n + l.position.x, 0) / selected.length,
    y: selected.reduce((n, l) => n + l.position.y, 0) / selected.length,
  };
  const angle = ((options.rotation ?? 0) * Math.PI) / 180,
    scale = options.scale ?? 1,
    cos = Math.cos(angle),
    sin = Math.sin(angle),
    rotate = (p: Vec) => ({
      x: (p.x * cos - p.y * sin) * scale,
      y: (p.x * sin + p.y * cos) * scale,
    });
  if (
    ![scale, angle, pivot.x, pivot.y, options.x ?? 0, options.y ?? 0].every(
      Number.isFinite,
    ) ||
    scale <= 0
  )
    throw Error("Transform needs finite values and positive scale");
  return parseProject({
    ...project,
    layers: project.layers.map((l) => {
      if (!selected.includes(l)) return l;
      const p = rotate({
        x: l.position.x - pivot.x,
        y: l.position.y - pivot.y,
      });
      const times = [
        ...new Set([...l.motion.x, ...l.motion.y].map((k) => k.t)),
      ].sort((a, b) => a - b);
      const motion = times.map((t) => ({
        t,
        ...rotate({ x: evaluate(l.motion.x, t), y: evaluate(l.motion.y, t) }),
      }));
      // Rotating two differently eased curves cannot be represented exactly by one
      // easing per scalar channel; reject instead of silently changing its motion.
      const aligned =
        l.motion.x.length === l.motion.y.length &&
        l.motion.x.every(
          (k, i) => k.t === l.motion.y[i].t && k.ease === l.motion.y[i].ease,
        );
      if (
        options.rotation &&
        !aligned &&
        [...l.motion.x, ...l.motion.y].some((k) => k.ease !== "linear")
      )
        throw Error(
          "Align X/Y motion key times and easing before rotating this selection",
        );
      return {
        ...l,
        position: {
          x: pivot.x + p.x + (options.x ?? 0),
          y: pivot.y + p.y + (options.y ?? 0),
        },
        rotation: l.rotation + (options.rotation ?? 0),
        scale: l.scale * scale,
        glow: { ...l.glow, blur: l.glow.blur * scale },
        motion: {
          ...l.motion,
          x: !options.rotation
            ? l.motion.x.map((k) => ({ ...k, value: k.value * scale }))
            : motion.map((m, i) => ({
                t: m.t,
                value: m.x,
                ease: aligned ? l.motion.x[i].ease : ("linear" as const),
              })),
          y: !options.rotation
            ? l.motion.y.map((k) => ({ ...k, value: k.value * scale }))
            : motion.map((m, i) => ({
                t: m.t,
                value: m.y,
                ease: aligned ? l.motion.y[i].ease : ("linear" as const),
              })),
        },
      };
    }),
  });
}
export function curveChannels(layer: Layer): string[] {
  return [
    "opacity",
    "motion.x",
    "motion.y",
    "motion.rotation",
    "motion.scale",
    ...["size", "width", "height", "radius", "draw"].filter((k) => k in layer),
  ];
}
export function getCurve(layer: Layer, channel: string): Curve {
  if (!curveChannels(layer).includes(channel))
    throw Error("Unknown curve channel");
  return channel.startsWith("motion.")
    ? layer.motion[channel.slice(7) as keyof Layer["motion"]]
    : (layer as unknown as Record<string, Curve>)[channel];
}
export function curvePatch(
  channel: string,
  keys: Curve,
): Record<string, unknown> {
  return channel.startsWith("motion.")
    ? { motion: { [channel.slice(7)]: keys } }
    : { [channel]: keys };
}
export function putKeyframe(
  project: Project,
  id: string,
  channel: string,
  time: number,
  value: number,
  ease: "linear" | "smooth" | "hold" = "linear",
): Project {
  const layer = project.layers.find((l) => l.id === id);
  if (!layer) throw Error("Unknown layer");
  if (layer.locked) throw Error("Unlock the layer before editing");
  const keys = getCurve(layer, channel).filter(
    (k) => Math.abs(k.t - time) > 1e-6,
  );
  keys.push({ t: time, value, ease });
  keys.sort((a, b) => a.t - b.t);
  const next = channel.startsWith("motion.")
    ? { ...layer, motion: { ...layer.motion, [channel.slice(7)]: keys } }
    : { ...layer, [channel]: keys };
  return parseProject({
    ...project,
    layers: project.layers.map((l) => (l.id === id ? next : l)),
  });
}
export function patchLayers(
  project: Project,
  ids: string[],
  patch: Record<string, unknown>,
  includeLocked = false,
): Project {
  if (ids.some((id) => !project.layers.some((l) => l.id === id)))
    throw Error("Unknown layer in selection");
  return parseProject({
    ...project,
    layers: project.layers.map((l) => {
      if (!ids.includes(l.id) || (l.locked && !includeLocked)) return l;
      const next = {
        ...l,
        ...patch,
        ...(patch.motion
          ? { motion: { ...l.motion, ...(patch.motion as object) } }
          : {}),
      } as Layer;
      if (
        l.type === "path" &&
        next.type === "path" &&
        l.handles &&
        Array.isArray(patch.points) &&
        !("handles" in patch)
      ) {
        const points = next.points;
        next.handles = points.map((p, i) => {
          const prior =
            points.length === l.points.length
              ? i
              : l.points.findIndex((q) => q.x === p.x && q.y === p.y);
          return (
            l.handles![prior] ?? { in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }
          );
        });
      }
      return next;
    }),
  });
}

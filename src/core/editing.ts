import {
  parseProject,
  type Project,
  type Layer,
  type Curve,
  type Vec,
} from "./model.js";
import { evaluate } from "./math.js";
import { parameterTargets } from "./parameters.js";
export function cleanupGroups(project: Project): Project {
  return parseProject({
    ...project,
    ...(project.stage
      ? {
          stage: {
            ...project.stage,
            layers: Object.fromEntries(
              Object.entries(project.stage.layers).filter(([id]) =>
                project.layers.some((l) => l.id === id),
              ),
            ),
          },
        }
      : {}),
    controls: project.controls.map((c) => ({
      ...c,
      bindings: c.bindings.filter((b) => {
        const layer = project.layers.find((l) => l.id === b.layer);
        return (
          layer && parameterTargets(layer).some((t) => t.path === b.target)
        );
      }),
    })),
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
    ...["size", "width", "height", "radius", "draw", "cutoff"].filter(
      (k) => k in layer,
    ),
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

/** Stretch time and compensate particle dynamics so a slower effect follows the same paths. */
export function retimeProject(project: Project, duration: number): Project {
  const factor = duration / project.duration;
  return parseProject({
    ...project,
    duration,
    editor: {
      ...project.editor,
      ...(project.editor.range
        ? {
            range: {
              start: project.editor.range.start * factor,
              end: project.editor.range.end * factor,
            },
          }
        : {}),
    },
    layers: project.layers.map((l) => ({
      ...l,
      start: l.start * factor,
      duration: l.duration * factor,
      modifiers: l.modifiers.map((m) =>
        "speed" in m ? { ...m, speed: m.speed / factor } : m,
      ),
      ...(l.type === "field" ? { speed: l.speed / factor } : {}),
      ...(l.type === "sprite" ? { frameFps: l.frameFps / factor } : {}),
      ...(l.type === "particles"
        ? {
            trail: { ...l.trail, seconds: l.trail.seconds * factor },
            rate: l.rate / factor,
            life: l.life.map((n) => n * factor),
            travel: l.travel * factor,
            speed: l.speed.map((n) => n / factor),
            spin: l.spin.map((n) => n / factor),
            gravity: {
              x: l.gravity.x / factor ** 2,
              y: l.gravity.y / factor ** 2,
            },
            drag: l.drag / factor,
            turbulence: l.turbulence / factor ** 2,
            frequency: l.frequency / factor,
            frameFps: l.frameFps / factor,
          }
        : {}),
    })),
  });
}
export function staggerLayers(
  project: Project,
  ids: string[],
  seconds: number,
): Project {
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !project.layers.some((l) => l.id === id))
  )
    throw Error("Choose distinct existing layers");
  const selected = ids.filter(
    (id) => !project.layers.find((l) => l.id === id)!.locked,
  );
  return parseProject({
    ...project,
    layers: project.layers.map((l) =>
      selected.includes(l.id)
        ? { ...l, start: l.start + selected.indexOf(l.id) * seconds }
        : l,
    ),
  });
}

export interface KeyRef {
  layer: string;
  channel: string;
  time: number;
}
export function shiftKeys(
  project: Project,
  refs: KeyRef[],
  seconds: number,
  duplicate = false,
): Project {
  const next = structuredClone(project);
  const byChannel = new Map<string, KeyRef[]>();
  for (const ref of refs) {
    const key = `${ref.layer}/${ref.channel}`;
    byChannel.set(key, [...(byChannel.get(key) ?? []), ref]);
  }
  for (const group of byChannel.values()) {
    const l = next.layers.find((l) => l.id === group[0].layer);
    if (!l || l.locked)
      throw Error("Unlock selected layers before moving keys");
    const keys = getCurve(l, group[0].channel),
      chosen = keys.filter((k) =>
        group.some((r) => Math.abs(r.time - k.t) < 1e-7),
      );
    if (chosen.length !== group.length)
      throw Error("Selected keys changed; select them again");
    const moved = chosen.map((k) => ({
      ...k,
      t: Math.round((k.t + seconds / l.duration) * 1e7) / 1e7,
    }));
    const result = [
      ...(duplicate ? keys : keys.filter((k) => !chosen.includes(k))),
      ...moved,
    ].sort((a, b) => a.t - b.t);
    const patch = curvePatch(group[0].channel, result);
    if (patch.motion)
      l.motion = { ...l.motion, ...(patch.motion as Layer["motion"]) };
    else Object.assign(l, patch);
  }
  return parseProject(next);
}
export function deleteKeys(project: Project, refs: KeyRef[]): Project {
  const next = structuredClone(project);
  for (const l of next.layers)
    for (const channel of curveChannels(l)) {
      const chosen = refs.filter(
        (r) => r.layer === l.id && r.channel === channel,
      );
      if (!chosen.length) continue;
      if (l.locked) throw Error("Unlock selected layers before deleting keys");
      const keys = getCurve(l, channel).filter(
        (k) => !chosen.some((r) => Math.abs(r.time - k.t) < 1e-7),
      );
      if (!keys.length) throw Error("Keep at least one key per channel");
      const patch = curvePatch(channel, keys);
      if (patch.motion)
        l.motion = { ...l.motion, ...(patch.motion as Layer["motion"]) };
      else Object.assign(l, patch);
    }
  return parseProject(next);
}
export function autoKeyTransform(
  project: Project,
  id: string,
  patch: Record<string, unknown>,
  time: number,
): Project | null {
  const l = project.layers.find((l) => l.id === id);
  if (!l) throw Error("Unknown layer");
  const entries: [string, number][] = [];
  if (patch.position) {
    const p = patch.position as Vec;
    entries.push(
      ["motion.x", p.x - l.position.x],
      ["motion.y", p.y - l.position.y],
    );
  }
  if (typeof patch.rotation === "number")
    entries.push(["motion.rotation", patch.rotation - l.rotation]);
  if (typeof patch.scale === "number")
    entries.push(["motion.scale", patch.scale / l.scale]);
  if (!entries.length) return null;
  let local = time - l.start;
  if (l.repeat && local >= 0) local %= l.duration;
  if (local < 0 || local > l.duration)
    throw Error("Move the playhead inside this layer before using Auto key");
  let result = project;
  for (const [channel, value] of entries)
    result = putKeyframe(
      result,
      id,
      channel,
      Math.round((local / l.duration) * 1e7) / 1e7,
      value,
    );
  return result;
}

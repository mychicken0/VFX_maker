import { z } from "zod";
import {
  VERSION,
  parseProject,
  parseText,
  type Project,
  type Vec,
} from "./model.js";
import type { Control } from "./creative-schema.js";

/** Preserve a position binding when translating the component's coordinate origin. */
function translateControl(control: Control, delta: Vec): Control {
  return {
    ...control,
    bindings: control.bindings.flatMap((b) => {
      if (b.target !== "position.x" && b.target !== "position.y") return [b];
      const offset = b.target === "position.x" ? delta.x : delta.y;
      if (b.mode === "set") return [{ ...b, offset: b.offset + offset }];
      if (b.mode === "multiply")
        return [
          b,
          {
            ...b,
            mode: "add" as const,
            factor: -offset * b.factor,
            offset: offset * (1 - b.offset),
          },
        ];
      return [b];
    }),
  };
}

export interface Component {
  format: "vfx-component";
  version: typeof VERSION;
  name: string;
  project: Project;
}
export function parseComponent(value: unknown): Component {
  const wrapper = z
    .object({
      format: z.literal("vfx-component"),
      version: z.literal(VERSION),
      name: z.string().min(1).max(100),
      project: z.unknown(),
    })
    .strict()
    .parse(value);
  const project =
    typeof wrapper.project === "string"
      ? parseText(wrapper.project)
      : parseProject(wrapper.project);
  if (new TextEncoder().encode(JSON.stringify(project)).length > 4194304)
    throw Error("Component exceeds 4 MiB");
  if (project.editor.reference)
    throw Error("A component cannot include a preview reference");
  return { ...wrapper, project };
}
export function makeComponent(
  p: Project,
  ids: string[],
  name: string,
): Component {
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !p.layers.some((l) => l.id === id))
  )
    throw Error("Choose existing layers to save as a component");
  const layers = p.layers.filter((l) => ids.includes(l.id));
  const origin = {
    x: layers.reduce((n, l) => n + l.position.x, 0) / layers.length,
    y: layers.reduce((n, l) => n + l.position.y, 0) / layers.length,
  };
  const controls = p.controls
    .map((c) => ({
      ...c,
      bindings: c.bindings.filter((b) => ids.includes(b.layer)),
    }))
    .filter((c) => c.bindings.length)
    .map((c) => translateControl(c, { x: -origin.x, y: -origin.y }));
  return parseComponent({
    format: "vfx-component",
    version: VERSION,
    name,
    project: {
      ...p,
      name,
      editor: {},
      variants: [],
      controls,
      layers: layers.map((l) => ({
        ...l,
        position: { x: l.position.x - origin.x, y: l.position.y - origin.y },
      })),
      assets: p.assets.filter((a) =>
        layers.some(
          (l) =>
            ("asset" in l && l.asset === a.id) ||
            (l.type === "particles" && l.spawn.asset === a.id),
        ),
      ),
      groups: p.groups
        .map((g) => ({ ...g, ids: g.ids.filter((id) => ids.includes(id)) }))
        .filter((g) => g.ids.length),
    },
  });
}
function allocate(base: string, occupied: Set<string>): string {
  let id = base,
    i = 2;
  while (occupied.has(id)) id = `${base.slice(0, 56)}-${i++}`;
  occupied.add(id);
  return id;
}
/** Copies editable data and remaps every ID/reference, even on repeated insertion. */
export function insertComponent(
  p: Project,
  value: unknown,
  position: Vec = { x: p.canvas.width / 2, y: p.canvas.height / 2 },
): { project: Project; ids: string[] } {
  const c = structuredClone(parseComponent(value)),
    source = c.project;
  const occupied = new Set(
    [...p.layers, ...p.assets, ...p.groups, ...p.controls].map((x) => x.id),
  );
  const mapping = new Map(
    source.layers.map((l) => [l.id, allocate(l.id, occupied)]),
  );
  const assets = new Map<string, string>(),
    extraAssets: Project["assets"] = [];
  for (const a of source.assets) {
    const same = p.assets.find(
      (existing) =>
        existing.data === a.data &&
        existing.columns === a.columns &&
        existing.rows === a.rows &&
        existing.frames === a.frames,
    );
    if (same) assets.set(a.id, same.id);
    else {
      const id = allocate(a.id, occupied);
      assets.set(a.id, id);
      extraAssets.push({ ...a, id });
    }
  }
  const layers = source.layers.map((l) => ({
    ...l,
    id: mapping.get(l.id)!,
    locked: false,
    position: { x: l.position.x + position.x, y: l.position.y + position.y },
    ...("asset" in l && l.asset
      ? { asset: assets.get(l.asset) ?? l.asset }
      : {}),
    ...(l.type === "particles" && l.spawn.asset
      ? {
          spawn: {
            ...l.spawn,
            asset: assets.get(l.spawn.asset) ?? l.spawn.asset,
          },
        }
      : {}),
  }));
  const ids = layers.map((l) => l.id);
  const controls = source.controls.map((control) =>
    translateControl(
      {
        ...control,
        id: allocate(control.id, occupied),
        bindings: control.bindings.map((b) => ({
          ...b,
          layer: mapping.get(b.layer)!,
        })),
      },
      position,
    ),
  );
  const groups = source.groups.map((g) => ({
    ...g,
    id: allocate(g.id, occupied),
    ids: g.ids.map((id) => mapping.get(id)!),
  }));
  const ungrouped = ids.filter((id) => !groups.some((g) => g.ids.includes(id)));
  if (ungrouped.length)
    groups.push({
      id: allocate("component", occupied),
      name: c.name,
      ids: ungrouped,
    });
  return {
    ids,
    project: parseProject({
      ...p,
      duration: Math.max(p.duration, source.duration),
      layers: [...p.layers, ...layers],
      assets: [...p.assets, ...extraAssets],
      controls: [...p.controls, ...controls],
      groups: [...p.groups, ...groups],
    }),
  };
}

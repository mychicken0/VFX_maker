import { describe, expect, it } from "vitest";
import {
  defineEffect,
  path,
  particles,
  field,
  curve,
  getPreset,
  parseProject,
  parseComponent,
  resolveControls,
  setControl,
  editCreative,
  makeComponent,
  insertComponent,
  captureVariant,
  applyVariant,
  parameterTargets,
  variantPlan,
  retimeProject,
  staggerLayers,
  shiftKeys,
  deleteKeys,
  autoKeyTransform,
  exportPlan,
  ParticleSampler,
  encodePng,
  type Project,
} from "../src/core/index.js";

const base = () =>
  defineEffect({
    duration: 1,
    fps: 20,
    layers: [
      path({
        id: "slash",
        name: "Slash",
        points: [
          { x: -10, y: 0 },
          { x: 10, y: 0 },
        ],
        width: curve(4, 0),
        duration: 1,
        glow: { strength: 1, blur: 2 },
      }),
      particles({
        id: "sparks",
        name: "Sparks",
        duration: 1,
        count: 8,
        life: [0.1, 0.4],
      }),
    ],
  });
function controlled(): Project {
  return editCreative(base(), {
    action: "put_control",
    control: {
      id: "energy",
      name: "Energy",
      min: 0,
      max: 3,
      value: 1,
      bindings: [
        { layer: "slash", target: "width", mode: "multiply" },
        { layer: "sparks", target: "count", mode: "multiply" },
      ],
    },
  });
}
describe("portable creative authoring", () => {
  it("resolves controls from the original fields without drift or mutation", () => {
    const p = controlled(),
      twice = setControl(p, "energy", 2);
    expect(resolveControls(twice).layers[0]).toMatchObject({
      width: curve(8, 0),
    });
    expect(resolveControls(twice).layers[1]).toMatchObject({ count: 16 });
    expect(resolveControls(setControl(twice, "energy", 1)).layers).toEqual(
      p.layers,
    );
    expect(p.layers[0]).toMatchObject({ width: curve(4, 0) });
    expect(() => setControl(p, "energy", 4)).toThrow();
  });
  it("keeps evaluation order when editing a control definition", () => {
    let p = editCreative(base(), {
      action: "put_control",
      control: {
        id: "set-size",
        name: "Set size",
        value: 2,
        max: 4,
        bindings: [{ layer: "slash", target: "scale", mode: "set" }],
      },
    });
    p = editCreative(p, {
      action: "put_control",
      control: {
        id: "scale-size",
        name: "Scale size",
        value: 3,
        max: 4,
        bindings: [{ layer: "slash", target: "scale", mode: "multiply" }],
      },
    });
    expect(resolveControls(p).layers[0].scale).toBe(6);
    const renamed = editCreative(p, {
      action: "put_control",
      control: { ...p.controls[0], name: "Renamed" },
    });
    expect(renamed.controls.map((c) => c.id)).toEqual(
      p.controls.map((c) => c.id),
    );
    expect(resolveControls(renamed).layers[0].scale).toBe(6);
  });
  it("rejects unsafe/dangling targets and results outside layer budgets", () => {
    const p = controlled();
    for (const target of [
      "__proto__.polluted",
      "missing",
      "modifiers.unknown.strength",
    ])
      expect(() =>
        editCreative(p, {
          action: "put_control",
          control: { ...p.controls[0], bindings: [{ layer: "slash", target }] },
        }),
      ).toThrow();
    expect(() =>
      editCreative(p, {
        action: "put_control",
        control: {
          ...p.controls[0],
          bindings: [{ layer: "missing", target: "scale" }],
        },
      }),
    ).toThrow();
    expect(() =>
      editCreative(p, {
        action: "put_control",
        control: {
          ...p.controls[0],
          bindings: [
            { layer: "sparks", target: "count", mode: "set", factor: 5000 },
          ],
        },
      }),
    ).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("preserves modifier ordering, prunes removed targets and respects locks", () => {
    let p = editCreative(base(), {
      action: "put_modifier",
      layer: "slash",
      modifier: { id: "edge", type: "outline" },
    });
    p = editCreative(p, {
      action: "put_modifier",
      layer: "slash",
      modifier: { id: "warp", type: "noise-warp" },
      index: 0,
    });
    expect(p.layers[0].modifiers.map((m) => m.id)).toEqual(["warp", "edge"]);
    p = editCreative(p, {
      action: "put_control",
      control: {
        id: "edge-size",
        name: "Edge",
        bindings: [{ layer: "slash", target: "modifiers.edge.thickness" }],
      },
    });
    p = editCreative(p, {
      action: "remove_modifier",
      layer: "slash",
      id: "edge",
    });
    expect(p.controls[0].bindings).toEqual([]);
    p.layers[0].locked = true;
    expect(() =>
      editCreative(p, {
        action: "remove_modifier",
        layer: "slash",
        id: "warp",
      }),
    ).toThrow("unlocked");
  });
  it("inserts components repeatedly with remapped assets, groups and bindings", () => {
    const source = getPreset("flipbook_burst");
    const name = source.assets.length ? source : getPreset("red_magic_cross");
    const component = makeComponent(
      name,
      name.layers.map((l) => l.id),
      "Reusable effect",
    );
    const previous = {
      ...component,
      version: "0.7.0",
      project: { ...component.project, version: "0.7.0" },
    };
    expect(parseComponent(previous)).toEqual(component);
    expect(
      parseComponent({
        ...component,
        version: "0.7.1",
        project: { ...component.project, version: "0.7.1" },
      }),
    ).toEqual(component);
    expect(
      parseComponent({
        ...previous,
        project: JSON.stringify(previous.project),
      }),
    ).toEqual(component);
    expect(() => parseComponent({ ...component, version: "0.8.0" })).toThrow();
    const empty = defineEffect({ duration: 1.2 });
    const first = insertComponent(empty, component),
      second = insertComponent(first.project, component, { x: 30, y: 40 });
    expect(new Set(second.project.layers.map((l) => l.id)).size).toBe(
      second.project.layers.length,
    );
    expect(second.ids.some((id) => first.ids.includes(id))).toBe(false);
    expect(second.project.assets.length).toBe(component.project.assets.length);
    expect(
      second.project.controls.every((c) =>
        c.bindings.every((b) =>
          second.project.layers.some((l) => l.id === b.layer),
        ),
      ),
    ).toBe(true);
    expect(second.project.editor.reference).toBeUndefined();
    expect(() => resolveControls(second.project)).not.toThrow();
  });
  it("does not bundle preview references or unselected layers in a component", () => {
    const p = controlled(),
      component = makeComponent(p, ["slash"], "Slash only");
    expect(component.project.layers).toHaveLength(1);
    expect(component.project.controls[0].bindings).toHaveLength(1);
    expect(component.project.layers[0].position).toEqual({ x: 0, y: 0 });
    expect(component.project.variants).toEqual([]);
  });
  it("preserves absolute and multiplied position controls across component origins", () => {
    for (const mode of ["set", "multiply", "add"] as const) {
      const p = editCreative(base(), {
        action: "put_control",
        control: {
          id: "move",
          name: "Move",
          value: 2,
          max: 4,
          bindings: [
            {
              layer: "slash",
              target: "position.x",
              mode,
              factor: 1.5,
              offset: 4,
            },
          ],
        },
      });
      const expected = resolveControls(p).layers[0].position.x;
      const c = makeComponent(p, ["slash"], "Slash");
      const next = insertComponent(defineEffect({}), c, { x: 100, y: 80 });
      expect(resolveControls(next.project).layers[0].position.x).toBeCloseTo(
        expected - 64 + 100,
      );
    }
  });
  it("captures variant values independently and applies them atomically", () => {
    let p = captureVariant(controlled(), "light", "Light");
    p = captureVariant(setControl(p, "energy", 2), "heavy", "Heavy");
    expect(applyVariant(p, "light").controls[0].value).toBe(1);
    expect(applyVariant(p, "heavy").controls[0].value).toBe(2);
    expect(applyVariant(p, "light").layers).toEqual(p.layers);
    expect(() => variantPlan(p, ["light", "light"], {})).toThrow("distinct");
    expect(() => variantPlan(p, ["missing"], {})).toThrow("Unknown variant");
    expect(
      editCreative(p, {
        action: "remove_control",
        id: "energy",
      }).variants.every((v) => !Object.keys(v.values).length),
    ).toBe(true);
  });
  it("stretches dynamics and staggers selections while preserving locked layers", () => {
    const p = base(),
      next = retimeProject(p, 2),
      l = next.layers[1];
    expect(next.duration).toBe(2);
    if (l.type !== "particles") throw Error();
    expect(l.life).toEqual([0.2, 0.8]);
    expect(l.speed).toEqual([15, 45]);
    expect(l.gravity.y).toBe(11.25);
    p.layers[1].locked = true;
    expect(staggerLayers(p, ["slash", "sparks"], 0.1).layers).toEqual(p.layers);
  });
  it("moves keys across channels atomically, preserving bounds and last keys", () => {
    const p = base(),
      refs = [{ layer: "slash", channel: "width", time: 0 }];
    const moved = shiftKeys(p, refs, 0.1);
    expect(moved.layers[0]).toMatchObject({
      width: [
        { t: 0.1, value: 4 },
        { t: 1, value: 0 },
      ],
    });
    expect(() => shiftKeys(p, refs, -0.1)).toThrow();
    expect(() => shiftKeys(p, refs, 1)).toThrow();
    expect(() => deleteKeys(p, [...refs, { ...refs[0], time: 1 }])).toThrow(
      "at least one",
    );
    const keyed = autoKeyTransform(
      p,
      "slash",
      { position: { x: 74, y: 64 } },
      0.5,
    )!;
    expect(keyed.layers[0].motion.x).toContainEqual({
      t: 0.5,
      value: 10,
      ease: "linear",
    });
    expect(keyed.layers[0].position).toEqual(p.layers[0].position);
    expect(() => autoKeyTransform(p, "slash", { scale: 2 }, 2)).toThrow(
      "playhead",
    );
  });
  it("migrates previous projects and validates field/keyframe limits", () => {
    const p = base();
    expect(parseProject({ ...p, version: "0.7.0" })).toEqual(p);
    expect(
      parseProject({
        ...p,
        version: "0.6.0",
        controls: undefined,
        variants: undefined,
      }).version,
    ).toBe("0.7.5");
    const l = field({ id: "cloud", name: "Cloud" });
    expect(parameterTargets(l).some((t) => t.path === "cutoff")).toBe(true);
    expect(() =>
      defineEffect({ layers: [{ ...l, cutoff: curve(2) }] }),
    ).toThrow();
    expect(exportPlan(p, { start: 0.2, end: 0.51, fps: 10 })).toMatchObject({
      count: 4,
      duration: 0.31,
      start: 0.2,
    });
    expect(() => exportPlan(p, { start: 0.8, end: 0.2 })).toThrow("range");
  });
  it("emits from visible image pixels and remaps the emission asset in components", () => {
    const rgba = new Uint8ClampedArray(64);
    rgba.set([255, 255, 255, 255], (2 * 4 + 3) * 4);
    const data =
      "data:image/png;base64," +
      Buffer.from(encodePng({ width: 4, height: 4, rgba })).toString("base64");
    const p = defineEffect({
      duration: 1,
      assets: [{ id: "mask", name: "Mask", data, width: 4, height: 4 }],
      layers: [
        particles({
          id: "image",
          name: "Image emitter",
          count: 10,
          spawn: { shape: "image", asset: "mask", width: 40, height: 40 },
          speed: [0, 0],
          gravity: { x: 0, y: 0 },
          life: [0.5, 0.5],
        }),
      ],
    });
    const sampler = new ParticleSampler(p),
      layer = p.layers[0];
    if (layer.type !== "particles") throw Error();
    expect(sampler.sample(layer, 0.1)).toHaveLength(10);
    for (const particle of sampler.sample(layer, 0.1))
      expect(particle).toMatchObject({ x: 15, y: 5 });
    const component = makeComponent(p, ["image"], "Emission");
    expect(component.project.assets).toHaveLength(1);
    const result = insertComponent(p, component).project;
    expect(result.layers[1]).toMatchObject({ spawn: { asset: "mask" } });
    expect(
      new ParticleSampler(result).sample(result.layers[1] as typeof layer, 0.1),
    ).toHaveLength(10);
    rgba.fill(0);
    const empty = {
      ...p,
      assets: [
        {
          ...p.assets[0],
          data:
            "data:image/png;base64," +
            Buffer.from(encodePng({ width: 4, height: 4, rgba })).toString(
              "base64",
            ),
        },
      ],
    };
    expect(() => new ParticleSampler(empty)).toThrow("alpha threshold");
  });
});

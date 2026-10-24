import { describe, it, expect } from "vitest";
import {
  getPreset,
  addCatalogNode,
  nodeCatalog,
  duplicateEditorLayer,
  resolveControls,
  applyEdits,
  parseProject,
  resizeProject,
  makeComponent,
  parseComponent,
  insertComponent,
  stageDefaults,
} from "../src/core/index.js";
describe("shared usable Add catalog", () => {
  it("creates actual editable layer generators, modifier and control from the same catalog", () => {
    let p = getPreset("flipbook_burst");
    const source = structuredClone(p);
    for (const type of ["particles", "path", "ring", "sprite", "field"]) {
      const result = addCatalogNode(p, `layer:${type}`, `added-${type}`);
      p = result.project;
      expect(p.layers.at(-1)?.type).toBe(type);
      if (type === "sprite") {
        const added = p.layers.at(-1)!;
        if (added.type !== "sprite") throw Error("Expected a sprite");
        const asset = p.assets.find((a) => a.id === added.asset)!;
        expect(added.width[0].value / added.height[0].value).toBeCloseTo(
          asset.width / asset.columns / (asset.height / asset.rows),
          8,
        );
      }
      expect(
        applyEdits(source, [
          { action: "add_layer", layer: p.layers.at(-1)! },
        ]).layers.at(-1),
      ).toEqual(p.layers.at(-1));
    }
    p = addCatalogNode(p, "modifier:outline", "edge", "added-ring").project;
    expect(p.layers.find((l) => l.id === "added-ring")?.modifiers[0].type).toBe(
      "outline",
    );
    p = addCatalogNode(p, "control:number", "number").project;
    expect(p.controls.at(-1)?.bindings).toEqual([]);
    expect(source).toEqual(getPreset("flipbook_burst"));
    for (const side of [16, 512])
      for (const duration of [0.1, 10]) {
        const empty = parseProject({
          name: "Boundary canvas",
          canvas: { width: side, height: side },
          duration,
          fps: 6,
          layers: [],
        });
        expect(() =>
          addCatalogNode(empty, "layer:particles", "particle"),
        ).not.toThrow();
        expect(() =>
          addCatalogNode(empty, "layer:path", "stroke"),
        ).not.toThrow();
        expect(() => addCatalogNode(empty, "layer:ring", "ring")).not.toThrow();
      }
  });
  it("reports unavailable node reasons and rejects a locked modifier without a partial edit", () => {
    const p = getPreset();
    p.assets = [];
    p.layers[0].locked = true;
    expect(
      nodeCatalog(p, p.layers[0].id).find((e) => e.id === "layer:sprite")
        ?.disabled,
    ).toContain("PNG");
    expect(() =>
      addCatalogNode(p, "modifier:outline", "edge", p.layers[0].id),
    ).toThrow("Unlock");
    expect(p.layers[0].modifiers).toEqual([]);
    p.controls = Array.from({ length: 16 }, (_, i) => ({
      ...structuredClone(getPreset().controls[0]),
      id: `control-${i}`,
      bindings: [],
    }));
    expect(
      nodeCatalog(p).find((e) => e.id === "control:number")?.disabled,
    ).toContain("16 controls");
  });
  it("duplicates a driven layer with its bindings and scene placement, preserving appearance and old project compatibility", () => {
    let p = getPreset();
    p.controls[0].value = 1.5;
    p = applyEdits(p, [
      {
        action: "place_stage_layer",
        id: p.layers[0].id,
        patch: { position: { z: 24 }, stretch: { x: 2, y: 0.5, z: 1 } },
      },
    ]);
    const copy = duplicateEditorLayer(p, p.layers[0].id, "copied");
    expect(resolveControls(copy).layers.at(-1)).toMatchObject({
      ...resolveControls(p).layers[0],
      id: "copied",
      name: copy.layers.at(-1)!.name,
    });
    expect(copy.stage?.layers.copied).toEqual(p.stage?.layers[p.layers[0].id]);
    expect(parseProject({ ...getPreset(), version: "0.7.4" }).version).toBe(
      "0.7.6",
    );
  });
  it("resizes controlled positions/motion/scale in resolved space, including letterboxing and future control values", () => {
    for (const mode of ["set", "add", "multiply"] as const) {
      let source = parseProject({
        name: "Driven resize",
        canvas: { width: 128, height: 128 },
        layers: [
          {
            id: "shape",
            name: "Shape",
            type: "ring",
            position: { x: 20, y: 25 },
            scale: 1.5,
            motion: { x: [{ t: 0, value: 8 }] },
          },
        ],
        controls: [
          {
            id: "move",
            name: "Move",
            min: 0.5,
            max: 2,
            value: 1,
            bindings: [
              {
                layer: "shape",
                target: "position.x",
                mode,
                factor: 5,
                offset: 2,
              },
              {
                layer: "shape",
                target: "position.y",
                mode,
                factor: 4,
                offset: 3,
              },
              {
                layer: "shape",
                target: "motion.x",
                mode,
                factor: 2,
                offset: 1,
              },
              {
                layer: "shape",
                target: "scale",
                mode,
                factor: 0.5,
                offset: 0.25,
              },
            ],
          },
        ],
      });
      const original = structuredClone(source),
        resized = resizeProject(source, 256, 128);
      for (const value of [0.5, 1, 2]) {
        source = parseProject({
          ...source,
          controls: source.controls.map((c) => ({ ...c, value })),
        });
        const before = resolveControls(source).layers[0],
          after = resolveControls({
            ...resized,
            controls: resized.controls.map((c) => ({ ...c, value })),
          }).layers[0];
        expect(after.position.x).toBeCloseTo(before.position.x + 64);
        expect(after.position.y).toBeCloseTo(before.position.y);
        expect(after.scale).toBeCloseTo(before.scale);
        expect(after.motion.x[0].value).toBeCloseTo(before.motion.x[0].value);
        const half = resolveControls(resizeProject(source, 64, 64)).layers[0];
        expect(half.position.x).toBeCloseTo(before.position.x / 2);
        expect(half.position.y).toBeCloseTo(before.position.y / 2);
        expect(half.scale).toBeCloseTo(before.scale / 2);
        expect(half.motion.x[0].value).toBeCloseTo(
          before.motion.x[0].value / 2,
        );
      }
      expect(original.canvas.width).toBe(128);
      expect(resizeProject(original, 256, 128, "canvas").controls).toEqual(
        original.controls,
      );
    }
  });
  it("resizes a staged composition and camera in the same world units", () => {
    const p = applyEdits(getPreset(), [
      {
        action: "configure_stage",
        patch: { projection: "perspective", target: { x: 8, y: 12, z: 4 } },
      },
      {
        action: "place_stage_layer",
        id: "cut-a",
        patch: {
          position: { x: 20, y: 30, z: 40 },
          stretch: { x: 2, y: 0.5, z: 1 },
        },
      },
    ]);
    const next = resizeProject(p, 256, 256),
      before = p.stage!,
      after = next.stage!;
    expect(after.span).toBe(before.span * 2);
    expect(after.distance).toBe(before.distance * 2);
    expect(after.target).toEqual({ x: 16, y: 24, z: 8 });
    expect(after.layers["cut-a"].position).toEqual({ x: 40, y: 60, z: 80 });
    expect(after.layers["cut-a"].stretch).toEqual(
      before.layers["cut-a"].stretch,
    );
    expect(resizeProject(p, 256, 256, "canvas").stage).toEqual(p.stage);
  });
  it("reuses Stage placements with fresh IDs/names without replacing the receiving camera", () => {
    const p = applyEdits(getPreset(), [
      {
        action: "configure_stage",
        patch: { plane: "upright", projection: "perspective" },
      },
      {
        action: "place_stage_layer",
        id: "cut-a",
        patch: {
          position: { x: 12, y: 20, z: 30 },
          stretch: { x: 2, y: 0.5, z: 1 },
        },
      },
      {
        action: "place_stage_layer",
        id: "sparks",
        patch: { plane: "billboard" },
      },
    ]);
    const source = structuredClone(p),
      c = makeComponent(p, ["cut-a", "cut-b"], "Sword");
    expect(c.project.stage?.layers.sparks).toBeUndefined();
    const inserted = insertComponent(p, c),
      ids = inserted.ids;
    expect(inserted.project.stage?.layers[ids[0]]).toEqual(
      p.stage?.layers["cut-a"],
    );
    expect(inserted.project.stage?.layers[ids[1]].plane).toBe("upright");
    expect(inserted.project.stage?.azimuth).toBe(p.stage?.azimuth);
    expect(new Set(inserted.project.layers.map((l) => l.name)).size).toBe(
      inserted.project.layers.length,
    );
    expect(new Set(inserted.project.controls.map((c) => c.name)).size).toBe(
      inserted.project.controls.length,
    );
    const again = insertComponent(inserted.project, c);
    expect(again.project.stage?.layers[again.ids[0]]).toEqual(
      p.stage?.layers["cut-a"],
    );
    const blank = insertComponent(
      parseProject({ name: "Blank", layers: [] }),
      c,
    );
    expect(blank.project.stage?.azimuth).toBe(stageDefaults().azimuth);
    expect(blank.project.stage?.layers[blank.ids[1]].plane).toBe("upright");
    expect(parseProject({ ...getPreset(), version: "0.7.5" }).version).toBe(
      "0.7.6",
    );
    expect(
      parseComponent({
        ...c,
        version: "0.7.5",
        project: { ...c.project, version: "0.7.5" },
      }).version,
    ).toBe("0.7.6");
    expect(p).toEqual(source);
  });
});

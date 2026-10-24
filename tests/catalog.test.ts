import { describe, it, expect } from "vitest";
import {
  getPreset,
  addCatalogNode,
  nodeCatalog,
  duplicateEditorLayer,
  resolveControls,
  applyEdits,
  parseProject,
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
      "0.7.5",
    );
  });
});

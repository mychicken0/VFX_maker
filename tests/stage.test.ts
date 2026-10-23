import { describe, it, expect } from "vitest";
import {
  applyEdits,
  getPreset,
  parseProject,
  stageDefaults,
  preflightExport,
  describeBlueprint,
} from "../src/core/index.js";
describe("separate camera stage", () => {
  it("keeps 2D projects unchanged unless a stage operation is requested and roundtrips camera data", () => {
    const p = getPreset(),
      before = structuredClone(p);
    expect(p.stage).toBeUndefined();
    const next = applyEdits(p, [
      {
        action: "configure_stage",
        patch: { azimuth: 20, projection: "perspective", mode: "3d" },
      },
      {
        action: "place_stage_layer",
        id: p.layers[0].id,
        patch: { position: { y: 12, z: 30 }, plane: "upright" },
      },
    ]);
    expect(next.layers).toEqual(before.layers);
    expect(next.stage?.layers[p.layers[0].id].position).toEqual({
      x: 0,
      y: 12,
      z: 30,
    });
    expect(parseProject(JSON.parse(JSON.stringify(next))).stage).toEqual(
      next.stage,
    );
    expect(p).toEqual(before);
    const removed = applyEdits(next, [
      { action: "remove_layer", id: p.layers[0].id },
    ]);
    expect(removed.stage?.layers[p.layers[0].id]).toBeUndefined();
    expect(describeBlueprint(next).controls).toHaveLength(p.controls.length);
  });
  it("rejects invalid camera geometry, locked plane edits and unknown layer IDs atomically", () => {
    const p = getPreset();
    p.layers[0].locked = true;
    expect(() =>
      applyEdits(p, [
        {
          action: "place_stage_layer",
          id: p.layers[0].id,
          patch: { scale: 2 },
        },
      ]),
    ).toThrow("unlocked");
    expect(() =>
      applyEdits(p, [{ action: "configure_stage", patch: { elevation: 90 } }]),
    ).toThrow();
    expect(() =>
      applyEdits(p, [
        { action: "place_stage_layer", id: "missing", patch: {} },
      ]),
    ).toThrow();
    expect(p.stage).toBeUndefined();
  });
  it("checks per-layer rendering work for stage export independently from 2D pixel budgets", () => {
    const p = getPreset();
    p.canvas.width = p.canvas.height = 512;
    p.duration = 10;
    p.fps = 3;
    const plain = preflightExport(p, { format: "sequence" }),
      staged = preflightExport(p, { format: "sequence", view: "stage" });
    expect(plain.ok).toBe(true);
    expect(
      staged.checks.find((c) => c.resource === "stageLayerPixels")?.used,
    ).toBe(30 * 512 * 512 * p.layers.length);
    p.layers = Array.from({ length: 16 }, (_, i) => ({
      ...structuredClone(p.layers[0]),
      id: `layer-${i}`,
    }));
    const over = preflightExport(p, { format: "sequence", view: "stage" });
    expect(over.ok).toBe(false);
    expect(
      over.checks.find((c) => c.resource === "stageLayerPixels")?.used,
    ).toBe(30 * 512 * 512 * 16);
    expect(preflightExport(p, { format: "sequence" }).ok).toBe(true);
    expect(stageDefaults("3d").projection).toBe("perspective");
  });
});

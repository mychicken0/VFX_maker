import { describe, it, expect } from "vitest";
import {
  defineEffect,
  path,
  ring,
  curve,
  getPreset,
  parseProject,
  resolveControls,
  applyEdits,
  EditBatchError,
  summarizeChanges,
  layerTransform,
  mapPoint,
  pointToLocal,
  describeScene,
  pixelMetrics,
  candidateTimes,
  timelineTimes,
  observationSchema,
  validateObservation,
} from "../src/core/index.js";
import { ImageCache } from "../src/node/image-cache.js";
import { toolError } from "../src/node/tool-errors.js";

describe("agent coordinates and atomic editing", () => {
  it("places canvas points and vector handles through animated, macro-controlled transforms", () => {
    const p = defineEffect({
      duration: 1,
      canvas: { width: 128, height: 64 },
      layers: [
        path({
          id: "blade",
          name: "Blade",
          position: { x: 35, y: 20 },
          rotation: 30,
          scale: 2,
          motion: {
            x: curve(0, 10),
            y: curve(0, 6),
            rotation: curve(0, 60),
            scale: curve(1, 2),
          },
          opacity: curve(1),
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        }),
      ],
      controls: [
        {
          id: "size",
          name: "Size",
          min: 0.5,
          max: 3,
          value: 1.5,
          bindings: [{ layer: "blade", target: "scale", mode: "multiply" }],
        },
      ],
    });
    const points = [
        { x: 0.2, y: 0.25 },
        { x: 0.8, y: 0.75 },
      ],
      handles = points.map(() => ({
        in: { x: 0, y: 0.1 },
        out: { x: 0.1, y: 0 },
      }));
    const next = applyEdits(p, [
      {
        action: "set_path_points",
        id: "blade",
        time: 0.5,
        space: "normalized",
        points,
        handles,
      },
    ]);
    const l = resolveControls(next).layers[0];
    if (l.type !== "path") throw Error();
    const t = layerTransform(l, 0.5);
    l.points.forEach((q, i) => {
      const world = mapPoint(t.localToCanvas, q);
      expect(world.x).toBeCloseTo(points[i].x * 128);
      expect(world.y).toBeCloseTo(points[i].y * 64);
      const h = l.handles![i].out,
        end = mapPoint(t.localToCanvas, { x: q.x + h.x, y: q.y + h.y });
      expect(end.x - world.x).toBeCloseTo(12.8);
      expect(end.y - world.y).toBeCloseTo(0);
    });
    const scene = describeScene(next, resolveControls(next), 0.5);
    expect(scene.layers[0].drivenBy[0]).toMatchObject({
      control: "size",
      target: "scale",
      value: 1.5,
    });
    expect(scene.layers[0].baseTransform.scale).toBe(2);
    expect(scene.layers[0].resolvedTransform.scale).toBe(3);
    expect(p.layers[0]).not.toEqual(next.layers[0]);
  });
  it("clears stale handles and rejects singular transforms with an actionable operation error", () => {
    const p = defineEffect({
      layers: [
        path({
          id: "p",
          name: "P",
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          handles: [
            { in: { x: 0, y: 0 }, out: { x: 2, y: 0 } },
            { in: { x: -2, y: 0 }, out: { x: 0, y: 0 } },
          ],
          motion: { scale: curve(0.01, 1) },
        }),
      ],
    });
    expect(() =>
      pointToLocal(
        p,
        { ...p.layers[0], scale: 0 },
        { x: 10, y: 10 },
        "canvas",
        0,
      ),
    ).toThrow("scale is zero");
    const next = applyEdits(p, [
      {
        action: "set_path_points",
        id: "p",
        space: "local",
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 20 },
          { x: 30, y: 10 },
        ],
      },
    ]);
    expect((next.layers[0] as { handles?: unknown }).handles).toBeUndefined();
  });
  it("rolls back a failed sequence, identifies its step, and protects locks through raw patches", () => {
    const p = defineEffect({
      layers: [
        ring({ id: "a", name: "A" }),
        ring({ id: "b", name: "B", locked: true }),
      ],
    });
    const original = structuredClone(p);
    let error: unknown;
    try {
      applyEdits(p, [
        { action: "update_project", patch: { name: "Changed" } },
        { action: "update_layer", id: "b", patch: { rotation: 90 } },
      ]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EditBatchError);
    expect(toolError(error).error).toMatchObject({
      code: "LAYER_LOCKED",
      operationIndex: 1,
      operationNumber: 2,
      atomic: true,
    });
    expect(p).toEqual(original);
    expect(() =>
      applyEdits(p, [
        { action: "update_project", patch: { layers: [p.layers[0]] } },
      ]),
    ).toThrow("Unlock");
    const next = applyEdits(p, [
      { action: "update_layer", id: "b", patch: { locked: false } },
      { action: "update_layer", id: "b", patch: { rotation: 90 } },
    ]);
    expect(next.layers[1].rotation).toBe(90);
    expect(() =>
      applyEdits(p, [
        { action: "update_layer", id: "a", patch: { opacity: curve(3) } },
      ]),
    ).toThrow();
  });
  it("summarizes membership separately from order and rejects malformed operation sequences", () => {
    const p = defineEffect({
      layers: [ring({ id: "a", name: "A" }), ring({ id: "b", name: "B" })],
    });
    const next = applyEdits(p, [
      { action: "remove_layer", id: "a" },
      { action: "add_layer", layer: { type: "ring", id: "c", name: "C" } },
    ]);
    expect(summarizeChanges(p, next)).toMatchObject({
      added: ["c"],
      removed: ["a"],
      reordered: false,
    });
    expect(
      summarizeChanges(
        p,
        applyEdits(p, [{ action: "reorder_layers", ids: ["b", "a"] }]),
      ).reordered,
    ).toBe(true);
    expect(() => applyEdits(p, [])).toThrow();
    expect(() =>
      applyEdits(p, [{ action: "reorder_layers", ids: ["b", "b"] }]),
    ).toThrow();
  });
  it("reads 0.7.1 projects without changing source data", () => {
    const p = { ...getPreset(), version: "0.7.1" };
    expect(parseProject(p).version).toBe("0.7.6");
    expect(p.version).toBe("0.7.1");
  });
});
describe("observation contracts", () => {
  it("measures actual alpha bounds, sparse pixels and crops without counting invisible RGB", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    data.fill(100);
    for (let i = 3; i < data.length; i += 4) data[i] = 0;
    data[(1 * 4 + 1) * 4 + 3] = 255;
    data[(3 * 4 + 2) * 4 + 3] = 128;
    expect(pixelMetrics(data, 4, 4)).toEqual({
      visiblePixels: 2,
      alphaMass: 1.502,
      bounds: { x: 1, y: 1, width: 2, height: 3 },
      touches: ["bottom"],
    });
    expect(
      pixelMetrics(data, 4, 4, { x: 0, y: 0, width: 2, height: 2 }).bounds,
    ).toEqual({ x: 1, y: 1, width: 1, height: 1 });
    expect(
      pixelMetrics(data, 4, 4, { x: 0, y: 0, width: 1, height: 1 }).bounds,
    ).toBeNull();
  });
  it("bounds automatic sampling and excludes the non-exportable endpoint", () => {
    const p = getPreset();
    expect(candidateTimes(p).length).toBeLessThanOrEqual(20);
    for (const t of [...candidateTimes(p), ...timelineTimes(p)])
      expect(t).toBeLessThan(p.duration);
    for (const options of [
      { times: [0.2] },
      { view: "storyboard", time: 0.2 },
      { crop: { x: 127, y: 0, width: 2, height: 2 } },
      { ids: ["bad"] },
      { ids: ["cut-a", "cut-a"] },
      { point: { x: 128, y: 0 } },
      { time: 2 },
    ])
      expect(() =>
        validateObservation(p, observationSchema.parse(options)),
      ).toThrow();
  });
  it("keeps immutable image provenance distinct even for identical PNGs and evicts least recently used snapshots", () => {
    const cache = new ImageCache(),
      input = {
        name: "frame.png",
        role: "frame",
        file: "a.json",
        revision: "a".repeat(64),
        draft: false,
        width: 1,
        height: 1,
        png: Buffer.from("png"),
      };
    const a = cache.put(input),
      b = cache.put({ ...input, draft: true });
    expect(a.sha256).toBe(b.sha256);
    expect(a.uri).not.toBe(b.uri);
    for (let i = 0; i < 14; i++) cache.put({ ...input, time: i });
    cache.get(a.uri);
    cache.put({ ...input, time: 99 });
    expect(cache.get(a.uri).revision).toBe(input.revision);
    expect(() => cache.get(b.uri)).toThrow("expired");
    expect(cache.list()).toHaveLength(16);
    expect(toolError(Error("Revision conflict")).error.code).toBe(
      "REVISION_CONFLICT",
    );
  });
});

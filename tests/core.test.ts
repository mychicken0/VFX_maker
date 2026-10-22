import { describe, expect, it } from "vitest";
import { atlasLayout } from "../src/core/export-options.js";
import {
  PRESETS,
  getPreset,
  defineEffect,
  particles,
  path,
  curve,
  colors,
  evaluate,
  pointOnPath,
  random,
  frameIndex,
  parseProject,
  parseText,
  ParticleSampler,
} from "../src/core/index.js";
describe("authoring API and validation", () => {
  it("packs wide and tall frames without exceeding game-engine texture limits", () => {
    for (const [width, height, count] of [
      [512, 16, 300],
      [16, 512, 300],
      [512, 512, 64],
      [128, 128, 36],
    ]) {
      const layout = atlasLayout(width, height, count);
      expect(layout.width).toBeLessThanOrEqual(8192);
      expect(layout.height).toBeLessThanOrEqual(8192);
      expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(count);
      expect(layout.width * layout.height).toBeGreaterThanOrEqual(
        width * height * count,
      );
    }
    expect(() => atlasLayout(9000, 16, 1)).toThrow("8192");
    expect(() => atlasLayout(16, 16, 1, -1)).toThrow("padding");
  });
  it("all 18 templates validate, are independent copies and use generic layers", () => {
    expect(PRESETS).toHaveLength(18);
    for (const p of PRESETS) {
      expect(parseProject(p.project)).toEqual(p.project);
      const copy = getPreset(p.id);
      copy.name = "changed";
      expect(getPreset(p.id).name).toBe(p.name);
    }
  });
  it("authors a complete custom stroke without nodes or edges", () => {
    const p = defineEffect({
      name: "Custom",
      layers: [
        path({
          id: "stroke",
          name: "Stroke",
          points: [
            { x: -10, y: 0 },
            { x: 10, y: 0 },
          ],
          width: curve(5, 0),
          colors: colors("#00ff00"),
        }),
      ],
    });
    expect(p.layers[0].type).toBe("path");
    expect(p.canvas.width).toBe(128);
    expect("nodes" in p).toBe(false);
  });
  it("rejects unknown fields, duplicate IDs, invalid ranges, curves and missing textures", () => {
    const p = getPreset("spark_burst");
    expect(() => parseProject({ ...p, garbage: true })).toThrow();
    expect(() =>
      parseProject({ ...p, layers: [p.layers[0], p.layers[0]] }),
    ).toThrow("unique");
    expect(() => particles({ id: "p", name: "p", life: [2, 1] })).toThrow();
    expect(() =>
      parseProject({
        ...p,
        layers: [{ ...p.layers[1], shape: "sprite", asset: "missing" }],
      }),
    ).toThrow("existing sprite");
    expect(() =>
      parseProject({ ...p, layers: [{ ...p.layers[0], opacity: curve(2) }] }),
    ).toThrow("opacity");
    expect(() =>
      parseProject({
        ...p,
        layers: [
          { ...p.layers[1], count: 2000 },
          { ...p.layers[1], id: "p2", count: 2000 },
          { ...p.layers[1], id: "p3", count: 1 },
        ],
      }),
    ).toThrow("4000");
    expect(() => parseText('{"schema_version":1}')).toThrow("Rust 0.3");
    expect(() => parseText(" ".repeat(4194305))).toThrow("4 MiB");
  });
});
describe("curves and deterministic sampling", () => {
  it("interpolates linear, hold and smooth keys with endpoint clamping", () => {
    expect(evaluate(curve(2, 6), -1)).toBe(2);
    expect(evaluate(curve(2, 6), 0.25)).toBe(3);
    expect(evaluate(curve(2, 6), 2)).toBe(6);
    expect(
      evaluate(
        [
          { t: 0, value: 2, ease: "hold" },
          { t: 1, value: 6, ease: "linear" },
        ],
        0.99,
      ),
    ).toBe(2);
    expect(
      evaluate(
        [
          { t: 0, value: 0, ease: "smooth" },
          { t: 1, value: 1, ease: "linear" },
        ],
        0.25,
      ),
    ).toBe(0.15625);
  });
  it("samples a path by arc length and handles repeated points", () => {
    expect(
      pointOnPath(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 30 },
        ],
        0.5,
      ),
    ).toEqual({ x: 10, y: 10 });
    expect(
      pointOnPath(
        [
          { x: 2, y: 3 },
          { x: 2, y: 3 },
        ],
        0.5,
      ),
    ).toEqual({ x: 2, y: 3 });
  });
  it("flipbook lifetimes, loops and pingpong use row-major indices", () => {
    expect(frameIndex("life", 0.99, 1, 10, 6)).toBe(5);
    expect(frameIndex("loop", 0.7, 1, 10, 6)).toBe(1);
    expect(frameIndex("pingpong", 0.6, 1, 10, 4)).toBe(0);
    expect(frameIndex("once", 5, 1, 10, 6)).toBe(5);
  });
  it("is independent of scrub order and unrelated layer additions", () => {
    const p = getPreset("spark_burst"),
      l = p.layers[1];
    if (l.type !== "particles") throw new Error();
    const s = new ParticleSampler(p),
      expected = s.sample(l, 0.35);
    s.sample(l, 0.7);
    s.sample(l, 0.1);
    expect(s.sample(l, 0.35)).toEqual(expected);
    const other = defineEffect({
      ...p,
      layers: [particles({ id: "unrelated", name: "Unrelated" }), ...p.layers],
    });
    expect(new ParticleSampler(other).sample(l, 0.35)).toEqual(expected);
    expect(new ParticleSampler({ ...p, seed: 10 }).sample(l, 0.35)).not.toEqual(
      expected,
    );
    expect(random(5)()).toEqual(random(5)());
  });
  it("has repeatable cycle boundaries for stream effects and honors delays", () => {
    const p = getPreset("pixel_flame"),
      l = p.layers[0];
    if (l.type !== "particles") throw new Error();
    const s = new ParticleSampler(p);
    expect(s.sample(l, 0.2)).toEqual(s.sample(l, 1.4));
    expect(s.sample({ ...l, start: 0.5 }, 0.1)).toEqual([]);
  });
});

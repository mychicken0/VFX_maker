import { describe, expect, it } from "vitest";
import {
  defineEffect,
  ring,
  path,
  curve,
  colors,
  parseProject,
  getPreset,
  serialize,
  groupLayers,
  cleanupGroups,
  transformLayers,
  putKeyframe,
  patchLayers,
  defaultHandles,
  pathPolyline,
  simplifyStroke,
  resizeProject,
  evaluate,
} from "../src/core/index.js";
import {
  saveNative,
  textRevision,
  type ProjectFileHandle,
} from "../src/editor/documents.js";

const composition = () =>
  defineEffect({
    layers: [
      ring({
        id: "a",
        name: "A",
        position: { x: 20, y: 30 },
        motion: { x: curve(0, 8), y: curve(0, 4) },
      }),
      ring({ id: "b", name: "B", position: { x: 40, y: 30 } }),
      ring({ id: "c", name: "C", locked: true }),
    ],
  });
describe("selection editing and document validation", () => {
  it("groups and regroups without reordering pixels; rejects dangling or repeated members", () => {
    const p = composition(),
      g = groupLayers(p, "g", "Attack", ["a", "b"]);
    expect(g.layers).toEqual(p.layers);
    const next = groupLayers(g, "h", "Other", ["b", "c"]);
    expect(next.groups.map((g) => g.ids)).toEqual([["a"], ["b", "c"]]);
    expect(
      cleanupGroups({ ...next, layers: next.layers.slice(1) }).groups.map(
        (g) => g.ids,
      ),
    ).toEqual([["b", "c"]]);
    expect(() =>
      parseProject({
        ...g,
        groups: [...g.groups, { id: "h", name: "X", ids: ["b"] }],
      }),
    ).toThrow();
    expect(() => groupLayers(p, "g", "X", ["unknown"])).toThrow();
    expect(p.groups).toEqual([]);
  });
  it("transforms positions, motion and local shapes together around a pivot, skipping locked layers", () => {
    const p = composition(),
      next = transformLayers(p, ["a", "b", "c"], {
        x: 2,
        y: 3,
        rotation: 90,
        scale: 2,
      });
    expect(next.layers[0].position.x).toBeCloseTo(32);
    expect(next.layers[0].position.y).toBeCloseTo(13);
    expect(next.layers[1].position.y).toBeCloseTo(53);
    expect(next.layers[0].motion.x[1].value).toBeCloseTo(-8);
    expect(next.layers[0].motion.y[1].value).toBeCloseTo(16);
    expect(next.layers[0].scale).toBe(2);
    expect(next.layers[2]).toEqual(p.layers[2]);
    expect(() => transformLayers(p, ["a"], { scale: Infinity })).toThrow();
    expect(() => transformLayers(p, ["a"], { scale: 20 })).toThrow();
  });
  it("preserves independent easing during translation; refuses an inexact rotated motion", () => {
    const p = composition();
    p.layers[0].motion.x[0].ease = "smooth";
    const next = transformLayers(p, ["a"], { x: 3 });
    expect(next.layers[0].motion).toEqual(p.layers[0].motion);
    expect(() => transformLayers(p, ["a"], { rotation: 30 })).toThrow(
      "Align X/Y",
    );
    expect(p.layers[0].position.x).toBe(20);
  });
  it("inserts sorted keyframes, replaces the same time and preserves other motion channels", () => {
    const p = composition(),
      a = putKeyframe(p, "a", "motion.x", 0.25, 15, "smooth"),
      b = putKeyframe(a, "a", "motion.x", 0.25, 20, "hold");
    expect(b.layers[0].motion.x).toHaveLength(3);
    expect(b.layers[0].motion.x[1]).toEqual({
      t: 0.25,
      value: 20,
      ease: "hold",
    });
    expect(b.layers[0].motion.y).toEqual(p.layers[0].motion.y);
    expect(() => putKeyframe(p, "c", "opacity", 0.5, 1)).toThrow("Unlock");
    expect(() => putKeyframe(p, "a", "nonsense", 0.5, 1)).toThrow("channel");
    expect(() => putKeyframe(p, "a", "motion.x", 2, 1)).toThrow();
  });
  it("validates loop ranges and upgrades previous project data without changing the input", () => {
    const p = composition(),
      old = { ...p, version: "0.5.0" };
    expect(parseProject(old).version).toBe("0.7.2");
    expect(old.version).toBe("0.5.0");
    for (const range of [
      { start: 0, end: 11 },
      { start: 0.8, end: 0.2 },
      { start: 0, end: 0 },
    ])
      expect(() => parseProject({ ...p, editor: { range } })).toThrow();
  });
});
describe("custom canvas geometry", () => {
  it("samples real cubic curves, preserves endpoints and maintains handles after anchor edits", () => {
    const l = path({
      id: "p",
      name: "P",
      points: [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
      handles: [
        { in: { x: 0, y: 0 }, out: { x: 0, y: -20 } },
        { in: { x: 0, y: -20 }, out: { x: 0, y: 0 } },
      ],
    });
    if (l.type !== "path") throw Error();
    const samples = pathPolyline(l);
    expect(samples[0]).toEqual(l.points[0]);
    expect(samples.at(-1)).toEqual(l.points[1]);
    expect(Math.min(...samples.map((p) => p.y))).toBeLessThan(-14);
    const p = defineEffect({ layers: [l] }),
      next = patchLayers(p, ["p"], { points: [...l.points, { x: 30, y: 10 }] });
    expect((next.layers[0] as typeof l).handles).toHaveLength(3);
    expect(defaultHandles(l.points)).toHaveLength(2);
  });
  it("simplifies sampled freehand input with corners and endpoints retained and bounded output", () => {
    const input = Array.from({ length: 200 }, (_, i) => ({
      x: i / 10,
      y: i < 100 ? 0 : (i - 100) / 10,
    }));
    const points = simplifyStroke(input, 0.05);
    expect(points[0]).toEqual(input[0]);
    expect(points.at(-1)).toEqual(input.at(-1));
    expect(points.some((p) => p.x === 10 && p.y === 0)).toBe(true);
    expect(points.length).toBeLessThan(10);
    expect(
      simplifyStroke(
        Array.from({ length: 8000 }, (_, i) => ({
          x: i / 100,
          y: Math.sin(i) * 20,
        })),
      ).length,
    ).toBeLessThanOrEqual(64);
    expect(() => simplifyStroke([{ x: NaN, y: 0 }])).toThrow();
  });
  it("scales a preview reference with the composition without changing its source PNG", () => {
    const p = composition(),
      image = getPreset("flipbook_burst").assets[0];
    p.editor.reference = {
      image,
      position: { x: 64, y: 64 },
      scale: 1,
      opacity: 0.7,
      visible: true,
      plane: "behind",
    };
    const next = resizeProject(p, 64, 64);
    expect(next.editor.reference?.position).toEqual({ x: 32, y: 32 });
    expect(next.editor.reference?.scale).toBe(0.5);
    expect(next.editor.reference?.image.data).toBe(image.data);
  });
});
describe("native file replacement", () => {
  function disk(text = serialize(composition())) {
    let content = text;
    const backups: string[] = [];
    let aborted = false;
    const handle: ProjectFileHandle = {
      name: "effect.vfx.json",
      getFile: async () => new File([content], "effect.vfx.json"),
      createWritable: async () => {
        let pending = "";
        return {
          write: async (text) => {
            pending = text;
          },
          close: async () => {
            content = pending;
          },
          abort: async () => {
            aborted = true;
          },
        };
      },
    };
    return {
      handle,
      backups,
      get text() {
        return content;
      },
      set text(value: string) {
        content = value;
      },
      get aborted() {
        return aborted;
      },
    };
  }
  it("backs up before replacing and refuses external changes before or during backup", async () => {
    const d = disk(),
      before = d.text,
      revision = await textRevision(before),
      p = composition();
    p.seed = 45;
    const result = await saveNative(d.handle, p, revision, async (t) => {
      d.backups.push(t);
    });
    expect(d.backups).toEqual([before]);
    expect(JSON.parse(d.text).seed).toBe(45);
    expect(result.revision).toBe(await textRevision(d.text));
    await expect(
      saveNative(d.handle, p, revision, async () => {}),
    ).rejects.toThrow("Revision conflict");
    await expect(
      saveNative(d.handle, p, result.revision, async () => {
        d.text = "external";
      }),
    ).rejects.toThrow("during save");
    expect(d.text).toBe("external");
  });
  it("leaves original bytes on backup failure or permission denial and aborts failed streams", async () => {
    const d = disk(),
      before = d.text;
    await expect(
      saveNative(d.handle, composition(), undefined, async () => {
        throw Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect(d.text).toBe(before);
    d.handle.requestPermission = async () => "denied";
    await expect(
      saveNative(d.handle, composition(), undefined, async () => {}),
    ).rejects.toThrow("permission");
    delete d.handle.requestPermission;
    d.handle.createWritable = async () => ({
      write: async () => {
        throw Error("write failed");
      },
      close: async () => {},
      abort: async () => {
        d.text = before;
      },
    });
    await expect(
      saveNative(d.handle, composition(), undefined, async () => {}),
    ).rejects.toThrow("write failed");
    expect(d.text).toBe(before);
  });
});

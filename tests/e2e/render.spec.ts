import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import {
  getPreset,
  defineEffect,
  ring,
  sprite,
  curve,
  colors,
  PRESETS,
} from "../../src/core/index.js";
import { parseGIF, decompressFrames } from "gifuct-js";
test("all examples render actual nonblank pixels; scrubbing is reproducible", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const results = await page.evaluate(async () => {
    const results = [];
    for (const preset of window.vfx.presets) {
      const a = await window.vfx.preview(preset.project, 0.35);
      await window.vfx.preview(preset.project, 0.1);
      const b = await window.vfx.preview(preset.project, 0.35);
      results.push({ id: preset.id, a, equal: a === b });
    }
    return results;
  });
  expect(results).toHaveLength(PRESETS.length);
  for (const r of results) {
    expect(r.equal, r.id).toBe(true);
    const image = PNG.sync.read(Buffer.from(r.a, "base64"));
    expect(image.width).toBe(128);
    expect(
      image.data.some((v, i) => i % 4 === 3 && v > 0),
      r.id,
    ).toBe(true);
    expect(image.data[3], `${r.id} transparent edge`).toBe(0);
  }
});
test("renderer honors colors, alpha, layer order and exact pixels in export", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const p = defineEffect({
    canvas: { width: 32, height: 32, pixelArt: true },
    duration: 0.21,
    fps: 10,
    layers: [
      ring({
        id: "red",
        name: "Red",
        position: { x: 16, y: 16 },
        radius: curve(6),
        width: curve(12),
        colors: colors("#ff0000"),
        opacity: curve(1),
        blend: "normal",
      }),
      ring({
        id: "blue",
        name: "Blue",
        position: { x: 16, y: 16 },
        radius: curve(6),
        width: curve(12),
        colors: colors("#0000ff"),
        opacity: curve(1),
        blend: "normal",
      }),
    ],
  });
  const preview = await page.evaluate((p) => window.vfx.preview(p, 0.1), p);
  const png = PNG.sync.read(Buffer.from(preview, "base64"));
  expect([
    ...png.data.subarray((16 * 32 + 20) * 4, (16 * 32 + 20) * 4 + 4),
  ]).toEqual([0, 0, 255, 255]);
  const exported = await page.evaluate(
    (p) => window.vfx.export(p, { format: "spritesheet" }),
    p,
  );
  const atlas = PNG.sync.read(Buffer.from(exported["atlas.png"], "base64")),
    meta = JSON.parse(
      Buffer.from(exported["metadata.json"], "base64").toString(),
    );
  expect(meta.frames).toHaveLength(3);
  expect(meta.frames[2].duration).toBeCloseTo(0.01);
  const r = meta.frames[1].rect;
  for (let y = 0; y < 32; y++)
    expect(
      atlas.data.subarray(
        ((r.y + y) * atlas.width + r.x) * 4,
        ((r.y + y) * atlas.width + r.x + 32) * 4,
      ),
    ).toEqual(png.data.subarray(y * 32 * 4, (y + 1) * 32 * 4));
  expect(atlas.data[3]).toBe(0);
});
test("exports GIF, sequence, Godot and Unity with complete timing and portable source", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const p = getPreset("red_magic_cross");
  p.duration = 0.21;
  p.fps = 10;
  for (const format of ["gif", "sequence", "godot", "unity"] as const) {
    const files = await page.evaluate(
      ({ p, format }) => window.vfx.export(p, { format }),
      { p, format },
    );
    const meta = JSON.parse(
      Buffer.from(files["metadata.json"], "base64").toString(),
    );
    expect(meta.frames).toHaveLength(3);
    expect(
      JSON.parse(Buffer.from(files["effect.vfx.json"], "base64").toString()),
    ).toEqual(p);
    if (format === "gif") {
      const bytes = Buffer.from(files["animation.gif"], "base64");
      expect(bytes.subarray(0, 6).toString()).toBe("GIF89a");
      const decoded = decompressFrames(
        parseGIF(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        ),
        true,
      );
      expect(decoded).toHaveLength(3);
      expect(decoded.map((f) => f.delay)).toEqual([100, 100, 10]);
      expect(decoded[0].dims).toMatchObject({ width: 128, height: 128 });
      expect([...decoded[0].patch.subarray(0, 4)]).toEqual([17, 15, 25, 255]);
    }
    if (format === "sequence")
      expect(Object.keys(files).filter((k) => k.endsWith(".png"))).toHaveLength(
        3,
      );
    if (format === "godot") {
      const durations = [
        ...Buffer.from(files["effect.tres"], "base64")
          .toString()
          .matchAll(/"duration": ([\d.e-]+)/g),
      ].map((m) => Number(m[1]));
      expect(durations).toHaveLength(3);
      expect(durations[2]).toBeCloseTo(0.1);
    }
    if (format === "unity")
      expect(
        Buffer.from(files["Editor/VfxMakerImport.cs"], "base64").toString(),
      ).toContain("SetSpriteRects");
  }
});
test("flipbooks, half alpha, transform keyframes and glow affect actual RGBA pixels", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const sheet = new PNG({ width: 3, height: 1 });
  sheet.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const p = defineEffect({
    canvas: { width: 32, height: 32 },
    assets: [
      {
        id: "rgb",
        name: "RGB frames",
        width: 3,
        height: 1,
        columns: 3,
        rows: 1,
        frames: 3,
        data:
          "data:image/png;base64," + PNG.sync.write(sheet).toString("base64"),
      },
    ],
    layers: [
      sprite({
        id: "s",
        name: "Sprite",
        position: { x: 16, y: 16 },
        asset: "rgb",
        width: curve(6),
        height: curve(6),
        duration: 1,
        opacity: curve(0.5),
        blend: "normal",
      }),
    ],
  });
  for (const [t, rgb] of [
    [0, [255, 0, 0]],
    [0.34, [0, 255, 0]],
    [0.67, [0, 0, 255]],
  ] as const) {
    const encoded = await page.evaluate(
      ({ p, t }) => window.vfx.preview(p, t),
      { p, t },
    );
    const image = PNG.sync.read(Buffer.from(encoded, "base64"));
    expect(
      [
        ...image.data.subarray((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 4),
      ].slice(0, 3),
    ).toEqual([...rgb]);
    expect(
      Math.abs(image.data[(16 * 32 + 16) * 4 + 3] - 128),
    ).toBeLessThanOrEqual(1);
  }
  p.layers[0].motion.x = curve(8);
  const moved = PNG.sync.read(
    Buffer.from(
      await page.evaluate((p) => window.vfx.preview(p, 0.1), p),
      "base64",
    ),
  );
  expect(moved.data[(16 * 32 + 16) * 4 + 3]).toBe(0);
  expect(
    Math.abs(moved.data[(16 * 32 + 24) * 4 + 3] - 128),
  ).toBeLessThanOrEqual(1);
  const glow = defineEffect({
    canvas: { width: 32, height: 32 },
    layers: [
      ring({
        id: "r",
        name: "R",
        position: { x: 16, y: 16 },
        radius: curve(6),
        width: curve(1),
        opacity: curve(1),
        glow: { strength: 1, blur: 3 },
      }),
    ],
  });
  const glowing = PNG.sync.read(
    Buffer.from(
      await page.evaluate((p) => window.vfx.preview(p, 0.1), glow),
      "base64",
    ),
  );
  glow.layers[0].glow.strength = 0;
  const bare = PNG.sync.read(
    Buffer.from(
      await page.evaluate((p) => window.vfx.preview(p, 0.1), glow),
      "base64",
    ),
  );
  expect(glowing.data[(7 * 32 + 16) * 4 + 3]).toBeGreaterThan(
    bare.data[(7 * 32 + 16) * 4 + 3],
  );
});
test("pixel export settings preserve output palette and alpha; metadata hashes match scaled files", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const p = getPreset();
  p.duration = 0.31;
  p.fps = 10;
  p.output = {
    scale: 0.5,
    colors: 8,
    dither: true,
    pixelSize: 2,
    alphaLevels: 4,
  };
  const files = await page.evaluate(
      (p) => window.vfx.export(p, { format: "sequence" }),
      p,
    ),
    meta = JSON.parse(Buffer.from(files["metadata.json"], "base64").toString());
  expect(meta.version).toBe("0.7.1");
  expect(meta.canvas.width).toBe(64);
  expect(meta.sourceCanvas.width).toBe(128);
  const palettes = new Set<string>();
  for (const frame of meta.frames) {
    const data = Buffer.from(files[frame.file], "base64"),
      image = PNG.sync.read(data);
    expect(image.width).toBe(64);
    expect(frame.rect).toEqual({ x: 0, y: 0, width: 64, height: 64 });
    for (let i = 0; i < image.data.length; i += 4) {
      expect([0, 85, 170, 255]).toContain(image.data[i + 3]);
      if (image.data[i + 3])
        palettes.add([...image.data.subarray(i, i + 3)].join(","));
    }
    expect(createHash("sha256").update(data).digest("hex")).toBe(
      meta.files[frame.file],
    );
  }
  expect(palettes.size).toBeLessThanOrEqual(8);
  expect(palettes.size).toBeGreaterThan(1);
});
test("atlas edge extrusion repeats exact straight RGBA at padded borders", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const image = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < image.data.length; i += 4)
    image.data.set([240, 40, 20, 255], i);
  const p = defineEffect({
    canvas: { width: 32, height: 32 },
    duration: 0.1,
    fps: 10,
    assets: [
      {
        id: "square",
        name: "Square",
        width: 4,
        height: 4,
        data:
          "data:image/png;base64," + PNG.sync.write(image).toString("base64"),
      },
    ],
    layers: [
      sprite({
        id: "s",
        name: "S",
        position: { x: 16, y: 16 },
        asset: "square",
        width: curve(32),
        height: curve(32),
        opacity: curve(1),
        blend: "normal",
      }),
    ],
  });
  const files = await page.evaluate(
      (p) =>
        window.vfx.export(p, {
          format: "spritesheet",
          scale: 0.5,
          padding: 3,
          extrude: true,
        }),
      p,
    ),
    png = PNG.sync.read(Buffer.from(files["atlas.png"], "base64"));
  expect(png.width).toBe(22);
  expect(png.height).toBe(22);
  for (const [x, y] of [
    [0, 0],
    [21, 0],
    [0, 21],
    [21, 21],
    [3, 3],
    [18, 18],
  ])
    expect([
      ...png.data.subarray((y * 22 + x) * 4, (y * 22 + x) * 4 + 4),
    ]).toEqual([240, 40, 20, 255]);
});

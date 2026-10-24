import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import pako from "pako";
import {
  recolorProject,
  shiftColorHue,
  getPreset,
  parseProject,
  resizeProject,
  uniqueLayerName,
  decodePng,
  encodePng,
  optimizePng,
  processPixels,
  outputSize,
  exportPlan,
} from "../src/core/index.js";
function fixture(width = 16, height = 16) {
  const image = new PNG({ width, height });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data.set(
      [(i * 7) % 256, (i * 13) % 256, (i * 3) % 256, (i * 11) % 256],
      i,
    );
  }
  return image;
}
function crc(bytes: Buffer) {
  let n = -1;
  for (const b of bytes) {
    n ^= b;
    for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ -1) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const t = Buffer.from(type),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  t.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([t, data])), out.length - 4);
  return out;
}
describe("PNG optimization preserves the requested pixels", () => {
  it("preserves every RGBA byte, including hidden RGB and partial alpha, verified by an independent decoder", () => {
    const image = fixture();
    image.data.set([29, 37, 45, 0], 0);
    image.data.set([250, 5, 17, 127], 4);
    const input = PNG.sync.write(image, { deflateLevel: 0 }),
      result = optimizePng(input),
      decoded = PNG.sync.read(Buffer.from(result.png));
    expect(decoded.data).toEqual(image.data);
    expect(result.stats.lossless).toBe(true);
    expect(result.png.length).toBeLessThan(input.length);
    expect(encodePng(decodePng(result.png))).toEqual(
      encodePng(decodePng(result.png)),
    );
  });
  it("reads indexed low-bit-depth PNG and never makes a default lossless result larger", () => {
    const image = fixture(8, 8);
    for (let i = 0; i < image.data.length; i += 4)
      image.data.set(i % 8 ? [255, 0, 0, 255] : [0, 0, 0, 0], i);
    const input = encodePng({
      width: 8,
      height: 8,
      rgba: new Uint8ClampedArray(image.data),
    });
    expect([1, 2, 4, 8]).toContain(input[24]);
    const result = optimizePng(input);
    expect(result.png.length).toBeLessThanOrEqual(input.length);
    expect(PNG.sync.read(Buffer.from(result.png)).data).toEqual(image.data);
  });
  it("nearest-neighbor resizes, clamps to one pixel, and groups output blocks without smoothing", () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 255, 255,
    ]);
    const doubled = processPixels({ width: 2, height: 2, rgba }, { scale: 2 });
    expect(doubled.width).toBe(4);
    expect([...doubled.rgba.subarray(0, 16)]).toEqual([
      255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 128, 0, 255, 0, 128,
    ]);
    expect(outputSize(1, 1, 0.125)).toEqual({ width: 1, height: 1 });
    const blocked = processPixels(
      { width: 2, height: 2, rgba },
      { pixelSize: 2 },
    );
    expect([...blocked.rgba]).toEqual(Array(4).fill([255, 0, 0, 255]).flat());
    expect(() => outputSize(1024, 1024, 8)).toThrow("limit");
  });
  it("limits visible RGB colors independently from alpha and makes deterministic dithering", () => {
    const source = decodePng(PNG.sync.write(fixture(32, 32))),
      options = { colors: 4, dither: true, alphaLevels: 4 };
    const a = processPixels(source, options),
      b = processPixels(source, options);
    expect(a).toEqual(b);
    const visible = new Set<string>(),
      alphas = new Set<number>();
    for (let i = 0; i < a.rgba.length; i += 4) {
      alphas.add(a.rgba[i + 3]);
      if (a.rgba[i + 3]) visible.add([...a.rgba.subarray(i, i + 3)].join(","));
    }
    expect(visible.size).toBeLessThanOrEqual(4);
    expect([...alphas].every((n) => [0, 85, 170, 255].includes(n))).toBe(true);
    expect(() => processPixels(source, { colors: 1 })).toThrow();
    expect(() => processPixels(source, { scale: 0 })).toThrow();
  });
  it("rejects damaged PNG checksums, truncation and oversized decompression before codec allocation", () => {
    const good = PNG.sync.write(fixture()),
      bad = Buffer.from(good);
    bad[30] ^= 1;
    expect(() => decodePng(bad)).toThrow("checksum");
    expect(() => decodePng(good.subarray(0, good.length - 3))).toThrow();
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 6;
    const bomb = Buffer.concat([
      good.subarray(0, 8),
      chunk("IHDR", header),
      chunk("IDAT", Buffer.from(pako.deflate(new Uint8Array(1000000)))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => decodePng(bomb)).toThrow("decompression budget");
    const apng = Buffer.concat([
      good.subarray(0, 33),
      chunk("acTL", Buffer.alloc(8)),
      good.subarray(33),
    ]);
    expect(() => decodePng(apng)).toThrow("APNG");
  });
  it("rejects unsupported gamma and compressed metadata instead of silently changing color interpretation", () => {
    const good = PNG.sync.write(fixture()),
      gamma = Buffer.alloc(4);
    gamma.writeUInt32BE(100000);
    expect(() =>
      decodePng(
        Buffer.concat([
          good.subarray(0, 33),
          chunk("gAMA", gamma),
          good.subarray(33),
        ]),
      ),
    ).toThrow("sRGB");
    expect(() =>
      decodePng(
        Buffer.concat([
          good.subarray(0, 33),
          chunk("iCCP", Buffer.alloc(5)),
          good.subarray(33),
        ]),
      ),
    ).toThrow("metadata");
  });
});
describe("portable output and canvas authoring", () => {
  it("upgrades supported project data without mutating input or accepting future versions", () => {
    const input = { ...getPreset(), version: "0.4.0" } as Record<
      string,
      unknown
    >;
    delete input.output;
    const result = parseProject(input);
    expect(result.version).toBe("0.7.6");
    expect(result.output.scale).toBe(1);
    expect(input.version).toBe("0.4.0");
    expect(input.output).toBeUndefined();
    expect(() => parseProject({ ...input, version: "9.0.0" })).toThrow();
  });
  it("scales positions, offsets, geometry and glow uniformly while retaining timing and texture data", () => {
    const p = getPreset();
    p.layers[0].locked = true;
    p.layers[0].motion.x = [{ t: 0, value: 12, ease: "linear" }];
    const before = structuredClone(p),
      next = resizeProject(p, 256, 128);
    expect(next.layers[0].position).toEqual({
      x: p.layers[0].position.x + 64,
      y: p.layers[0].position.y,
    });
    const half = resizeProject(p, 64, 64);
    expect(half.layers[0].scale).toBe(p.layers[0].scale * 0.5);
    expect(half.layers[0].glow.blur).toBe(p.layers[0].glow.blur * 0.5);
    expect(half.layers[0].motion.x[0].value).toBe(6);
    expect(half.layers[0].start).toBe(p.layers[0].start);
    expect(half.assets).toEqual(p.assets);
    expect(p).toEqual(before);
    expect(resizeProject(p, 64, 64, "canvas").layers).toEqual(p.layers);
    expect(() => resizeProject(p, 0, 64)).toThrow();
  });
  it("makes distinct names even at the name-length boundary", () => {
    expect(uniqueLayerName("Slash", ["Slash", "Slash 2"])).toBe("Slash 3");
    const base = "x".repeat(100),
      name = uniqueLayerName(base, [base]);
    expect(name.length).toBe(100);
    expect(name).not.toBe(base);
  });
  it("preflights actual output dimensions, project defaults, frame budget and atlas padding", () => {
    const p = getPreset();
    p.output.scale = 0.5;
    const a = exportPlan(p, {
      format: "spritesheet",
      padding: 4,
      extrude: true,
    });
    expect(a.width).toBe(64);
    expect(a.atlas?.padding).toBe(4);
    expect(a.options.extrude).toBe(true);
    expect(exportPlan(p, { format: "sequence", scale: 2 }).width).toBe(256);
    expect(() => exportPlan(p, { format: "gif", scale: 8 })).toThrow("budget");
  });
});
describe("composition recoloring and large PNG output", () => {
  it("rotates hues without changing grayscale or shading, skips locked layers and confines selections", () => {
    expect(shiftColorHue("#ff0000", 120)).toBe("#00ff00");
    expect(shiftColorHue("#0f3f0f", 120)).toBe("#0f0f3f");
    expect(shiftColorHue("#7f7f7f", 90)).toBe("#7f7f7f");
    expect(shiftColorHue("#abcdef", 360)).toBe("#abcdef");
    const p = getPreset();
    p.layers[0].locked = true;
    const next = recolorProject(p, 120);
    expect(next.layers[0]).toEqual(p.layers[0]);
    expect(next.layers[1].colors).not.toEqual(p.layers[1].colors);
    expect(next.assets).toEqual(p.assets);
    expect(recolorProject(p, 120, true, [p.layers[0].id]).layers[1]).toEqual(
      p.layers[1],
    );
    expect(() => recolorProject(p, 120, false, ["absent"])).toThrow("Unknown");
  });
  it("encodes an atlas above the palette-analysis budget without changing hidden RGB or partial alpha", () => {
    const width = 2049,
      height = 2048,
      rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4)
      rgba.set([19, 37, 71, i % 16 === 0 ? 0 : 127], i);
    const png = encodePng({ width, height, rgba }),
      decoded = PNG.sync.read(Buffer.from(png));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.data.equals(Buffer.from(rgba))).toBe(true);
  });
});

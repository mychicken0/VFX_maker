import UPNG from "upng-js";
import pako from "pako";
import * as gifencModule from "gifenc";
// Node exposes the CommonJS object as default; browser bundlers use ESM.
const gifenc =
  typeof gifencModule.quantize === "function"
    ? gifencModule
    : gifencModule.default;
import {
  pixelOptionsSchema,
  outputSize,
  type PixelInput,
} from "./pixel-options.js";
export type Bitmap = { width: number; height: number; rgba: Uint8ClampedArray };
export type Palette = number[][];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
/** Validate chunk bounds/CRC and inflate budgets before handing data to a codec. */
export function inspectPng(bytes: Uint8Array) {
  if (
    bytes.length > 4194304 ||
    bytes.length < 45 ||
    bytes.slice(0, 8).join(",") !== "137,80,78,71,13,10,26,10"
  )
    throw new Error("Choose a static PNG of at most 4 MiB");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0,
    depth = 0,
    ended = false;
  const chunks: Uint8Array[] = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw new Error("Truncated PNG chunk");
    const length = view.getUint32(offset),
      end = offset + 12 + length;
    if (end > bytes.length || length > 4194304)
      throw new Error("Invalid PNG chunk length");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4))
      throw new Error(`PNG checksum failed (${type})`);
    if (offset === 8 && (type !== "IHDR" || length !== 13))
      throw new Error("PNG must start with IHDR");
    if (type === "IHDR") {
      if (width) throw new Error("Duplicate PNG header");
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      depth = bytes[offset + 16];
      if (
        width < 1 ||
        height < 1 ||
        width > 1024 ||
        height > 1024 ||
        width * height > 1048576
      )
        throw new Error("PNG input supports at most 1024 × 1024 pixels");
      if (![1, 2, 4, 8].includes(depth))
        throw new Error("Use an 8-bit PNG for pixel optimization");
      const colorType = bytes[offset + 17];
      if (
        ![0, 2, 3, 4, 6].includes(colorType) ||
        ([2, 4, 6].includes(colorType) && depth !== 8) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] > 1
      )
        throw new Error("Unsupported PNG image header");
    }
    if (type === "acTL")
      throw new Error("APNG is not supported. Use a static flipbook sheet.");
    if (["iCCP", "zTXt", "iTXt"].includes(type))
      throw new Error(
        "Export an sRGB PNG without compressed metadata before optimizing",
      );
    if (
      type === "gAMA" &&
      (length !== 4 || view.getUint32(offset + 8) !== 45455)
    )
      throw new Error("Convert this PNG to sRGB before optimizing");
    if (type === "IDAT") chunks.push(bytes.subarray(offset + 8, end - 4));
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length)
        throw new Error("Invalid PNG end");
      ended = true;
      break;
    }
    offset = end;
  }
  if (!ended || !chunks.length)
    throw new Error("PNG has no complete image data");
  const compressed = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    compressed.set(c, at);
    at += c.length;
  }
  const inflate = new pako.Inflate({ chunkSize: 32768, windowBits: 15 });
  let inflated = 0;
  inflate.onData = (chunk) => {
    inflated += chunk instanceof ArrayBuffer ? chunk.byteLength : chunk.length;
    if (inflated > width * height * 8 + height * 16 + 1024)
      throw new Error("PNG decompression budget exceeded");
  };
  inflate.push(compressed, true);
  if (inflate.err || !(inflate as pako.Inflate & { ended: boolean }).ended)
    throw new Error("Invalid compressed PNG image data");
  return { width, height, depth };
}
export function decodePng(bytes: Uint8Array): Bitmap {
  const { width, height } = inspectPng(bytes);
  const decoded = UPNG.decode(new Uint8Array(bytes).buffer),
    frames = UPNG.toRGBA8(decoded);
  if (frames.length !== 1 || frames[0].byteLength !== width * height * 4)
    throw new Error("Invalid PNG pixel data");
  return { width, height, rgba: new Uint8ClampedArray(frames[0]) };
}
export function createPalette(
  rgba: Uint8ClampedArray,
  colors: number,
): Palette {
  const visible = new Uint8ClampedArray(rgba.length);
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4)
    if (rgba[i + 3]) {
      visible.set(rgba.subarray(i, i + 4), count);
      count += 4;
    }
  return count
    ? gifenc.quantize(visible.subarray(0, count), colors, { format: "rgb565" })
    : [[0, 0, 0]];
}
/** Nearest-neighbor scaling and ordered dithering never interpolate pixel edges. */
export function processPixels(
  source: Bitmap,
  input: PixelInput = {},
  palette?: Palette,
): Bitmap {
  if (source.rgba.length !== source.width * source.height * 4)
    throw new Error("Invalid RGBA buffer");
  const options = pixelOptionsSchema.parse(input),
    { width, height } = outputSize(source.width, source.height, options.scale);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = Math.min(
        source.width - 1,
        Math.floor(
          ((Math.floor(x / options.pixelSize) * options.pixelSize + 0.5) *
            source.width) /
            width,
        ),
      );
      const sy = Math.min(
        source.height - 1,
        Math.floor(
          ((Math.floor(y / options.pixelSize) * options.pixelSize + 0.5) *
            source.height) /
            height,
        ),
      );
      const from = (sy * source.width + sx) * 4,
        to = (y * width + x) * 4;
      rgba.set(source.rgba.subarray(from, from + 4), to);
      if (options.alphaLevels)
        rgba[to + 3] = Math.round(
          (Math.round((rgba[to + 3] / 255) * (options.alphaLevels - 1)) * 255) /
            (options.alphaLevels - 1),
        );
    }
  if (options.colors) {
    palette ??= createPalette(rgba, options.colors);
    const mapping = new Uint8ClampedArray(rgba);
    if (options.dither)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4,
            delta = (BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * 48;
          for (let c = 0; c < 3; c++) mapping[i + c] += delta;
        }
    const indexed = gifenc.applyPalette(mapping, palette, "rgb565");
    for (let i = 0; i < indexed.length; i++)
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = palette[indexed[i]][c];
  }
  return { width, height, rgba };
}
/** Straight RGBA fallback for large atlases; avoids a canvas premultiply roundtrip. */
function rgbaPng(bitmap: Bitmap): Uint8Array {
  const row = bitmap.width * 4,
    raw = new Uint8Array((row + 1) * bitmap.height);
  for (let y = 0; y < bitmap.height; y++)
    raw.set(bitmap.rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  const ihdr = new Uint8Array(13),
    view = new DataView(ihdr.buffer);
  view.setUint32(0, bitmap.width);
  view.setUint32(4, bitmap.height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunks = [
    ["IHDR", ihdr],
    ["IDAT", pako.deflate(raw, { level: 6 })],
    ["IEND", new Uint8Array()],
  ] as const;
  const png = new Uint8Array(
    8 + chunks.reduce((n, [, data]) => n + 12 + data.length, 0),
  );
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new DataView(png.buffer);
  let at = 8;
  for (const [type, data] of chunks) {
    header.setUint32(at, data.length);
    for (let c = 0; c < 4; c++) png[at + 4 + c] = type.charCodeAt(c);
    png.set(data, at + 8);
    header.setUint32(
      at + 8 + data.length,
      crc32(png.subarray(at + 4, at + 8 + data.length)),
    );
    at += 12 + data.length;
  }
  return png;
}
export function encodePng(bitmap: Bitmap): Uint8Array {
  if (
    ![bitmap.width, bitmap.height].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 8192,
    ) ||
    bitmap.width * bitmap.height > 33554432 ||
    bitmap.rgba.length !== bitmap.width * bitmap.height * 4
  )
    throw new Error("Invalid PNG encoding dimensions or pixel buffer");
  if (bitmap.width * bitmap.height > 4194304) return rgbaPng(bitmap);
  const bytes = new Uint8Array(
    UPNG.encode(
      [new Uint8Array(bitmap.rgba).buffer],
      bitmap.width,
      bitmap.height,
      0,
    ),
  );
  // Exact RGBA verification catches palette/transparency edge cases in encoders.
  const decoded = UPNG.toRGBA8(UPNG.decode(new Uint8Array(bytes).buffer))[0];
  const check = new Uint8Array(decoded);
  if (
    check.length !== bitmap.rgba.length ||
    check.some((v, i) => v !== bitmap.rgba[i])
  ) {
    const encode = UPNG.encode as unknown as (
      a: ArrayBuffer[],
      w: number,
      h: number,
      n: number,
      d: undefined,
      forbidPalette: boolean,
    ) => ArrayBuffer;
    const raw = new Uint8Array(
      encode(
        [new Uint8Array(bitmap.rgba).buffer],
        bitmap.width,
        bitmap.height,
        0,
        undefined,
        true,
      ),
    );
    const verified = new Uint8Array(
      UPNG.toRGBA8(UPNG.decode(new Uint8Array(raw).buffer))[0],
    );
    if (
      verified.length !== bitmap.rgba.length ||
      verified.some((v, i) => v !== bitmap.rgba[i])
    )
      throw new Error("PNG encoder could not preserve exact pixels");
    return raw;
  }
  return bytes;
}
export function colorCount(rgba: Uint8ClampedArray): number {
  const set = new Set<number>();
  for (let i = 0; i < rgba.length; i += 4)
    if (rgba[i + 3])
      set.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
  return set.size;
}
export function optimizePng(input: Uint8Array, options: PixelInput = {}) {
  const source = decodePng(input),
    settings = pixelOptionsSchema.parse(options),
    bitmap = processPixels(source, settings);
  let png = encodePng(bitmap),
    keptOriginal = false;
  if (
    settings.scale === 1 &&
    !settings.colors &&
    !settings.alphaLevels &&
    settings.pixelSize === 1 &&
    png.length >= input.length
  ) {
    png = new Uint8Array(input);
    keptOriginal = true;
  }
  return {
    png,
    bitmap,
    stats: {
      inputBytes: input.length,
      outputBytes: png.length,
      savedBytes: input.length - png.length,
      savingsPercent: (1 - png.length / input.length) * 100,
      inputWidth: source.width,
      inputHeight: source.height,
      width: bitmap.width,
      height: bitmap.height,
      colorsBefore: colorCount(source.rgba),
      colorsAfter: colorCount(bitmap.rgba),
      lossless:
        settings.scale === 1 &&
        !settings.colors &&
        !settings.alphaLevels &&
        settings.pixelSize === 1,
      keptOriginal,
    },
  };
}

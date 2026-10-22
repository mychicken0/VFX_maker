import { decodePng } from "./pixels.js";
import type { Asset } from "./model.js";
interface Emission {
  width: number;
  height: number;
  pixels: Uint32Array;
}
const cache = new Map<string, Emission>();
/** At most four decoded masks are retained; changing other fields never re-decodes a PNG. */
export function emissionPixels(a: Asset, threshold: number): Emission {
  const key = `${a.columns}:${a.rows}:${threshold}:${a.data}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const image = decodePng(
    Uint8Array.from(atob(a.data.split(",")[1]), (c) => c.charCodeAt(0)),
  );
  const width = a.width / a.columns,
    height = a.height / a.rows,
    pixels: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const alpha = image.rgba[(y * a.width + x) * 4 + 3];
      if (alpha > 0 && alpha / 255 >= threshold) pixels.push(y * width + x);
    }
  if (!pixels.length)
    throw Error("Emission image has no pixels above the alpha threshold");
  const result = { width, height, pixels: new Uint32Array(pixels) };
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

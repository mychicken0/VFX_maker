import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { VERSION, PRESETS, optimizePng } from "../dist/core.js";
const { values } = parseArgs({
  options: { gallery: { type: "string" }, out: { type: "string" } },
});
if (!values.gallery || !values.out)
  throw Error("Use --gallery RENDERED_GALLERY --out NEW_DIRECTORY");
const out = resolve(values.out),
  gallery = resolve(values.gallery);
await mkdir(out);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const records = [];
for (const preset of PRESETS) {
  const input = await readFile(join(gallery, preset.id, "preview.png")),
    directory = join(out, preset.id);
  await mkdir(directory);
  await writeFile(join(directory, "input.png"), input);
  const record = { id: preset.id, inputSha256: hash(input), variants: {} };
  for (const [name, options] of Object.entries({
    lossless: {},
    pixel16: { scale: 0.5, colors: 16, alphaLevels: 4 },
  })) {
    const started = performance.now(),
      result = optimizePng(input, options),
      milliseconds = performance.now() - started;
    if (
      name === "lossless" &&
      !PNG.sync
        .read(input)
        .data.equals(PNG.sync.read(Buffer.from(result.png)).data)
    )
      throw Error("Lossless pixels changed: " + preset.id);
    await writeFile(join(directory, name + ".png"), result.png);
    record.variants[name] = {
      ...result.stats,
      options,
      sha256: hash(result.png),
      milliseconds,
    };
  }
  records.push(record);
}
const summary = Object.fromEntries(
  ["lossless", "pixel16"].map((name) => {
    const before = records.reduce((n, r) => n + r.variants[name].inputBytes, 0),
      after = records.reduce((n, r) => n + r.variants[name].outputBytes, 0);
    return [
      name,
      {
        inputBytes: before,
        outputBytes: after,
        savingsPercent: (1 - after / before) * 100,
      },
    ];
  }),
);
await writeFile(
  join(out, "measurements.json"),
  JSON.stringify(
    {
      version: VERSION,
      date: new Date().toISOString(),
      node: process.version,
      frames: records.length,
      summary,
      records,
    },
    null,
    2,
  ) + "\n",
);
const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
await writeFile(
  join(out, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VFX Maker ${VERSION} pixel outputs</title><style>body{background:#111017;color:#e4daef;font:14px system-ui;margin:24px auto;max-width:1150px;padding:0 18px}h1{font-size:28px}p,small{color:#a493b4}article{background:#201929;border:1px solid #483351;border-radius:10px;padding:18px;margin:18px 0}.images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}img{width:100%;height:220px;object-fit:contain;image-rendering:pixelated;background:repeating-conic-gradient(#302639 0 25%,#251e2f 0 50%) 50%/16px 16px;border-radius:6px}a{color:#c7a5f3}h2{font-size:18px}h3{font-size:12px}@media(max-width:600px){.images{grid-template-columns:1fr}img{height:200px}}</style><h1>VFX Maker ${VERSION} · pixel output comparison</h1><p>18 actual PixiJS frames. Lossless keeps exact decoded RGBA; pixel16 uses half resolution, 16 RGB colors and four alpha levels and loses detail.</p><p>Aggregate: lossless ${summary.lossless.savingsPercent.toFixed(1)}% smaller · pixel16 ${summary.pixel16.savingsPercent.toFixed(1)}% smaller. Results depend on the input.</p><a href="measurements.json">Full measurements and SHA-256 checksums</a>${records
    .map(
      (record) =>
        `<article><h2>${esc(PRESETS.find((p) => p.id === record.id).name)}</h2><div class="images">${[
          "input",
          "lossless",
          "pixel16",
        ]
          .map((name) => {
            const stats = record.variants[name === "input" ? "lossless" : name];
            return `<div><h3>${name === "input" ? "Original" : name === "lossless" ? "Lossless" : "Pixel16 · lossy"}</h3><a href="${record.id}/${name}.png"><img src="${record.id}/${name}.png" alt="${esc(record.id)} ${name}"></a><p>${name === "input" ? stats.inputBytes : stats.outputBytes} bytes${name === "input" ? "" : ` · ${stats.savingsPercent.toFixed(1)}% smaller`}</p></div>`;
          })
          .join("")}</div></article>`,
    )
    .join("")}</html>`,
);
console.log(JSON.stringify({ frames: records.length, summary }, null, 2));

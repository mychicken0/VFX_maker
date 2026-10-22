import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { VERSION, PRESETS } from "../dist/core.js";
import { createHash } from "node:crypto";
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    thumbnails: { type: "boolean", default: false },
    showcase: { type: "boolean", default: false },
  },
});
if (!values.out) throw new Error("Use --out NEW_DIRECTORY [--thumbnails]");
const out = resolve(values.out);
await mkdir(out);
const showcase = new Set([
    "red_magic_cross",
    "void_portal",
    "ember_plume",
    "electric_bloom",
    "ice_lance",
    "heal_pulse",
    "lightning",
    "comet",
    "stardust",
  ]),
  manifest = [];
if (values.showcase) await mkdir("examples/showcase", { recursive: true });
const child = spawn(
  process.execPath,
  [resolve("dist/cli.js"), "studio", "--port", "0"],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const url = await new Promise((res, rej) => {
  let data = "";
  child.stdout.on("data", (b) => {
    data += b;
    try {
      res(JSON.parse(data).studio);
    } catch {}
  });
  child.once("error", rej);
  child.once("exit", (c) => rej(new Error(`Studio exited ${c}`)));
});
const browser = await chromium.launch({
  executablePath: process.env.VFX_CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--disable-dev-shm-usage",
  ],
});
try {
  const page = await browser.newPage();
  await page.goto(url + "render.html");
  await page.waitForFunction(() => !!window.vfx);
  for (const preset of PRESETS) {
    const dir = join(out, preset.id);
    await mkdir(dir);
    const image = await page.evaluate(
      (p) => window.vfx.preview(p, 0.35),
      preset.project,
    );
    await writeFile(join(dir, "preview.png"), Buffer.from(image, "base64"));
    if (values.thumbnails) {
      await mkdir("public/thumbnails", { recursive: true });
      await writeFile(
        `public/thumbnails/${preset.id}.png`,
        Buffer.from(image, "base64"),
      );
    }
    for (const format of ["gif", "spritesheet"]) {
      const files = await page.evaluate(
        ({ project, format }) =>
          window.vfx.export(project, {
            format,
            scale: format === "gif" ? 2 : 1,
          }),
        { project: preset.project, format },
      );
      await mkdir(join(dir, format));
      for (const [name, data] of Object.entries(files))
        await writeFile(join(dir, format, name), Buffer.from(data, "base64"));
      if (values.showcase && format === "gif" && showcase.has(preset.id)) {
        const gif = Buffer.from(files["animation.gif"], "base64");
        await writeFile(`examples/showcase/${preset.id}.gif`, gif);
        await writeFile(
          `examples/showcase/${preset.id}.vfx.json`,
          JSON.stringify(preset.project, null, 2) + "\n",
        );
        manifest.push({
          id: preset.id,
          version: VERSION,
          bytes: gif.length,
          sha256: createHash("sha256").update(gif).digest("hex"),
          frames: Math.ceil(preset.project.duration * preset.project.fps),
          scale: 2,
        });
      }
    }
    process.stdout.write(`${preset.id}\n`);
  }
  if (values.showcase)
    await writeFile(
      "examples/showcase/manifest.json",
      JSON.stringify(
        {
          version: VERSION,
          renderer: "VFX Maker PixiJS WebGL",
          items: manifest,
        },
        null,
        2,
      ) + "\n",
    );
  const studio = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await studio.goto(url);
  await studio.getByRole("button", { name: "Pause", exact: true }).click();
  await studio.getByLabel("Playhead", { exact: true }).fill("0.4");
  await studio
    .locator(".layer-select")
    .filter({ hasText: "First slash" })
    .click();
  await studio.getByRole("button", { name: "effects", exact: true }).click();
  await studio.waitForTimeout(300);
  await studio.screenshot({ path: join(out, "studio.png") });
  if (values.thumbnails) {
    await copyFile(join(out, "studio.png"), "examples/studio.png");
    await copyFile(
      join(out, "red_magic_cross/gif/animation.gif"),
      "examples/red-magic-cross.gif",
    );
  }
  const esc = (s) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  await writeFile(
    join(out, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>VFX Maker ${VERSION} gallery</title><style>body{background:#111017;color:#e0d6ee;font:14px system-ui;margin:40px}h1{font-size:28px}p{color:#9b8da9}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}article{border:1px solid #3f304e;border-radius:10px;padding:18px;background:#1e1828}img{image-rendering:pixelated;width:100%;aspect-ratio:1;object-fit:contain;background:#110f19;border-radius:7px}a{color:#c29ef4;font-size:12px;margin-right:10px}h2{font-size:17px}</style><h1>VFX Maker ${VERSION}</h1><p>${PRESETS.length} real PixiJS renders · editable layers · GIF + transparent PNG atlases</p><main>${PRESETS.map((p) => `<article><img src="${p.id}/gif/animation.gif" alt="${esc(p.name)}"><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><a href="${p.id}/gif/animation.gif">GIF</a><a href="${p.id}/spritesheet/atlas.png">Atlas</a><a href="${p.id}/spritesheet/metadata.json">Timing</a><a href="${p.id}/spritesheet/effect.vfx.json">Project</a></article>`).join("")}</main></html>`,
  );
} finally {
  await browser.close();
  child.kill("SIGTERM");
}

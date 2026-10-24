// Reproducible human UI tour: build from empty -> edit nodes -> place planes -> camera export.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { defineEffect, VERSION } from "../dist/core.js";
const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Supply a new tour directory");
await mkdir(out);
const child = spawn(
  process.execPath,
  [resolve("dist/cli.js"), "studio", "--port", "0"],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const url = await new Promise((yes, no) => {
  let data = "";
  child.stdout.on("data", (b) => {
    data += b;
    try {
      yes(JSON.parse(data).studio);
    } catch {}
  });
  child.once("error", no);
  child.once("exit", (c) => no(Error(`Studio exited ${c}`)));
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
  const page = await browser.newPage({
      viewport: { width: 1752, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const b = (name) => page.getByRole("button", { name, exact: true });
  const shot = async (name) => {
    await page.waitForTimeout(160);
    await page.screenshot({ path: join(out, name) });
  };
  const add = async (key) => {
    await b("Add node").click();
    await page.locator(`[data-node="${key}"]`).click();
  };
  const field = async (label, value) => {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).blur();
  };
  await page.goto(url);
  await b("Pause").click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "tour.vfx.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify(
          defineEffect({
            name: "Workspace arc and sparks",
            duration: 1.2,
            fps: 24,
            layers: [],
          }),
        ),
      ),
    });
  await page.getByLabel("Playhead", { exact: true }).fill("0.25");
  await b("Blueprint").click();
  await b("Add node").click();
  await shot("blueprint-add.png");
  await page.locator('[data-node="layer:ring"]').click();
  await add("control:number");
  await field("Node New control", "270");
  await page.getByLabel("Node control name", { exact: true }).fill("Arc");
  await page.getByText("Connect parameters", { exact: true }).click();
  await page
    .getByLabel("Blueprint layer", { exact: true })
    .selectOption({ label: "New ring" });
  await page
    .getByLabel("Blueprint parameter", { exact: true })
    .selectOption("arc");
  await b("Connect").click();
  await add("modifier:outline");
  await field("Outline Thickness", "1");
  await add("layer:particles");
  await page
    .getByLabel("Blueprint layers", { exact: true })
    .selectOption("all");
  await b("Arrange").click();
  await b("Fit nodes").click();
  await page.locator(".toast").waitFor({ state: "hidden" });
  await shot("blueprint-built.png");
  await b("Close dialog").click();
  await b("2.5D / 3D").click();
  await page.locator(".stage-canvas>canvas").waitFor();
  await b("Stage scene 3D").click();
  await b("Select New ring").click();
  await page.getByLabel("Layer plane", { exact: true }).selectOption("ground");
  await b("Select New particles").click();
  await page
    .getByLabel("Layer plane", { exact: true })
    .selectOption("billboard");
  await field("Plane position Y", "16");
  await page.getByRole("button", { name: "Iso", exact: false }).click();
  await b("Frame all").click();
  await shot("stage-scene.png");
  await b("Use view for export").click();
  await page.getByAltText("Exact camera output preview").waitFor();
  await shot("stage-camera.png");
  const wait = page.waitForEvent("download");
  await b("Export stage").click();
  const data = await readFile(await (await wait).path());
  await writeFile(join(out, "camera-export.zip"), data);
  const files = unzipSync(data);
  await mkdir(join(out, "camera-export"));
  for (const [name, bytes] of Object.entries(files))
    await writeFile(join(out, "camera-export", name), bytes);
  await b("Close dialog").click();
  const projectWait = page.waitForEvent("download");
  await b("Project menu").click();
  await page
    .getByRole("menuitem", { name: "Download project", exact: true })
    .click();
  const project = await readFile(await (await projectWait).path());
  await writeFile(join(out, "tour.vfx.json"), project);
  if (errors.length) throw Error(errors.join("\n"));
  const manifest = {
    version: VERSION,
    workflow:
      "empty project -> Add Ring/Number/Outline/Particles -> Set Arc=270 -> 3D planes -> scene framing -> explicit camera alignment -> GIF download",
    projectSha256: createHash("sha256").update(project).digest("hex"),
    gifSha256: createHash("sha256")
      .update(files["animation.gif"])
      .digest("hex"),
    pageErrors: errors,
  };
  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(JSON.stringify(manifest));
} finally {
  await browser.close();
  child.kill("SIGTERM");
}

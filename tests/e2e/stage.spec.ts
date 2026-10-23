import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate";
import { PNG } from "pngjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  getPreset,
  stageDefaults,
  type Project,
} from "../../src/core/index.js";
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
async function start(p: Page) {
  await p.goto("/");
  await button(p, "Pause").click();
  await p.getByLabel("Playhead", { exact: true }).fill("0.4");
  await expect(p.locator(".pixi-host canvas")).toBeVisible();
}
async function source(p: Page): Promise<Project> {
  const wait = p.waitForEvent("download");
  await button(p, "Project menu").click();
  await p
    .getByRole("menuitem", { name: "Download project", exact: true })
    .click();
  return JSON.parse(await readFile((await (await wait).path())!, "utf8"));
}
async function field(p: Page, name: string, value: string) {
  const e = p.getByLabel(name, { exact: true });
  await e.fill(value);
  await e.blur();
}

test("the 2D workspace stays simple while camera orbit, 3D plane placement and save/undo work in a separate stage", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const before = await source(page);
  await button(page, "2.5D / 3D").click();
  await expect(page.locator(".stage-canvas canvas")).toBeVisible();
  await button(page, "3D · free camera").click();
  await page.getByText("Place a layer", { exact: true }).click();
  await page.getByLabel("Stage layer").selectOption("cut-a");
  await page.getByLabel("Layer plane").selectOption("upright");
  await field(page, "Plane position Z", "24");
  const view = page.getByLabel("Stage camera viewport"),
    box = (await view.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 25,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.getByText("Advanced camera", { exact: true }).click();
  await button(page, "Undo stage edit").click();
  await expect(page.getByLabel("Camera azimuth", { exact: true })).toHaveValue(
    "25",
  );
  await button(page, "Redo stage edit").click();
  await expect(page.getByLabel("Camera azimuth", { exact: true })).toHaveValue(
    "-5",
  );
  await page.getByText("Advanced camera", { exact: true }).click();
  await page.screenshot({ path: info.outputPath("stage-perspective.png") });
  await button(page, "Close dialog").click();
  const after = await source(page);
  expect(after.layers).toEqual(before.layers);
  expect(after.stage?.mode).toBe("3d");
  expect(after.stage?.layers["cut-a"].position.z).toBe(24);
  expect(after.stage?.azimuth).toBeCloseTo(-5, 1);
  await button(page, "Undo").click();
  expect((await source(page)).stage?.azimuth).toBe(25);
  await page.reload();
  expect((await source(page)).stage?.layers["cut-a"].position.z).toBe(24);
  await page
    .locator(".timeline-row > button")
    .filter({ hasText: "First slash" })
    .click();
  await page.keyboard.press("Control+d");
  const copied = await source(page),
    copy = copied.layers.find(
      (l) => !before.layers.some((b) => b.id === l.id),
    )!;
  expect(copied.stage?.layers[copy.id]).toEqual(copied.stage?.layers["cut-a"]);
  await page.keyboard.press("Delete");
  expect((await source(page)).stage?.layers[copy.id]).toBeUndefined();
  expect(errors).toEqual([]);
});

test("stage export uses the same projected pixels as preview and the 2D export stays identical", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const p = getPreset("heal_pulse"),
    staged = { ...p, stage: stageDefaults() };
  const output = await page.evaluate(
    async ({ p, staged }) => ({
      flat: await window.vfx.preview(p, 0.3),
      flatAfter: await window.vfx.preview(staged, 0.3),
      stage: await window.vfx.preview(staged, 0.3, "stage"),
      files: await window.vfx.export(staged, {
        view: "stage",
        format: "sequence",
        fps: 10,
        start: 0.3,
        end: 0.4,
      }),
    }),
    { p, staged },
  );
  expect(output.flat).toBe(output.flatAfter);
  expect(output.stage).not.toBe(output.flat);
  const png = PNG.sync.read(Buffer.from(output.stage, "base64"));
  expect(png.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  const frame = Object.keys(output.files).find((key) => key.endsWith(".png"))!;
  expect(
    PNG.sync.read(Buffer.from(output.files[frame], "base64")).data,
  ).toEqual(png.data);
  const meta = JSON.parse(
    Buffer.from(output.files["metadata.json"], "base64").toString(),
  );
  expect(meta.view).toBe("stage");
  expect(meta.renderer).toBe("three-stage-pixi-planes");
  const qa = await page.evaluate(
    async (p) =>
      JSON.parse(
        atob(
          (
            await window.vfx.analyze(p, {
              view: "stage",
              times: [0.15, 0.3, 0.5],
            })
          )["analysis.json"],
        ),
      ),
    staged,
  );
  expect(qa.parity.passed).toBe(true);
});

test("stage GIF download is camera-baked, cancels safely and its controls fit at 390px", async ({
  page,
}, info) => {
  await start(page);
  await button(page, "2.5D / 3D").click();
  await expect(page.locator(".stage-canvas canvas")).toBeVisible();
  await page.getByLabel("Stage grid & axes").uncheck();
  const wait = page.waitForEvent("download");
  await button(page, "Export stage").click();
  const files = unzipSync(await readFile((await (await wait).path())!));
  expect(files["animation.gif"].length).toBeGreaterThan(100);
  expect(JSON.parse(Buffer.from(files["metadata.json"]).toString()).view).toBe(
    "stage",
  );
  await button(page, "Export stage").click();
  await button(page, "Cancel stage export").click();
  await expect(
    page.getByText("Stage export cancelled.", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(button(page, "Export stage")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: info.outputPath("stage-390.png") });
});

test("MCP discovers and authors the saved stage, returns projected images, verifies parity and exports it", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vfx-stage-ไทย ")),
    client = new Client({ name: "stage-agent", version: "1" }),
    entry = process.env.VFX_TEST_BIN_DIR
      ? join(process.env.VFX_TEST_BIN_DIR, "vfx-mcp")
      : resolve("dist/mcp.js");
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entry, "--root", root],
        cwd: root,
        stderr: "pipe",
      }),
    );
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r)).not.toBe(true);
      return r.structuredContent as Record<string, any>;
    };
    await call("new_project", { file: "stage.json", preset: "heal_pulse" });
    const initial = await call("get_stage", { file: "stage.json" });
    expect(initial.configured).toBe(false);
    const edits = [
      {
        action: "configure_stage",
        patch: {
          mode: "3d",
          projection: "perspective",
          azimuth: 15,
          elevation: 25,
        },
      },
      {
        action: "place_stage_layer",
        id: initial.layers[0].id,
        patch: { position: { y: 12, z: 20 }, plane: "ground" },
      },
    ];
    const bytes = await readFile(join(root, "stage.json"), "utf8");
    const draft = await call("render_preview", {
      file: "stage.json",
      revision: initial.revision,
      edits,
      time: 0.3,
      view: "stage",
    });
    expect(draft.draft).toBe(true);
    expect(await readFile(join(root, "stage.json"), "utf8")).toBe(bytes);
    const saved = await call("apply_edits", {
      file: "stage.json",
      revision: initial.revision,
      edits,
    });
    const image = await call("render_preview", {
      file: "stage.json",
      time: 0.3,
      view: "stage",
    });
    expect(image.view).toBe("stage");
    expect(image.images[0].sha256).toBe(draft.images[0].sha256);
    expect(image.pixels.visiblePixels).toBeGreaterThan(0);
    const job = await call("start_export", {
      file: "stage.json",
      revision: saved.revision,
      out: "camera-gif",
      options: { view: "stage", format: "gif", fps: 6 },
    });
    for (let i = 0; ; i++) {
      if (i > 300) throw Error("Stage export did not finish");
      const status = await call("get_export_job", { id: job.id });
      if (["succeeded", "failed", "cancelled"].includes(status.status)) {
        expect(status.status).toBe("succeeded");
        break;
      }
      await new Promise((done) => setTimeout(done, 20));
    }
    expect(
      JSON.parse(
        await readFile(join(root, "camera-gif", "metadata.json"), "utf8"),
      ).view,
    ).toBe("stage");
    const qa = await call("analyze_project", {
      file: "stage.json",
      view: "stage",
      times: [0.2, 0.3],
      out: "stage-baseline.json",
    });
    expect(qa.ok).toBe(true);
    expect(qa.view).toBe("stage");
    expect(qa.parity.passed).toBe(true);
    const flat = await call("analyze_project", {
      file: "stage.json",
      view: "effect",
      baseline: "stage-baseline.json",
    });
    expect(flat.ok).toBe(false);
    expect(flat.baseline.viewMatch).toBe(false);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  getPreset,
  parseProject,
  stageDefaults,
  type Project,
} from "../../src/core/index.js";
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
async function start(p: Page, project?: Project) {
  await p.goto("/");
  await button(p, "Pause").click();
  if (project)
    await p
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "workspace.vfx.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(project)),
      });
  await p.getByLabel("Playhead", { exact: true }).fill("0.3");
}
async function source(p: Page): Promise<Project> {
  const wait = p.waitForEvent("download");
  await button(p, "Project menu").click();
  await p
    .getByRole("menuitem", { name: "Download project", exact: true })
    .click();
  return JSON.parse(await readFile((await (await wait).path())!, "utf8"));
}
async function add(p: Page, key: string) {
  await button(p, "Add node").click();
  await p.locator(`[data-node="${key}"]`).click();
}
async function field(p: Page, label: string, value: string) {
  await p.getByLabel(label, { exact: true }).fill(value);
  await p.getByLabel(label, { exact: true }).blur();
}
// Read the actual rendered gizmo to choose a visible colored handle; all manipulation is pointer input.
async function handle(p: Page, color: "red" | "blue", ring = false) {
  const canvas = p.locator(".stage-canvas>canvas"),
    box = (await canvas.boundingBox())!,
    png = PNG.sync.read(await canvas.screenshot());
  const points: { x: number; y: number; radius: number }[] = [];
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4,
        r = png.data[i],
        g = png.data[i + 1],
        b = png.data[i + 2],
        dx = x - png.width / 2,
        dy = y - png.height / 2,
        radius = Math.hypot(dx, dy);
      if (
        radius < 35 ||
        radius > 130 ||
        dx < 10 ||
        (!ring && Math.abs(dy) > 7) ||
        (ring && (dy > -20 || dx < 20))
      )
        continue;
      if (
        color === "red"
          ? r > 190 && g < 60 && b < 70
          : b > 190 && r < 60 && g < 70
      )
        points.push({ x, y, radius });
    }
  expect(points.length, "visible transform handle pixels").toBeGreaterThan(0);
  points.sort((a, b) => (ring ? b.x - a.x : b.radius - a.radius));
  const point = points[Math.min(3, points.length - 1)];
  return {
    x: box.x + point.x,
    y: box.y + point.y,
    cx: box.x + png.width / 2,
    cy: box.y + png.height / 2,
  };
}
function ringProject() {
  const p = getPreset("heal_pulse");
  p.layers = p.layers.filter((l) => l.type === "ring").slice(0, 1);
  p.layers[0].position = { x: 64, y: 64 };
  p.layers[0].modifiers = [];
  p.controls = [];
  p.stage = {
    ...stageDefaults("3d"),
    projection: "orthographic",
    azimuth: 0,
    elevation: 0,
    span: 128,
  };
  return parseProject(p);
}

test("Stage uses real gizmos for translation, rotation and nonuniform scale, with cancel/undo and alpha picking", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const p = ringProject();
  await start(page, p);
  await button(page, "2.5D / 3D").click();
  await expect(page.locator(".stage-canvas>canvas")).toBeVisible();
  await button(page, "Stage move tool").click();
  let h = await handle(page, "red");
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 85, h.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(
        await page.getByLabel("Plane position X", { exact: true }).inputValue(),
      ),
    )
    .toBeGreaterThan(8);
  await button(page, "Undo stage edit").click();
  await expect(
    page.getByLabel("Plane position X", { exact: true }),
  ).toHaveValue("0");
  h = await handle(page, "red");
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 65, h.y, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(
    page.getByLabel("Plane position X", { exact: true }),
  ).toHaveValue("0");
  await expect(
    page.getByRole("dialog", { name: "2.5D / 3D Stage", exact: true }),
  ).toBeVisible();
  await button(page, "Stage rotate tool").click();
  h = await handle(page, "blue", true);
  const radius = Math.hypot(h.x - h.cx, h.y - h.cy),
    angle = Math.atan2(h.y - h.cy, h.x - h.cx);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(
      h.cx + Math.cos(angle + (i * Math.PI) / 36) * radius,
      h.cy + Math.sin(angle + (i * Math.PI) / 36) * radius,
    );
  await page.mouse.up();
  expect(
    Math.abs(
      Number(
        await page.getByLabel("Plane rotation Z", { exact: true }).inputValue(),
      ),
    ),
  ).toBeGreaterThan(10);
  await button(page, "Undo stage edit").click();
  await button(page, "Stage scale tool").click();
  h = await handle(page, "red");
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 65, h.y, { steps: 12 });
  await page.mouse.up();
  expect(
    Number(
      await page.getByLabel("Plane stretch X", { exact: true }).inputValue(),
    ),
  ).toBeGreaterThan(1.2);
  expect(
    Number(
      await page.getByLabel("Plane stretch Y", { exact: true }).inputValue(),
    ),
  ).toBeCloseTo(1, 2);
  await button(page, "+ Add layer").click();
  await page.locator('[data-node="layer:ring"]').click();
  await button(page, "Hide New ring").click();
  const canvas = page.locator(".stage-canvas>canvas"),
    box = (await canvas.boundingBox())!,
    png = PNG.sync.read(await canvas.screenshot());
  let pick: { x: number; y: number } | undefined;
  for (let y = 0; y < png.height && !pick; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      if (
        png.data[i + 1] > 120 &&
        png.data[i + 1] > png.data[i] * 1.3 &&
        png.data[i + 1] > png.data[i + 2] * 1.1
      ) {
        pick = { x, y };
        break;
      }
    }
  expect(pick, "visible ring pixel to select").toBeDefined();
  await page.mouse.click(box.x + pick!.x, box.y + pick!.y);
  await expect(page.locator(".stage-settings>h3")).toHaveText(p.layers[0].name);
  await button(page, "Select New ring").click();
  await page
    .locator(".stage-outliner")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page.screenshot({ path: info.outputPath("gizmo-scale.png") });
  await button(page, "Close dialog").click();
  const saved = await source(page);
  expect(saved.layers).toEqual(p.layers);
  expect(saved.stage?.layers[p.layers[0].id].stretch.x).toBeGreaterThan(1.2);
  expect(errors).toEqual([]);
});

test("Blueprint builds an effect from an empty project using searchable Add, modifier editing, duplicate and undo", async ({
  page,
}, info) => {
  const p = getPreset();
  p.layers = [];
  p.controls = [];
  p.groups = [];
  p.assets = [];
  await start(page, p);
  await button(page, "Blueprint").click();
  await expect(button(page, "Add node")).toBeVisible();
  await page.keyboard.press("Shift+a");
  await expect(page.getByLabel("Search nodes")).toBeFocused();
  await page.getByLabel("Search nodes").fill("Ring");
  await page.keyboard.press("Enter");
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "New ring" }),
  ).toHaveCount(1);
  await add(page, "modifier:outline");
  await expect(
    page.getByLabel("Outline Thickness", { exact: true }),
  ).toBeVisible();
  await field(page, "Outline Thickness", "3");
  await add(page, "control:number");
  await expect(
    page.getByLabel("Node New control", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Shift+d");
  await expect(
    page.getByLabel("Node New control copy", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(
    page.getByLabel("Node New control copy", { exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".blueprint-toolbar")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(
    page.getByLabel("Node New control copy", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("blueprint-built-from-empty.png"),
  });
  await button(page, "Close dialog").click();
  const saved = await source(page);
  expect(saved.layers).toHaveLength(1);
  expect(saved.layers[0].modifiers[0]).toMatchObject({
    type: "outline",
    thickness: 3,
  });
  expect(saved.controls).toHaveLength(2);
  await button(page, "Blueprint").click();
  await button(page, "Add node").click();
  await page.getByLabel("Search nodes").fill("Sprite");
  await expect(page.locator('[data-node="layer:sprite"]')).toBeDisabled();
  await expect(page.locator('[data-node="layer:sprite"]')).toContainText(
    "Import a PNG",
  );
});

test("MCP catalog supplies the same working Add operations, supports a draft and commits/export-verifies the result", async () => {
  const root = await mkdtemp(join(tmpdir(), "vfx-catalog-ไทย ")),
    client = new Client({ name: "catalog-author", version: "1" }),
    entry = process.env.VFX_TEST_BIN_DIR
      ? join(process.env.VFX_TEST_BIN_DIR, "vfx-mcp")
      : resolve("dist/mcp.js");
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    expect(r.isError, JSON.stringify(r)).not.toBe(true);
    return r.structuredContent as Record<string, any>;
  };
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entry, "--root", root],
        cwd: root,
        stderr: "pipe",
      }),
    );
    await call("new_project", {
      file: "effect.json",
      project: { name: "Catalog effect", duration: 1, fps: 12, layers: [] },
    });
    const catalog = await call("get_node_catalog", { file: "effect.json" }),
      ring = catalog.entries.find((e: any) => e.id === "layer:ring"),
      bytes = await readFile(join(root, "effect.json"), "utf8");
    const draft = await call("observe_project", {
      file: "effect.json",
      revision: catalog.revision,
      edits: [ring.edit],
      time: 0.3,
    });
    expect(draft.scene.frames[0].visiblePixels).toBeGreaterThan(0);
    expect(await readFile(join(root, "effect.json"), "utf8")).toBe(bytes);
    await call("apply_edits", {
      file: "effect.json",
      revision: catalog.revision,
      edits: [ring.edit],
    });
    const next = await call("get_node_catalog", {
        file: "effect.json",
        layer: ring.edit.layer.id,
      }),
      outline = next.entries.find((e: any) => e.id === "modifier:outline"),
      number = next.entries.find((e: any) => e.id === "control:number");
    const saved = await call("apply_edits", {
      file: "effect.json",
      revision: next.revision,
      edits: [
        outline.edit,
        number.edit,
        {
          action: "place_stage_layer",
          id: ring.edit.layer.id,
          patch: { plane: "upright", stretch: { x: 1.5, y: 0.75, z: 1 } },
        },
      ],
    });
    const image = await call("render_preview", {
      file: "effect.json",
      view: "stage",
      time: 0.3,
    });
    expect(image.pixels.visiblePixels).toBeGreaterThan(0);
    const qa = await call("analyze_project", {
      file: "effect.json",
      view: "stage",
      times: [0.2, 0.3, 0.4],
    });
    expect(qa.parity.passed).toBe(true);
    const job = await call("start_export", {
      file: "effect.json",
      revision: saved.revision,
      out: "gif",
      options: { view: "stage", format: "gif", fps: 6 },
    });
    for (let i = 0; ; i++) {
      if (i > 300) throw Error("Catalog export timed out");
      const state = await call("get_export_job", { id: job.id });
      if (["succeeded", "failed", "cancelled"].includes(state.status)) {
        expect(state.status, JSON.stringify(state)).toBe("succeeded");
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(
      (await readFile(join(root, "gif/animation.gif"))).length,
    ).toBeGreaterThan(100);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

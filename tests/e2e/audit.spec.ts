import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  parseProject,
  encodePng,
  starterLayer,
  applyEdits,
  type Project,
} from "../../src/core/index.js";
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
const open = async (p: Page, project: Project) =>
  p
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "audit.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
async function saved(p: Page): Promise<Project> {
  const event = p.waitForEvent("download");
  await button(p, "Project menu").click();
  await p
    .getByRole("menuitem", { name: "Download project", exact: true })
    .click();
  return JSON.parse(await readFile((await (await event).path())!, "utf8"));
}
function image() {
  const rgba = new Uint8ClampedArray(96 * 24 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([40, 190, 255, 255], i);
  return encodePng({ width: 96, height: 24, rgba });
}

test("2D Add uses the shared fitted generators for wide sprites and small canvases", async ({
  page,
}, info) => {
  await page.goto("/");
  await button(page, "Pause").click();
  const png = image();
  const project = parseProject({
    name: "Wide image audit",
    duration: 0.5,
    fps: 10,
    canvas: { width: 64, height: 64 },
    layers: [],
    assets: [
      {
        id: "wide",
        name: "Wide",
        data: "data:image/png;base64," + Buffer.from(png).toString("base64"),
        width: 96,
        height: 24,
      },
    ],
  });
  await open(page, project);
  await button(page, "Library").click();
  for (const [label, type] of [
    ["sprite", "sprite"],
    ["ring", "ring"],
    ["stroke", "path"],
    ["particles", "particles"],
    ["procedural texture", "field"],
  ] as const) {
    await button(page, "Add " + label).click();
    const p = await saved(page),
      l = p.layers.at(-1)!;
    expect(l).toEqual(
      starterLayer({ ...project, layers: p.layers.slice(0, -1) }, type, l.id),
    );
  }
  const p = await saved(page),
    sprite = p.layers.find((l) => l.type === "sprite")!;
  expect(
    sprite.type === "sprite" && sprite.width[0].value / sprite.height[0].value,
  ).toBe(4);
  await page.getByLabel("Playhead", { exact: true }).fill("0.2");
  await page.screenshot({ path: info.outputPath("fitted-generators.png") });
  await button(page, "Undo").click();
  expect((await saved(page)).layers).toHaveLength(4);
});

test("short windows and large text preserve a usable canvas and restore desktop layout preferences", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "vfx-maker.layout",
      JSON.stringify({
        left: 270,
        right: 326,
        timeline: 300,
        textScale: 1.3,
        leftOpen: true,
        rightOpen: true,
        timelineOpen: true,
      }),
    ),
  );
  await page.goto("/");
  await button(page, "Pause").click();
  await page.setViewportSize({ width: 1024, height: 600 });
  await expect(button(page, "Library")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(button(page, "Inspector")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(button(page, "Timeline")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect
    .poll(
      async () => (await page.locator(".canvas-stack").boundingBox())!.height,
    )
    .toBeGreaterThan(270);
  await page.getByText("View options", { exact: true }).click();
  await button(page, "Pixel grid").click();
  await page.getByText("View options", { exact: true }).click();
  await page.screenshot({ path: info.outputPath("short-large-text.png") });
  await button(page, "Focus timeline").click();
  await expect(page.locator(".viewport")).toBeHidden();
  await button(page, "Restore canvas").click();
  await expect(button(page, "Timeline")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await button(page, "Library").click();
  await expect(page.locator(".library")).toBeVisible();
  await button(page, "Library").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(button(page, "Library")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "Inspector")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(button(page, "Timeline")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("Interface text size").selectOption("1");
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(button(page, "Timeline")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect
    .poll(
      async () => (await page.locator(".canvas-stack").boundingBox())!.height,
    )
    .toBeGreaterThan(200);
  const preferences = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vfx-maker.layout")!),
  );
  expect(preferences).toMatchObject({
    leftOpen: true,
    rightOpen: true,
    timelineOpen: true,
    timeline: 300,
  });
});

test("saved Stage parts can be inserted twice through the UI with independent placements, names and camera", async ({
  page,
}) => {
  await page.goto("/");
  await button(page, "Pause").click();
  const base = parseProject({
    name: "Staged part audit",
    duration: 0.5,
    fps: 10,
    layers: [
      { id: "ring", name: "Ring", type: "ring", position: { x: 64, y: 64 } },
    ],
  });
  const project = applyEdits(base, [
    { action: "configure_stage", patch: { plane: "upright", azimuth: 20 } },
    {
      action: "place_stage_layer",
      id: "ring",
      patch: {
        position: { x: 12, y: 8, z: 24 },
        stretch: { x: 2, y: 0.5, z: 1 },
      },
    },
  ]);
  await open(page, project);
  await button(page, "Library").click();
  await button(page, "saved").click();
  await page.getByLabel("Component name").fill("Stage ring");
  await button(page, "Save selection (1)").click();
  await button(page, "Insert Stage ring").click();
  await button(page, "Insert Stage ring").click();
  const result = await saved(page);
  expect(result.layers.map((l) => l.name)).toEqual([
    "Ring",
    "Ring 2",
    "Ring 3",
  ]);
  for (const layer of result.layers)
    expect(result.stage?.layers[layer.id]).toEqual(project.stage?.layers.ring);
  expect(result.stage?.azimuth).toBe(20);
  await page.reload();
  expect((await saved(page)).stage).toEqual(result.stage);
});

test("MCP imports PNG and flipbook assets, optimizes, creates a fitted sprite and exports visible frames", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vfx-import-ไทย "));
  const client = new Client({ name: "asset-audit", version: "1" });
  const entry = process.env.VFX_TEST_BIN_DIR
    ? join(process.env.VFX_TEST_BIN_DIR, "vfx-mcp")
    : resolve("dist/mcp.js");
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    expect(r.isError, JSON.stringify(r.content)).not.toBe(true);
    return r.structuredContent as Record<string, any>;
  };
  try {
    await writeFile(join(root, "wide.png"), image());
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entry, "--root", root],
        cwd: root,
        stderr: "pipe",
      }),
    );
    let p = await call("new_project", {
      file: "effect.json",
      project: { name: "MCP image audit", duration: 0.3, fps: 10, layers: [] },
    });
    p = await call("import_asset", {
      file: "effect.json",
      revision: p.revision,
      png: "wide.png",
      id: "image",
    });
    expect(p.project.assets[0]).toMatchObject({
      width: 96,
      height: 24,
      columns: 1,
      rows: 1,
      frames: 1,
    });
    p = await call("import_asset", {
      file: "effect.json",
      revision: p.revision,
      png: "wide.png",
      id: "flipbook",
      columns: 4,
      rows: 1,
      frames: 4,
    });
    p = await call("optimize_asset", {
      file: "effect.json",
      revision: p.revision,
      id: "image",
      options: { scale: 0.5, colors: 4 },
    });
    expect(p.project.assets[0]).toMatchObject({ width: 48, height: 12 });
    const c = await call("get_node_catalog", { file: "effect.json" }),
      sprite = c.entries.find((e: any) => e.id === "layer:sprite");
    p = await call("apply_edits", {
      file: "effect.json",
      revision: c.revision,
      edits: [sprite.edit],
    });
    expect(
      sprite.edit.layer.width[0].value / sprite.edit.layer.height[0].value,
    ).toBe(4);
    const img = await call("render_preview", {
      file: "effect.json",
      time: 0.1,
    });
    expect(img.pixels.visiblePixels).toBeGreaterThan(0);
    const qa = await call("analyze_project", {
      file: "effect.json",
      times: [0, 0.1, 0.2],
    });
    expect(qa.ok).toBe(true);
    await call("export", {
      file: "effect.json",
      revision: p.revision,
      out: "frames",
      options: { format: "sequence", scale: 1 },
    });
    expect(
      JSON.parse(await readFile(join(root, "frames/metadata.json"), "utf8"))
        .frames,
    ).toHaveLength(3);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

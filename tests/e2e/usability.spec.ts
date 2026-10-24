import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveControls, type Project } from "../../src/core/index.js";
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
async function start(p: Page) {
  await p.goto("/");
  await button(p, "Pause").click();
  await p.getByLabel("Playhead", { exact: true }).fill("0.4");
  await expect(p.locator(".pixi-host canvas")).toBeVisible();
}
async function snapshot(p: Page): Promise<Project> {
  const download = p.waitForEvent("download");
  await button(p, "Project menu").click();
  await p
    .getByRole("menuitem", { name: "Download project", exact: true })
    .click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}
async function drag(p: Page, target: Locator, dx: number, dy: number) {
  const b = (await target.boundingBox())!;
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
    steps: 8,
  });
  await p.mouse.up();
}
async function slash(p: Page) {
  await p
    .locator(".timeline-row > button")
    .filter({ hasText: "First slash" })
    .click();
}
async function field(p: Page, name: string, value: string) {
  await p.getByLabel(name, { exact: true }).fill(value);
  await p.getByLabel(name, { exact: true }).blur();
}

test("starts with a larger canvas, folds optional controls and persists readable text sizes", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1917, height: 963 });
  await start(page);
  await expect(button(page, "Library")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator(".effect-controls")).not.toHaveAttribute("open");
  const canvas = (await page.locator(".canvas-stack").boundingBox())!;
  expect(canvas.height).toBeGreaterThan(470);
  expect(canvas.width).toBeGreaterThan(470);
  expect(
    await button(page, "Rotate tool").evaluate((e) =>
      Number.parseFloat(getComputedStyle(e).fontSize),
    ),
  ).toBeGreaterThanOrEqual(12);
  expect(
    (await button(page, "Rotate tool").boundingBox())!.height,
  ).toBeGreaterThanOrEqual(32);
  await page.getByLabel("Interface text size").selectOption("1.3");
  await expect
    .poll(() =>
      button(page, "Rotate tool").evaluate((e) =>
        Number.parseFloat(getComputedStyle(e).fontSize),
      ),
    )
    .toBeGreaterThan(15);
  await page.screenshot({ path: info.outputPath("comfortable-canvas.png") });
  await page.reload();
  await expect(page.getByLabel("Interface text size")).toHaveValue("1.3");
  await page.setViewportSize({ width: 390, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});

test("resizes the timeline beyond 400px, zooms time, scrolls clips and restores canvas", async ({
  page,
}, info) => {
  await start(page);
  const separator = page.getByRole("separator", { name: "Resize timeline" });
  await drag(page, separator, 0, -270);
  expect(
    (await page.locator(".timeline").boundingBox())!.height,
  ).toBeGreaterThan(450);
  await button(page, "Zoom timeline in").click();
  await button(page, "Zoom timeline in").click();
  const scroller = page.locator(".timeline-scroll");
  expect(
    await scroller.evaluate((e) => e.scrollWidth / e.clientWidth),
  ).toBeGreaterThan(3.9);
  await scroller.evaluate((e) => {
    e.scrollLeft = e.scrollWidth;
  });
  expect(await scroller.evaluate((e) => e.scrollLeft)).toBeGreaterThan(100);
  await button(page, "Fit timeline").click();
  expect(await scroller.evaluate((e) => e.scrollLeft)).toBe(0);
  await button(page, "Focus timeline").click();
  await expect(page.locator(".viewport")).toBeHidden();
  await page.screenshot({ path: info.outputPath("expanded-timeline.png") });
  await button(page, "Restore canvas").click();
  await expect(page.locator(".viewport")).toBeVisible();
});

test("rotates and scales a stroke on canvas with a single undo, cancellation and stable pixels", async ({
  page,
}, info) => {
  await start(page);
  await slash(page);
  const before = await snapshot(page);
  await button(page, "Rotate tool").click();
  await drag(
    page,
    page.getByLabel("Drag layer rotation", { exact: true }),
    0,
    116,
  );
  const rotated = await snapshot(page);
  expect(rotated.layers[0].rotation).toBeCloseTo(
    before.layers[0].rotation + 90,
    0,
  );
  await button(page, "Undo").click();
  expect((await snapshot(page)).layers).toEqual(before.layers);
  await button(page, "Scale tool").click();
  await drag(
    page,
    page.getByLabel("Drag layer scale", { exact: true }),
    29,
    -29,
  );
  const scaled = await snapshot(page);
  expect(scaled.layers[0].scale).toBeCloseTo(before.layers[0].scale * 1.5, 1);
  await button(page, "Undo").click();
  expect((await snapshot(page)).layers).toEqual(before.layers);
  const handle = page.getByLabel("Drag layer scale", { exact: true }),
    b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 70, b.y - 50);
  await handle.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  expect((await snapshot(page)).layers).toEqual(before.layers);
  await page.screenshot({ path: info.outputPath("canvas-scale-handle.png") });
});

test("draws a pen path, inserts/deletes/smooths anchors, and drags an Inspector curve", async ({
  page,
}, info) => {
  await start(page);
  const before = await snapshot(page);
  await button(page, "Pen stroke").click();
  const surface = page.getByLabel("Pen drawing surface"),
    b = (await surface.boundingBox())!;
  for (const [x, y] of [
    [0.2, 0.7],
    [0.5, 0.25],
    [0.8, 0.6],
  ])
    await page.mouse.click(b.x + b.width * x, b.y + b.height * y);
  await page.keyboard.press("Enter");
  let p = await snapshot(page);
  expect(p.layers).toHaveLength(before.layers.length + 1);
  const path = p.layers.at(-1)!;
  if (path.type !== "path") throw Error("Expected path");
  expect(path.points).toHaveLength(3);
  await button(page, "Points tool").click();
  await button(page, "Insert point").click();
  p = await snapshot(page);
  expect((p.layers.at(-1) as typeof path).points).toHaveLength(4);
  await button(page, "Smooth point").click();
  p = await snapshot(page);
  expect((p.layers.at(-1) as typeof path).handles).toHaveLength(4);
  await button(page, "Delete point").click();
  p = await snapshot(page);
  expect((p.layers.at(-1) as typeof path).handles).toHaveLength(3);
  await field(page, "Point X", "-24");
  expect((await snapshot(page)).layers.at(-1)).toMatchObject({
    points: expect.arrayContaining([{ x: -24, y: expect.any(Number) }]),
  });
  await page.getByText("Stroke", { exact: true }).click();
  const key = page.getByLabel("Width curve key 2", { exact: true });
  await key.scrollIntoViewIfNeeded();
  const prior = await snapshot(page);
  await drag(page, key, 12, -16);
  const changed = await snapshot(page);
  expect((changed.layers.at(-1) as typeof path).width).not.toEqual(
    (prior.layers.at(-1) as typeof path).width,
  );
  await button(page, "Undo").click();
  expect((await snapshot(page)).layers).toEqual(prior.layers);
  await page.screenshot({
    path: info.outputPath("editable-path-and-curve.png"),
  });
});

test("Blueprint wires a control through real ports, edits the wire, saves positions and shares renderer state", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const before = await snapshot(page);
  await button(page, "Blueprint").click();
  await page
    .locator(".blueprint-properties > details")
    .filter({ has: page.getByText("Connect parameters", { exact: true }) })
    .evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
  await page
    .getByLabel("Blueprint layer", { exact: true })
    .selectOption("cut-a");
  await button(page, "Add node").click();
  await page.locator('[data-node="control:number"]').click();
  await page.getByRole("button", { name: "Fit nodes", exact: true }).click();
  // Newly created Number control appears in the form and can also be wired by drag.
  const sourceId = await page.getByLabel("Blueprint control").inputValue();
  const node = page
    .locator(".react-flow__node")
    .filter({ has: page.getByLabel("Node New control", { exact: true }) });
  const out = node.locator('[data-handleid="value"]'),
    target = page.locator('[data-id="layer:cut-a"] [data-handleid="rotation"]');
  await expect(out).toBeVisible();
  await expect(target).toBeVisible();
  await expect(
    page.getByLabel("Blueprint node graph", { exact: true }),
  ).toHaveAttribute("aria-busy", "false");
  const a = (await out.boundingBox())!,
    b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  const wire = page.locator(
    `.react-flow__edge[data-id="binding:${sourceId}:0"] .react-flow__edge-interaction`,
  );
  await expect(wire).toHaveCount(1);
  await field(page, "Node New control", "1.5");
  await wire.click({ force: true });
  await expect(page.getByLabel("Connection mode")).toBeVisible();
  await page.getByLabel("Connection mode").selectOption("add");
  await field(page, "Connection factor", "20");
  await node.locator("header").click();
  await drag(page, node.locator("header"), 35, 45);
  await page.screenshot({ path: info.outputPath("blueprint-wired.png") });
  await button(page, "Close dialog").click();
  const after = await snapshot(page);
  expect(after.controls.find((c) => c.id === sourceId)?.bindings).toMatchObject(
    [{ layer: "cut-a", target: "rotation", mode: "add", factor: 20 }],
  );
  expect(resolveControls(after).layers[0].rotation).toBe(
    before.layers[0].rotation + 30,
  );
  expect(after.editor.blueprint?.[`control:${sourceId}`]).toBeDefined();
  await page.reload();
  expect((await snapshot(page)).editor.blueprint).toEqual(
    after.editor.blueprint,
  );
  expect(errors).toEqual([]);
});

test("Blueprint and transform tools remain reachable at 390px with large text", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await start(page);
  await page.getByLabel("Interface text size").selectOption("1.3");
  await button(page, "Blueprint").click();
  await expect(page.getByLabel("Blueprint node graph")).toBeVisible();
  if (!(await page.locator(".blueprint-sidebar").count()))
    await button(page, "Properties").click();
  await page
    .locator(".blueprint-properties > details")
    .filter({ has: page.getByText("Connect parameters", { exact: true }) })
    .evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
  await page
    .getByLabel("Blueprint layer", { exact: true })
    .selectOption("cut-a");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: info.outputPath("blueprint-390.png") });
  await button(page, "Close dialog").click();
  await button(page, "Rotate tool").click();
  await expect(button(page, "Rotate tool")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("AI agent discovers Blueprint, previews atomic graph edits, commits identical pixels and runs numeric QA through stdio MCP", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vfx-blueprint-ไทย ")),
    client = new Client({ name: "blueprint-agent", version: "1" }),
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
    await call("new_project", { file: "agent.json", preset: "blue_magic" });
    const graph = await call("get_blueprint", { file: "agent.json" }),
      id = graph.layers.find((l: any) => !l.locked).id;
    expect(graph.layers[0].inputs.some((p: any) => p.path === "rotation")).toBe(
      true,
    );
    const source = await readFile(join(root, "agent.json"), "utf8");
    const edits = [
      {
        action: "creative",
        operation: {
          action: "put_control",
          control: {
            id: "turn",
            name: "Turn",
            min: -180,
            max: 180,
            value: 45,
            step: 1,
            bindings: [],
          },
        },
      },
      {
        action: "connect_control",
        control: "turn",
        layer: id,
        target: "rotation",
        mode: "add",
      },
      { action: "set_gradient", colors: "#8b5dff" },
    ];
    const dry = await call("apply_edits", {
      file: "agent.json",
      revision: graph.revision,
      edits,
      dryRun: true,
    });
    expect(await readFile(join(root, "agent.json"), "utf8")).toBe(source);
    expect(dry.proposedRevision).toBeTruthy();
    const draft = await call("observe_project", {
      file: "agent.json",
      revision: graph.revision,
      edits,
      time: 0.3,
    });
    expect(draft.draft).toBeTruthy();
    const written = await call("apply_edits", {
      file: "agent.json",
      revision: graph.revision,
      edits,
    });
    const saved = await call("observe_project", {
      file: "agent.json",
      time: 0.3,
    });
    const clean = (reply: any) =>
      reply.images
        .filter((im: any) => im.role === "frame")
        .map((im: any) => im.sha256);
    expect(clean(draft).length).toBeGreaterThan(0);
    expect(clean(saved)).toEqual(clean(draft));
    const graphAfter = await call("get_blueprint", { file: "agent.json" });
    expect(graphAfter.revision).toBe(written.revision);
    expect(
      graphAfter.connections.find((c: any) => c.control === "turn"),
    ).toMatchObject({
      layer: id,
      target: "rotation",
      mode: "add",
      editable: true,
    });
    const qa = await call("analyze_project", {
      file: "agent.json",
      times: [0.15, 0.3, 0.5],
      out: "baseline.json",
    });
    expect(qa.ok).toBe(true);
    expect(qa.parity.passed).toBe(true);
    const regression = await call("analyze_project", {
      file: "agent.json",
      baseline: "baseline.json",
    });
    expect(regression.baseline.passed).toBe(true);
    const stale = await client.callTool({
      name: "apply_edits",
      arguments: { file: "agent.json", revision: graph.revision, edits },
    });
    expect(stale.isError).toBe(true);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Focus canvas expands the drawing area without changing the project, including short windows", async ({
  page,
}, info) => {
  await start(page);
  const before = await snapshot(page),
    initial = (await page.locator(".canvas-stack").boundingBox())!.height;
  await button(page, "Focus canvas").click();
  expect(
    (await page.locator(".canvas-stack").boundingBox())!.height,
  ).toBeGreaterThan(initial + 150);
  await expect(page.locator(".timeline")).toBeHidden();
  await expect(page.locator(".inspector-panel")).toBeHidden();
  expect((await snapshot(page)).layers).toEqual(before.layers);
  await page.setViewportSize({ width: 640, height: 360 });
  const area = (await page.locator(".viewport-area").boundingBox())!,
    canvas = (await page.locator(".canvas-stack").boundingBox())!;
  expect(canvas.height).toBeGreaterThan(100);
  expect(canvas.height).toBeLessThanOrEqual(area.height);
  await page.screenshot({ path: info.outputPath("focus-canvas-short.png") });
  await button(page, "Restore panels").click();
  await button(page, "Focus timeline").click();
  await expect(page.locator(".viewport")).toBeHidden();
  await button(page, "Restore canvas").click();
  await expect(page.locator(".viewport")).toBeVisible();
});

test("canvas rotation transforms multiple selected layers together and undo restores all geometry", async ({
  page,
}) => {
  await start(page);
  await page
    .locator(".timeline-row > button")
    .filter({ hasText: "First slash" })
    .click();
  await page
    .locator(".timeline-row > button")
    .filter({ hasText: "Second slash" })
    .click({ modifiers: ["Control"] });
  const before = await snapshot(page);
  await button(page, "Rotate tool").click();
  await drag(
    page,
    page.getByLabel("Drag layer rotation", { exact: true }),
    0,
    116,
  );
  const after = await snapshot(page);
  for (const id of ["cut-a", "cut-b"])
    expect(after.layers.find((l) => l.id === id)!.rotation).toBeCloseTo(
      before.layers.find((l) => l.id === id)!.rotation + 90,
      0,
    );
  expect(after.layers.slice(2)).toEqual(before.layers.slice(2));
  await button(page, "Undo").click();
  expect((await snapshot(page)).layers).toEqual(before.layers);
});

test("an invalid macro-driven scale draft keeps the editor alive and preserves the document", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await slash(page);
  await page.locator(".effect-controls > summary").click();
  await page.getByLabel("Control Size", { exact: true }).focus();
  await page.keyboard.press("End");
  const before = await snapshot(page);
  await button(page, "Scale tool").click();
  const handle = page.getByLabel("Drag layer scale", { exact: true }),
    b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 500, b.y + b.height / 2, {
    steps: 8,
  });
  await expect(page.locator(".viewport-draft-error")).toBeVisible();
  await expect(page.locator(".pixi-host canvas")).toBeVisible();
  await page.mouse.up();
  const after = await snapshot(page);
  expect(after.layers).toEqual(before.layers);
  expect(after.controls).toEqual(before.controls);
  expect(errors).toEqual([]);
});

import { test, expect, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  defineEffect,
  ring,
  curve,
  getPreset,
  type Project,
} from "../../src/core/index.js";
const exec = promisify(execFile),
  repo = resolve("."),
  entry = (name: string) =>
    process.env.VFX_TEST_BIN_DIR
      ? join(process.env.VFX_TEST_BIN_DIR, name)
      : join(repo, name === "vfx" ? "dist/cli.js" : "dist/mcp.js");
async function session() {
  const root = await mkdtemp(join(tmpdir(), "vfx-project-workflow-")),
    client = new Client({ name: "project-workflows", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [entry("vfx-mcp"), "--root", root],
      stderr: "pipe",
      cwd: root,
    }),
  );
  const raw = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await raw(name, args);
    expect(r.isError, JSON.stringify(r).slice(0, 2000)).not.toBe(true);
    return r.structuredContent as Record<string, any>;
  };
  const poll = async (id: string) => {
    for (let i = 0; i < 1000; i++) {
      const job = await call("get_export_job", { id });
      if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw Error("Job did not complete");
  };
  return {
    root,
    client,
    call,
    raw,
    poll,
    close: async () => {
      await client.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
const simple = () =>
  defineEffect({
    duration: 0.3,
    fps: 10,
    layers: [
      ring({
        id: "halo",
        name: "Halo",
        radius: curve(8, 30),
        opacity: curve(1),
        glow: { strength: 0, blur: 0 },
      }),
    ],
  });

test("MCP creates and exports 16 independent projects in one revisioned background batch", async () => {
  test.setTimeout(120000);
  const s = await session();
  try {
    const items = Array.from({ length: 16 }, (_, i) => ({
      action: "create",
      file: `p${i}.json`,
      project: { ...simple(), seed: i },
      edits: [
        { action: "set_gradient", colors: i % 2 ? "#804cff" : "#ff6633" },
      ],
      out: `out${i}`,
      options: { format: i % 2 ? "godot" : "sequence" },
    }));
    const dry = await s.call("batch_projects", { items, dryRun: true });
    expect(dry.ok).toBe(true);
    expect(await readdir(s.root)).toEqual([]);
    const begun = await s.call("batch_projects", { items });
    expect(begun.progressUnit).toBe("projects");
    const done = await s.poll(begun.id);
    expect(done.status).toBe("succeeded");
    expect(done.progressUnit).toBe("projects");
    expect(done.completed).toBe(16);
    expect(done.result.ok).toBe(true);
    for (let i = 0; i < 16; i++) {
      const p = JSON.parse(await readFile(join(s.root, `p${i}.json`), "utf8"));
      expect(p.layers[0].colors[0].color).toBe(i % 2 ? "#804cff" : "#ff6633");
      const meta = JSON.parse(
        await readFile(join(s.root, `out${i}/metadata.json`), "utf8"),
      );
      expect(meta.frames).toHaveLength(3);
    }
    const cap = await s.call("capabilities");
    expect(cap.renderer.launches).toBe(1);
    expect(cap.renderer.reuses).toBeGreaterThanOrEqual(15);
    const before = await s.call("render_preview", {
      file: "p0.json",
      time: 0.1,
    });
    await s.call("render_preview", { file: "p1.json", time: 0.1 });
    const after = await s.call("render_preview", {
      file: "p0.json",
      time: 0.1,
    });
    expect(after.images[0].sha256).toBe(before.images[0].sha256);
  } finally {
    await s.close();
  }
});

test("MCP numeric QA detects a changed render against a saved baseline and keeps reverse-order parity", async () => {
  const s = await session();
  try {
    const a = await s.call("new_project", {
      file: "effect.json",
      project: simple(),
    });
    const first = await s.call("analyze_project", {
      file: "effect.json",
      revision: a.revision,
      out: "baseline.json",
    });
    expect(first.ok).toBe(true);
    expect(first.frames).toHaveLength(3);
    expect(first.parity).toMatchObject({
      checked: true,
      passed: true,
      order: "reverse",
    });
    expect(first.summary.peakAlphaMass).not.toBeNull();
    const repeat = await s.call("analyze_project", {
      file: "effect.json",
      baseline: "baseline.json",
    });
    expect(repeat.ok).toBe(true);
    expect(repeat.baseline.comparedFrames).toBe(3);
    const b = await s.call("set_gradient", {
      file: "effect.json",
      revision: a.revision,
      colors: "#3355ff",
    });
    const changed = await s.call("analyze_project", {
      file: "effect.json",
      revision: b.revision,
      baseline: "baseline.json",
    });
    expect(changed.ok).toBe(false);
    expect(changed.parity.passed).toBe(true);
    expect(changed.baseline.mismatches.length).toBeGreaterThan(0);
    const duplicate = await s.raw("analyze_project", {
      file: "effect.json",
      out: "baseline.json",
    });
    expect(duplicate.isError).toBe(true);
    expect((await s.call("capabilities")).renderer.launches).toBe(1);
  } finally {
    await s.close();
  }
});

test("concurrent renders are isolated and cancelling an export leaves the other worker usable", async () => {
  test.setTimeout(120000);
  const s = await session();
  try {
    const heavy = defineEffect({
      canvas: { width: 256, height: 256 },
      duration: 3,
      fps: 30,
      layers: Array.from({ length: 64 }, (_, i) =>
        ring({
          id: `r${i}`,
          name: `Halo ${i}`,
          position: { x: 12 + (i % 8) * 30, y: 12 + Math.floor(i / 8) * 30 },
          radius: curve(4, 12),
          width: curve(2),
          duration: 3,
          opacity: curve(1),
          glow: { strength: 0, blur: 0 },
        }),
      ),
    });
    const a = await s.call("new_project", { file: "a.json", project: heavy });
    await s.call("new_project", { file: "b.json", project: simple() });
    await s.call("render_preview", { file: "a.json", time: 0.2 });
    const job = await s.call("start_export", {
      file: "a.json",
      revision: a.revision,
      out: "cancelled",
      options: { format: "sequence" },
    });
    for (let i = 0; i < 100; i++) {
      const state = await s.call("get_export_job", { id: job.id });
      if (state.status === "running") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const [preview] = await Promise.all([
      s.call("render_preview", { file: "b.json", time: 0.1 }),
      s.call("cancel_export_job", { id: job.id }),
    ]);
    expect(preview.pixels.visiblePixels).toBeGreaterThan(0);
    expect((await s.poll(job.id)).status).toBe("cancelled");
    await expect(stat(join(s.root, "cancelled"))).rejects.toThrow();
    const before = await s.call("capabilities"),
      repeat = await s.call("render_preview", { file: "b.json", time: 0.1 });
    expect(repeat.images[0].sha256).toBe(preview.images[0].sha256);
    expect((await s.call("capabilities")).renderer.launches).toBe(
      before.renderer.launches,
    );
  } finally {
    await s.close();
  }
});

test("preflight gives numeric budgets without opening a browser and failed batch items remain explicit", async () => {
  const s = await session();
  try {
    const created = await s.call("new_project", {
      file: "large.json",
      project: defineEffect({
        canvas: { width: 512, height: 512 },
        duration: 1,
        fps: 10,
      }),
    });
    const flight = await s.call("preflight_export", {
      file: "large.json",
      options: { scale: 8 },
    });
    expect(flight.ok).toBe(false);
    expect(
      flight.checks.find((c: any) => c.resource === "imagePixels"),
    ).toMatchObject({ used: 16777216, limit: 4194304, passed: false });
    expect((await s.call("capabilities")).renderer.launches).toBe(0);
    const begun = await s.call("batch_projects", {
      items: [
        { action: "create", file: "valid.json", project: simple() },
        {
          action: "export",
          file: "large.json",
          revision: created.revision,
          out: "bad-output",
          options: { scale: 8 },
        },
        { action: "create", file: "../escape.json" },
      ],
    });
    const done = await s.poll(begun.id);
    expect(done.status).toBe("failed");
    expect(done.result.ok).toBe(false);
    expect(done.result.results.map((r: any) => r.status)).toEqual([
      "succeeded",
      "failed",
      "failed",
    ]);
    expect((await readdir(s.root)).sort()).toEqual([
      "large.json",
      "valid.json",
    ]);
  } finally {
    await s.close();
  }
});

test("active storyboard fills tiles with measured activity while timeline and explicit times retain blank intervals", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const p = getPreset();
  p.duration = 10;
  p.fps = 3;
  const read = async (options: Record<string, unknown>) => {
    const result = await page.evaluate(
      ({ p, options }) => window.vfx.observe(p, options),
      { p, options },
    );
    return JSON.parse(
      Buffer.from(result["observation.json"], "base64").toString(),
    );
  };
  const active = await read({ view: "storyboard" });
  expect(active.frames).toHaveLength(6);
  expect(active.frames.every((f: any) => f.visiblePixels > 0)).toBe(true);
  expect(active.frames.at(-1).time).toBeLessThan(1.2);
  expect(active.sampling.emptySamplesOmitted).toBeGreaterThan(0);
  const timeline = await read({
    view: "storyboard",
    storyboardMode: "timeline",
  });
  expect(
    timeline.frames.some((f: any) => f.visiblePixels === 0 && f.time > 1.2),
  ).toBe(true);
  const explicit = await read({ view: "storyboard", times: [0, 0.4, 9] });
  expect(explicit.frames.map((f: any) => f.time)).toEqual([0, 0.4, 9]);
  expect(explicit.frames[2].visiblePixels).toBe(0);
});

test("64-layer Studio remains scrollable and direct color changes are one undoable edit on a narrow screen", async ({
  page,
}) => {
  const p = defineEffect({
    duration: 0.4,
    fps: 10,
    layers: Array.from({ length: 64 }, (_, i) =>
      ring({
        id: `r${i}`,
        name: `Halo ${i + 1}`,
        position: { x: 12 + (i % 8) * 14, y: 12 + Math.floor(i / 8) * 14 },
        radius: curve(4),
        width: curve(1),
        opacity: curve(1),
        glow: { strength: 0, blur: 0 },
      }),
    ),
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "many.vfx.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
  await expect(page.locator(".layer-select")).toHaveCount(64);
  await page
    .locator(".layer-select")
    .filter({ hasText: "Halo 64" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.locator(".layer-select").filter({ hasText: "Halo 64" }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("many-layers.png") });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.getByRole("button", { name: "Recolor", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Color action", { exact: true })
    .selectOption("Set gradient");
  await dialog.getByLabel("Color stop 1", { exact: true }).fill("#cc3366");
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(701);
  await page.screenshot({
    path: test.info().outputPath("color-gradient-390.png"),
  });
  await dialog
    .getByRole("button", { name: "Apply colors", exact: true })
    .click();
  const snapshot = async () => {
    const wait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Project menu", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Download project", exact: true })
      .click();
    return JSON.parse(
      await readFile((await (await wait).path())!, "utf8"),
    ) as Project;
  };
  const after = await snapshot();
  expect(after.layers).toHaveLength(64);
  expect(after.layers.every((l) => l.colors[0].color === "#cc3366")).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await snapshot()).layers.map((l) => l.colors)).toEqual(
    p.layers.map((l) => l.colors),
  );
});

test("portable CLI supports batch, gradients, baseline QA failure exit codes and preflight JSON", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vfx-cli-workflow-"));
  const cli = async (...args: string[]) =>
    JSON.parse(
      (await exec(process.execPath, [entry("vfx"), ...args], { cwd: root }))
        .stdout,
    );
  try {
    await writeFile(
      join(root, "tasks.json"),
      JSON.stringify([
        {
          action: "create",
          file: "a.json",
          project: simple(),
          out: "out-a",
          options: { format: "sequence" },
        },
        { action: "create", file: "b.json", project: simple() },
      ]),
    );
    expect(
      (await cli("batch", "--tasks-file", "tasks.json", "--dry-run")).ok,
    ).toBe(true);
    expect(await readdir(root)).toEqual(["tasks.json"]);
    expect((await cli("batch", "--tasks-file", "tasks.json")).ok).toBe(true);
    expect((await cli("preflight", "a.json")).ok).toBe(true);
    expect((await cli("analyze", "a.json", "--out", "baseline.json")).ok).toBe(
      true,
    );
    await cli("gradient", "a.json", "--color", "#00ff77");
    let failed: any;
    try {
      await exec(
        process.execPath,
        [entry("vfx"), "analyze", "a.json", "--baseline", "baseline.json"],
        { cwd: root },
      );
    } catch (e) {
      failed = e;
    }
    expect(failed.code).toBe(2);
    expect(JSON.parse(failed.stdout).baseline.passed).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

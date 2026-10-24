import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import {
  defineEffect,
  path,
  ring,
  curve,
  colors,
  getPreset,
  type ObservationReport,
} from "../../src/core/index.js";
const repo = resolve("."),
  exec = promisify(execFile),
  entry = (name: string) =>
    process.env.VFX_TEST_BIN_DIR
      ? join(process.env.VFX_TEST_BIN_DIR, name)
      : join(repo, name === "vfx" ? "dist/cli.js" : "dist/mcp.js");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function session() {
  const root = await mkdtemp(join(tmpdir(), "vfx-agent-ไทย ")),
    client = new Client({ name: "agent-workflow-test", version: "1" });
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
    expect(r.isError, JSON.stringify(r)).not.toBe(true);
    return r.structuredContent as Record<string, any>;
  };
  const image = async (uri: string) => {
    const r = await client.readResource({ uri });
    const v = r.contents[0];
    if (!("blob" in v)) throw Error("Expected PNG resource");
    return Buffer.from(v.blob, "base64");
  };
  return {
    root,
    client,
    call,
    raw,
    image,
    close: async () => {
      await client.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
const project = () =>
  defineEffect({
    name: "Agent geometry",
    duration: 0.6,
    fps: 10,
    layers: [
      path({
        id: "blade",
        name: "Blade",
        points: [
          { x: -20, y: 0 },
          { x: 20, y: 0 },
        ],
        draw: curve(1),
        width: curve(5),
        opacity: curve(1),
        glow: { strength: 0, blur: 0 },
        colors: colors("#ff3355"),
      }),
      ring({
        id: "halo",
        name: "Halo",
        radius: curve(24),
        width: curve(3),
        opacity: curve(1),
        glow: { strength: 0, blur: 0 },
      }),
    ],
  });

test("MCP bounds large observation replies and explains empty explicit frames and expired images", async () => {
  test.setTimeout(120000);
  const s = await session();
  try {
    await s.call("new_project", {
      file: "cross.json",
      preset: "red_magic_cross",
    });
    const empty = await s.call("render_preview", {
      file: "cross.json",
      time: 0.94,
    });
    expect(empty.pixels.visiblePixels).toBe(0);
    expect(empty.warnings[0].code).toBe("EMPTY_FRAME");
    const automatic = await s.call("render_preview", { file: "cross.json" });
    expect(automatic.pixels.visiblePixels).toBeGreaterThan(0);
    expect(automatic.automaticTime).toBe(true);
    const unknown = await s.raw("save_preview", {
      uri: `vfx://images/${"0".repeat(64)}`,
      out: "missing.png",
    });
    expect((unknown.structuredContent as any).error.code).toBe("IMAGE_EXPIRED");
    const large = defineEffect({
      name: "Large observation",
      canvas: { width: 512, height: 512 },
      duration: 0.3,
      fps: 10,
      layers: Array.from({ length: 32 }, (_, i) =>
        path({
          id: `p${i}`,
          name: `Path ${i}`,
          position: { x: 256, y: 256 },
          points: Array.from({ length: 64 }, (_, j) => ({
            x: -220 + j * 7,
            y: Math.sin(j * 0.3 + i) * 120,
          })),
          width: curve(2),
          draw: curve(1),
          opacity: curve(0.6),
          glow: { strength: 0, blur: 0 },
        }),
      ),
    });
    await s.call("new_project", { file: "large.json", project: large });
    const result = await s.raw("observe_project", {
      file: "large.json",
      view: "storyboard",
      times: Array.from({ length: 9 }, (_, i) => i * 0.03),
    });
    expect(result.isError, JSON.stringify(result).slice(0, 500)).not.toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
      4 * 1024 * 1024,
    );
    const info = result.structuredContent as any;
    expect(info.scene.layers).toHaveLength(32);
    expect(info.scene.tiles).toHaveLength(9);
    const clean = info.images.find((i: any) => i.role === "frame");
    expect(PNG.sync.read(await s.image(clean.uri)).width).toBe(512);
  } finally {
    await s.close();
  }
});

test("MCP observes, previews a draft, commits once and verifies exact exported pixels with image fallbacks", async () => {
  test.setTimeout(120000);
  const s = await session();
  try {
    expect((await s.client.listTools()).tools).toHaveLength(41);
    expect((await s.call("capabilities")).coordinates.origin).toBe("top-left");
    expect(
      (await s.client.readResource({ uri: "vfx://guide" })).contents[0],
    ).toHaveProperty("text");
    expect(
      (
        await s.client.getPrompt({
          name: "effect_workflow",
          arguments: { request: "Move the red stroke", file: "a.json" },
        })
      ).messages,
    ).toHaveLength(1);
    const created = await s.call("new_project", {
        file: "a.json",
        project: project(),
      }),
      before = await readFile(join(s.root, "a.json"));
    const seen = await s.call("observe_project", {
      file: "a.json",
      view: "storyboard",
    });
    expect(seen.revision).toBe(created.revision);
    const scene = seen.scene as ObservationReport;
    expect(scene.coordinates.x).toBe("right");
    expect(
      scene.layers.find((l) => l.id === "blade")!.pixels.bounds!.width,
    ).toBeGreaterThan(35);
    const edits = [
      {
        action: "set_path_points",
        id: "blade",
        space: "canvas",
        time: 0.2,
        points: [
          { x: 20, y: 100 },
          { x: 64, y: 64 },
          { x: 108, y: 28 },
        ],
      },
      {
        action: "update_layer",
        id: "halo",
        patch: { position: { x: 70, y: 64 } },
      },
    ];
    const dry = await s.call("apply_edits", {
      file: "a.json",
      revision: created.revision,
      edits,
      dryRun: true,
    });
    const draft = await s.call("observe_project", {
      file: "a.json",
      revision: created.revision,
      edits,
      time: 0.2,
      point: { x: 64, y: 64 },
    });
    expect(draft.draft).toBe(true);
    expect(draft.proposedRevision).toBe(dry.proposedRevision);
    expect(draft.scene.layers[0].geometry.worldPoints[0]).toEqual({
      x: 20,
      y: 100,
    });
    expect(draft.scene.hits).toContain("blade");
    expect(await readFile(join(s.root, "a.json"))).toEqual(before);
    expect((await readdir(s.root)).sort()).toEqual(["a.json"]);
    const clean = draft.images.find((i: any) => i.role === "frame"),
      png = await s.image(clean.uri);
    expect(sha(png)).toBe(clean.sha256);
    expect(PNG.sync.read(png).width).toBe(128);
    const saved = await s.call("save_preview", {
      uri: clean.uri,
      out: "draft.png",
    });
    expect(await readFile(saved.absolutePath)).toEqual(png);
    const duplicate = await s.raw("save_preview", {
      uri: clean.uri,
      out: "draft.png",
    });
    expect(duplicate.isError).toBe(true);
    const escaped = await s.raw("save_preview", {
      uri: clean.uri,
      out: "../outside.png",
    });
    expect(escaped.isError).toBe(true);
    const committed = await s.call("apply_edits", {
      file: "a.json",
      revision: created.revision,
      edits,
    });
    expect(committed.revision).toBe(dry.proposedRevision);
    expect(await readdir(join(s.root, ".vfx-backups"))).toHaveLength(1);
    const final = await s.call("observe_project", {
      file: "a.json",
      time: 0.2,
      includeImage: false,
    });
    expect(final.imageDelivery.inline).toBe(false);
    expect(final.draft).toBe(false);
    expect(
      await s.image(final.images.find((i: any) => i.role === "frame").uri),
    ).toEqual(png);
    const stale = await s.raw("apply_edits", {
      file: "a.json",
      revision: created.revision,
      edits,
    });
    expect(stale.isError).toBe(true);
    expect((stale.structuredContent as any).error.code).toBe(
      "REVISION_CONFLICT",
    );
    const now = await readFile(join(s.root, "a.json"));
    const bad = await s.raw("apply_edits", {
      file: "a.json",
      revision: committed.revision,
      edits: [
        { action: "update_project", patch: { name: "Must roll back" } },
        { action: "remove_layer", id: "missing" },
      ],
    });
    expect(bad.isError).toBe(true);
    expect((bad.structuredContent as any).error).toMatchObject({
      code: "UNKNOWN_LAYER",
      operationNumber: 2,
      atomic: true,
    });
    expect(await readFile(join(s.root, "a.json"))).toEqual(now);
    expect(await readdir(join(s.root, ".vfx-backups"))).toHaveLength(1);
    const output = await s.call("export", {
      file: "a.json",
      revision: committed.revision,
      out: "frames",
      options: { format: "sequence", start: 0.2, end: 0.3, fps: 10 },
    });
    const frame = output.files.find((f: string) => f.endsWith(".png"));
    expect(
      PNG.sync.read(await readFile(join(s.root, "frames", frame))).data,
    ).toEqual(PNG.sync.read(png).data);
    const resourceList = await s.client.listResources();
    expect(resourceList.resources.some((r) => r.uri === clean.uri)).toBe(true);
  } finally {
    await s.close();
  }
});

test("observation diagnoses empty, hidden and outside layers, samples visible timing and picks actual masked alpha", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const p = defineEffect({
    duration: 1,
    layers: [
      path({
        id: "under",
        name: "Under",
        position: { x: 64, y: 64 },
        points: [
          { x: -30, y: 0 },
          { x: 30, y: 0 },
        ],
        width: curve(12),
        draw: curve(1),
        opacity: curve(1),
        glow: { strength: 0, blur: 0 },
      }),
      path({
        id: "masked",
        name: "Masked",
        position: { x: 64, y: 64 },
        points: [
          { x: -30, y: 0 },
          { x: 30, y: 0 },
        ],
        width: curve(10),
        draw: curve(1),
        opacity: curve(1),
        mask: {
          shape: "rectangle",
          position: { x: 20, y: 0 },
          width: 20,
          height: 20,
        },
        glow: { strength: 0, blur: 0 },
      }),
      ring({ id: "hidden", name: "Hidden", visible: false }),
      ring({
        id: "outside",
        name: "Outside",
        position: { x: 300, y: 300 },
        opacity: curve(1),
        radius: curve(10),
        glow: { strength: 0, blur: 0 },
      }),
      ring({
        id: "late",
        name: "Late",
        start: 0.6,
        duration: 0.2,
        opacity: curve(1),
        radius: curve(10),
        glow: { strength: 0, blur: 0 },
      }),
    ],
  });
  const observe = async (options: Record<string, unknown>) => {
    const result = await page.evaluate(
      ({ p, options }) => window.vfx.observe(p, options),
      { p, options },
    );
    return {
      result,
      scene: JSON.parse(
        Buffer.from(result["observation.json"], "base64").toString(),
      ) as ObservationReport,
    };
  };
  const a = await observe({ time: 0.2, point: { x: 64, y: 64 } });
  expect(a.scene.hits).toEqual(["under"]);
  expect(a.scene.layers.find((l) => l.id === "hidden")!.state).toBe("hidden");
  expect(a.scene.layers.find((l) => l.id === "outside")!.state).toBe(
    "outside-canvas",
  );
  expect(a.scene.layers.find((l) => l.id === "late")!.state).toBe(
    "not-started",
  );
  expect(a.scene.warnings.some((w) => w.code === "OUTSIDE_CANVAS")).toBe(true);
  expect(
    (await observe({ time: 0.2, point: { x: 84, y: 64 } })).scene.hits,
  ).toEqual(["masked", "under"]);
  const auto = await observe({ ids: ["late"] });
  expect(auto.scene.frames[0].visiblePixels).toBeGreaterThan(0);
  expect(auto.scene.time).toBeGreaterThanOrEqual(0.6);
  expect(
    (await observe({ ids: ["late"], time: 0.9 })).scene.warnings[0].code,
  ).toBe("EMPTY_FRAME");
  const crop = await observe({
    time: 0.2,
    crop: { x: 0, y: 0, width: 8, height: 8 },
  });
  expect(crop.scene.warnings.some((w) => w.code === "EMPTY_CROP")).toBe(true);
  expect(crop.scene.tiles[0].crop).toEqual({ x: 0, y: 0, width: 8, height: 8 });
  const tiny = await page.evaluate(
    (p) =>
      window.vfx.observe(
        p,
        {
          time: 0.2,
          crop: { x: 60, y: 60, width: 1, height: 1 },
          guides: false,
        },
        true,
      ),
    p,
  );
  expect(
    PNG.sync.read(Buffer.from(tiny["observation.png"], "base64")).width,
  ).toBeGreaterThanOrEqual(240);
  const previous = await page.evaluate((p) => window.vfx.preview(p, 0.2), p);
  await observe({ view: "layers", time: 0.2, ids: ["masked"] });
  expect(await page.evaluate((p) => window.vfx.preview(p, 0.2), p)).toBe(
    previous,
  );
});

test("inspection references never change clean pixels and large layer sheets disclose omitted IDs", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const p = project(),
    image = getPreset("flipbook_burst").assets[0];
  p.editor.reference = {
    image,
    position: { x: 64, y: 64 },
    scale: 1,
    opacity: 0.8,
    plane: "above",
    visible: true,
  };
  const withRef = await page.evaluate(
    (p) => window.vfx.observe(p, { time: 0.2 }),
    p,
  );
  const plain = await page.evaluate(
    (p) => window.vfx.observe(p, { time: 0.2, includeReference: false }),
    p,
  );
  expect(withRef["frame-0.png"]).toBe(plain["frame-0.png"]);
  expect(withRef["observation.png"]).not.toBe(plain["observation.png"]);
  const many = defineEffect({
    canvas: { width: 512, height: 512 },
    duration: 0.3,
    fps: 10,
    layers: Array.from({ length: 64 }, (_, i) =>
      ring({
        id: `r${i}`,
        name: `Ring ${i}`,
        position: { x: 20 + i * 14, y: 256 },
        radius: curve(8),
        opacity: curve(1),
        glow: { strength: 0, blur: 0 },
      }),
    ),
  });
  const result = await page.evaluate(
    (p) => window.vfx.observe(p, { view: "layers", time: 0.1 }),
    many,
  );
  const scene = JSON.parse(
    Buffer.from(result["observation.json"], "base64").toString(),
  ) as ObservationReport;
  expect(scene.layers).toHaveLength(64);
  expect(scene.omittedLayerIds).toHaveLength(55);
  const png = PNG.sync.read(Buffer.from(result["observation.png"], "base64"));
  expect(png.width * png.height).toBeLessThanOrEqual(1048576);
  expect(
    Buffer.byteLength(result["observation.png"], "base64"),
  ).toBeLessThanOrEqual(2097152);
});

test("new CLI observation and edit commands work outside the checkout with file-based operations", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vfx-cli-agent "));
  const cli = async (...args: string[]) =>
    JSON.parse(
      (await exec(process.execPath, [entry("vfx"), ...args], { cwd: root }))
        .stdout,
    );
  try {
    await writeFile(join(root, "effect.json"), JSON.stringify(project()));
    const start = await cli("inspect", "effect.json");
    await writeFile(
      join(root, "edits.json"),
      JSON.stringify([
        { action: "transform_layers", ids: ["blade"], x: 8, y: -8 },
      ]),
    );
    const draft = await cli(
      "observe",
      "effect.json",
      "--out",
      "draft",
      "--edits-file",
      "edits.json",
      "--if-match",
      start.revision,
    );
    expect(draft.draft).toBe(true);
    const dry = await cli(
      "edit",
      "effect.json",
      "--edits-file",
      "edits.json",
      "--if-match",
      start.revision,
      "--dry-run",
    );
    expect((await cli("inspect", "effect.json")).revision).toBe(start.revision);
    const done = await cli(
      "edit",
      "effect.json",
      "--edits-file",
      "edits.json",
      "--if-match",
      start.revision,
    );
    expect(done.revision).toBe(dry.proposedRevision);
    await cli(
      "observe",
      "effect.json",
      "--out",
      "after",
      "--view",
      "storyboard",
      "--times",
      "0.1,0.2,0.5",
    );
    const scene = JSON.parse(
      await readFile(join(root, "after", "scene.json"), "utf8"),
    );
    expect(scene.scene.layers[0].transform.anchor).toEqual({ x: 72, y: 56 });
    expect(scene.scene.frames).toHaveLength(3);
    expect((await cli("schema", "edits")).minItems).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

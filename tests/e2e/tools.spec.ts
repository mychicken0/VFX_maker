import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getPreset } from "../../src/core/index.js";
const exec = promisify(execFile),
  repo = resolve(".");
const cliEntrypoint = process.env.VFX_TEST_BIN_DIR
  ? join(process.env.VFX_TEST_BIN_DIR, "vfx")
  : join(repo, "dist/cli.js");
const mcpEntrypoint = process.env.VFX_TEST_BIN_DIR
  ? join(process.env.VFX_TEST_BIN_DIR, "vfx-mcp")
  : join(repo, "dist/mcp.js");
test("installed-style CLI works outside the repository with portable TypeScript effects and all exports", async () => {
  test.setTimeout(120000);
  const dir = await mkdtemp(join(tmpdir(), "vfx-tool-ไทย "));
  const cli = async (...args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, [cliEntrypoint, ...args], {
          cwd: dir,
        })
      ).stdout,
    );
  try {
    const p = getPreset();
    p.duration = 0.31;
    p.fps = 10;
    await writeFile(join(dir, "custom.json"), JSON.stringify(p));
    const info = await cli("inspect", "custom.json");
    expect(info.project.version).toBe("0.7.5");
    await cli(
      "set",
      "custom.json",
      "--layer",
      "cut-a",
      "--set",
      '{"position":{"x":60}}',
      "--if-match",
      info.revision,
    );
    await cli(
      "preview",
      "custom.json",
      "--time",
      "0.2",
      "--out",
      "preview.png",
    );
    expect((await stat(join(dir, "preview.png"))).size).toBeGreaterThan(100);
    for (const format of ["gif", "spritesheet", "sequence", "godot", "unity"]) {
      const result = await cli(
        "export",
        "custom.json",
        "--format",
        format,
        "--out",
        format,
        "--progress",
      );
      expect(result.files).toContain("metadata.json");
      expect(
        JSON.parse(await readFile(join(dir, format, "metadata.json"), "utf8"))
          .frames,
      ).toHaveLength(4);
    }
    expect((await cli("schema", "stage")).properties.projection).toBeDefined();
    await cli(
      "export",
      "custom.json",
      "--format",
      "sequence",
      "--view",
      "stage",
      "--out",
      "camera",
    );
    const cameraMeta = JSON.parse(
      await readFile(join(dir, "camera", "metadata.json"), "utf8"),
    );
    expect(cameraMeta.view).toBe("stage");
    expect(cameraMeta.renderer).toBe("three-stage-pixi-planes");
    await writeFile(
      join(dir, "custom.ts"),
      `import {defineEffect, particles, curve, colors} from 'vfx-maker'; export default defineEffect({name:'Scripted',duration:0.3,fps:10,layers:[particles({id:'custom',name:'Custom',count:7,colors:colors('#55ffaa'),size:curve(3,0)})]});`,
    );
    expect(
      (await cli("build", "custom.ts", "--out", "scripted.json")).project.name,
    ).toBe("Scripted");
    const compressed = await cli(
      "optimize",
      "preview.png",
      "--out",
      "small.png",
      "--scale",
      "0.5",
      "--colors",
      "16",
    );
    expect(compressed.stats.width).toBe(64);
    expect(compressed.stats.colorsAfter).toBeLessThanOrEqual(16);
    const resized = await cli(
      "resize",
      "custom.json",
      "--width",
      "64",
      "--height",
      "64",
    );
    expect(resized.project.canvas.width).toBe(64);
    const grouped = await cli(
      "group",
      "custom.json",
      "--id",
      "attack",
      "--name",
      "Attack",
      "--layers",
      "cut-a,cut-b",
    );
    expect(grouped.project.groups[0].ids).toEqual(["cut-a", "cut-b"]);
    const moved = await cli(
      "transform",
      "custom.json",
      "--layers",
      "cut-a,cut-b",
      "--x",
      "3",
      "--scale",
      "0.8",
    );
    expect(
      moved.project.layers.find((l: { id: string }) => l.id === "cut-a").scale,
    ).toBeCloseTo(0.4);
    const keyed = await cli(
      "keyframe",
      "custom.json",
      "cut-a",
      "motion.x",
      "--time",
      "0.5",
      "--value",
      "12",
      "--ease",
      "smooth",
    );
    expect(
      keyed.project.layers.find((l: { id: string }) => l.id === "cut-a").motion
        .x[1].value,
    ).toBe(12);
    const backups = await cli("backups", "custom.json");
    expect(backups.length).toBeLessThanOrEqual(5);
    const restored = await cli(
      "restore",
      "custom.json",
      backups[0].id,
      "--if-match",
      keyed.revision,
    );
    expect(
      restored.project.layers.find((l: { id: string }) => l.id === "cut-a")
        .motion.x,
    ).toHaveLength(2);
    const version = await exec(process.execPath, [cliEntrypoint, "--version"], {
      cwd: dir,
    });
    expect(version.stdout.trim()).toBe("0.7.5");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("official MCP client authors without graph wiring, returns real image and manages revisioned jobs", async () => {
  test.setTimeout(120000);
  const dir = await mkdtemp(join(tmpdir(), "vfx-mcp-ไทย ")),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpEntrypoint, "--root", dir],
      stderr: "pipe",
    }),
    client = new Client({ name: "vfx-e2e", version: "1" });
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const first = (result.content as { type: string; text: string }[])[0];
    return JSON.parse(first.text);
  };
  const poll = async (id: string, terminal = true) => {
    for (let i = 0; i < 200; i++) {
      const j = await call("get_export_job", { id });
      if (
        terminal
          ? ["succeeded", "failed", "cancelled"].includes(j.status)
          : j.status === "running"
      )
        return j;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Job did not reach expected state");
  };
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(41);
    const project = getPreset("spark_burst");
    project.duration = 0.31;
    project.fps = 10;
    let a = await call("new_project", { file: "effect.json", project });
    a = await call("update_layer", {
      file: "effect.json",
      revision: a.revision,
      id: "sparks",
      patch: { count: 12, colors: [{ t: 0, color: "#44ffaa" }] },
    });
    a = await call("group_layers", {
      file: "effect.json",
      revision: a.revision,
      id: "burst",
      name: "Burst",
      ids: ["shockwave", "sparks"],
    });
    expect(a.project.groups[0].ids).toEqual(["shockwave", "sparks"]);
    a = await call("transform_layers", {
      file: "effect.json",
      revision: a.revision,
      ids: ["shockwave", "sparks"],
      x: 2,
    });
    a = await call("put_keyframe", {
      file: "effect.json",
      revision: a.revision,
      id: "sparks",
      channel: "motion.x",
      time: 0.5,
      value: 3,
      ease: "smooth",
    });
    expect(a.project.layers[1].motion.x[1].value).toBe(3);
    const history = await call("list_backups", { file: "effect.json" });
    expect(history.result).toHaveLength(4);
    a = await call("restore_backup", {
      file: "effect.json",
      revision: a.revision,
      id: history.result[0].id,
    });
    expect(a.project.layers[1].motion.x).toHaveLength(2);
    const stale = await client.callTool({
      name: "update_project",
      arguments: {
        file: "effect.json",
        revision: "0".repeat(64),
        patch: { seed: 5 },
      },
    });
    expect(stale.isError).toBe(true);
    const image = await client.callTool({
      name: "render_preview",
      arguments: { file: "effect.json", time: 0.2 },
    });
    const block = (image.content as { type: string; data: string }[])[0];
    expect(block.type).toBe("image");
    const cli = await exec(
      process.execPath,
      [
        cliEntrypoint,
        "preview",
        "effect.json",
        "--time",
        "0.2",
        "--out",
        "cli.png",
      ],
      { cwd: dir },
    );
    expect(JSON.parse(cli.stdout).file).toContain("cli.png");
    expect(Buffer.from(block.data, "base64")).toEqual(
      await readFile(join(dir, "cli.png")),
    );
    const optimized = await call("optimize_png", {
      png: "cli.png",
      out: "optimized.png",
      options: { scale: 0.5, colors: 16 },
    });
    expect(optimized.stats.width).toBe(64);
    expect(optimized.stats.colorsAfter).toBeLessThanOrEqual(16);
    const sheet = getPreset("flipbook_burst");
    const assetProject = await call("new_project", {
      file: "sheet.json",
      project: sheet,
    });
    const optimizedAsset = await call("optimize_asset", {
      file: "sheet.json",
      revision: assetProject.revision,
      id: sheet.assets[0].id,
      options: { colors: 16, scale: 0.5 },
    });
    expect(optimizedAsset.project.assets[0].frames).toBe(6);
    a = await call("resize_project", {
      file: "effect.json",
      revision: a.revision,
      width: 64,
      height: 64,
      mode: "scale",
    });
    expect(a.project.canvas.width).toBe(64);
    a = await call("recolor_project", {
      file: "effect.json",
      revision: a.revision,
      hue: 120,
    });
    const job = await call("start_export", {
      file: "effect.json",
      revision: a.revision,
      out: "job",
      options: { format: "gif" },
    });
    const done = await poll(job.id);
    expect(done.status).toBe("succeeded");
    expect(done.completed).toBe(4);
    const sync = await call("export", {
      file: "effect.json",
      revision: a.revision,
      out: "sync",
      options: { format: "gif" },
    });
    expect(sync.files).toContain("animation.gif");
    expect(await readFile(join(dir, "sync/animation.gif"))).toEqual(
      await readFile(join(dir, "job/animation.gif")),
    );
    const active = await call("start_export", {
      file: "effect.json",
      revision: a.revision,
      out: "cancelled",
      options: { format: "sequence" },
    });
    await poll(active.id, false);
    const queued = await call("start_export", {
      file: "effect.json",
      revision: a.revision,
      out: "queued",
      options: { format: "gif" },
    });
    await call("cancel_export_job", { id: queued.id });
    await call("cancel_export_job", { id: active.id });
    expect((await poll(active.id)).status).toBe("cancelled");
    expect((await poll(queued.id)).status).toBe("cancelled");
    await expect(stat(join(dir, "cancelled"))).rejects.toThrow();
    await expect(stat(join(dir, "queued"))).rejects.toThrow();
    expect(
      (
        await client.callTool({
          name: "inspect_project",
          arguments: { file: "../outside" },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await client.close();
    await transport.close();
    await rm(dir, { recursive: true, force: true });
  }
});

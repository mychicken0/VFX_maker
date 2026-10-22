import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const exec = promisify(execFile);
const entry = (kind: "vfx" | "vfx-mcp") =>
  process.env.VFX_TEST_BIN_DIR
    ? join(process.env.VFX_TEST_BIN_DIR, kind)
    : resolve(kind === "vfx" ? "dist/cli.js" : "dist/mcp.js");

test("portable CLI authors modifiers, controls, components and batched variants", async () => {
  test.setTimeout(120000);
  const dir = await mkdtemp(join(tmpdir(), "vfx-creative-ไทย "));
  const cli = async (...args: string[]) =>
    JSON.parse(
      (await exec(process.execPath, [entry("vfx"), ...args], { cwd: dir }))
        .stdout,
    );
  try {
    const original = await cli("new", "effect.json", "--preset", "void_portal");
    const controls = await cli("controls", "effect.json");
    expect(
      controls.layers[0].targets.some(
        (t: { path: string }) => t.path === "cutoff",
      ),
    ).toBe(true);
    await cli(
      "creative",
      "effect.json",
      "--set",
      JSON.stringify({
        action: "put_modifier",
        layer: "rift",
        modifier: { id: "edge", type: "outline" },
        index: 0,
      }),
    );
    await cli("control", "effect.json", "hue", "60");
    await cli(
      "creative",
      "effect.json",
      "--set",
      JSON.stringify({ action: "capture_variant", id: "warm", name: "Warm" }),
    );
    await cli("control", "effect.json", "hue", "-90");
    await cli(
      "creative",
      "effect.json",
      "--set",
      JSON.stringify({ action: "capture_variant", id: "cool", name: "Cool" }),
    );
    await cli(
      "component-save",
      "effect.json",
      "--layers",
      "rift,outer-halo",
      "--name",
      "Rift",
      "--out",
      "rift.vfx-component.json",
    );
    const inserted = await cli(
      "component-insert",
      "effect.json",
      "rift.vfx-component.json",
      "--x",
      "40",
      "--y",
      "40",
    );
    expect(inserted.ids).toHaveLength(2);
    expect(inserted.project.layers).toHaveLength(
      original.project.layers.length + 2,
    );
    const schema = await cli("schema", "creative");
    expect(schema).toBeTruthy();
    await cli("set", "effect.json", "--set", '{"duration":0.21,"fps":10}');
    await cli(
      "export-variants",
      "effect.json",
      "--ids",
      "warm,cool",
      "--format",
      "gif",
      "--out",
      "looks",
      "--progress",
    );
    for (const id of ["warm", "cool"]) {
      expect(
        (await stat(join(dir, "looks", id, "animation.gif"))).size,
      ).toBeGreaterThan(100);
      const meta = JSON.parse(
        await readFile(join(dir, "looks", id, "metadata.json"), "utf8"),
      );
      expect(meta.frames).toHaveLength(3);
    }
    await expect(
      cli(
        "creative",
        "effect.json",
        "--if-match",
        original.revision,
        "--set",
        '{"action":"set_control","id":"hue","value":0}',
      ),
    ).rejects.toThrow();
    expect(
      (await cli("inspect", "effect.json")).project.controls.find(
        (c: { id: string }) => c.id === "hue",
      ).value,
    ).toBe(-90);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MCP exposes the complete creative workflow and revisioned variant jobs", async () => {
  test.setTimeout(120000);
  const dir = await mkdtemp(join(tmpdir(), "vfx-mcp-creative-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry("vfx-mcp"), "--root", dir],
    cwd: dir,
    stderr: "pipe",
  });
  const client = new Client({ name: "creative-workflow-test", version: "1" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw Error(JSON.stringify(result.content));
    return result.structuredContent as Record<string, any>;
  };
  try {
    let current = await call("new_project", {
      file: "effect.json",
      preset: "spark_burst",
    });
    const inspected = await call("inspect_creative", { file: "effect.json" });
    expect(inspected.controls).toHaveLength(3);
    current = await call("edit_creative", {
      file: "effect.json",
      revision: current.revision,
      operation: {
        action: "put_modifier",
        layer: "sparks",
        modifier: { id: "pixel", type: "pixelate", size: 2 },
      },
    });
    current = await call("edit_creative", {
      file: "effect.json",
      revision: current.revision,
      operation: { action: "capture_variant", id: "a", name: "Original" },
    });
    current = await call("edit_creative", {
      file: "effect.json",
      revision: current.revision,
      operation: { action: "set_control", id: "hue", value: 100 },
    });
    current = await call("edit_creative", {
      file: "effect.json",
      revision: current.revision,
      operation: { action: "capture_variant", id: "b", name: "Alternate" },
    });
    await call("save_component", {
      file: "effect.json",
      revision: current.revision,
      ids: ["sparks"],
      name: "Sparks",
      out: "sparks.vfx-component.json",
    });
    current = await call("insert_component", {
      file: "effect.json",
      revision: current.revision,
      source: "sparks.vfx-component.json",
    });
    expect(current.ids).toHaveLength(1);
    current = await call("update_project", {
      file: "effect.json",
      revision: current.revision,
      patch: { duration: 0.21, fps: 10 },
    });
    const job = await call("start_variant_export", {
      file: "effect.json",
      revision: current.revision,
      ids: ["a", "b"],
      out: "looks",
      options: { format: "gif" },
    });
    await expect
      .poll(async () => (await call("get_export_job", { id: job.id })).status, {
        timeout: 30000,
      })
      .toBe("succeeded");
    expect(
      (await stat(join(dir, "looks", "a", "animation.gif"))).size,
    ).toBeGreaterThan(100);
    expect(
      (await stat(join(dir, "looks", "b", "animation.gif"))).size,
    ).toBeGreaterThan(100);
    const preview = await client.callTool({
      name: "render_preview",
      arguments: { file: "effect.json", time: 0.1 },
    });
    expect(preview.isError).not.toBe(true);
    expect((preview.content as { type: string }[])[0].type).toBe("image");
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// Real stdio MCP camera authoring and exports. Supply a fresh output directory.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = resolve(process.argv[2] ?? ""),
  entry = resolve(process.argv[3] ?? "dist/mcp.js");
if (!process.argv[2]) throw Error("Supply a fresh output directory");
await mkdir(root);
const client = new Client({ name: "stage-gallery-agent", version: "1" }),
  transcript = [],
  items = [];
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, JSON.stringify(result));
  transcript.push({
    tool: name,
    arguments: args,
    result: result.structuredContent,
  });
  return result.structuredContent;
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
  const capabilities = await call("capabilities");
  for (const recipe of [
    {
      id: "isometric-heal",
      preset: "heal_pulse",
      name: "Isometric healing field",
      camera: {
        mode: "2.5d",
        projection: "orthographic",
        span: 160,
        azimuth: 35,
        elevation: 35.264,
        plane: "ground",
      },
      placements: { sparks: { plane: "billboard", position: { y: 10 } } },
    },
    {
      id: "depth-cross",
      preset: "red_magic_cross",
      name: "Crimson cross in depth",
      camera: {
        mode: "3d",
        projection: "perspective",
        distance: 200,
        azimuth: 25,
        elevation: 20,
        plane: "upright",
      },
      placements: {
        "cut-a": { plane: "upright", position: { z: 16 } },
        "cut-b": { plane: "upright", position: { z: -16 } },
        shockwave: { plane: "ground", position: { y: -20 } },
        sparks: { plane: "billboard" },
      },
    },
  ]) {
    const dir = join(root, recipe.id),
      file = `${recipe.id}/effect.vfx.json`;
    await mkdir(dir);
    await call("new_project", { file, preset: recipe.preset, seed: 74 });
    const scene = await call("get_stage", { file });
    const edits = [
      { action: "update_project", patch: { name: recipe.name } },
      { action: "configure_stage", patch: recipe.camera },
      ...Object.entries(recipe.placements).map(([id, patch]) => ({
        action: "place_stage_layer",
        id,
        patch,
      })),
    ];
    await writeFile(
      join(dir, "edits.json"),
      JSON.stringify(edits, null, 2) + "\n",
    );
    const bytes = await readFile(join(root, file), "utf8");
    const draft = await call("render_preview", {
      file,
      revision: scene.revision,
      edits,
      view: "stage",
      time: 0.35,
    });
    assert.equal(await readFile(join(root, file), "utf8"), bytes);
    const saved = await call("apply_edits", {
      file,
      revision: scene.revision,
      edits,
    });
    const preview = await call("render_preview", {
      file,
      view: "stage",
      time: 0.35,
    });
    assert.equal(preview.images[0].sha256, draft.images[0].sha256);
    assert(preview.pixels.visiblePixels > 0);
    await call("save_preview", {
      uri: preview.images[0].uri,
      out: `${recipe.id}/preview.png`,
    });
    const qa = await call("analyze_project", {
      file,
      view: "stage",
      times: [0.15, 0.35, 0.55],
      out: `${recipe.id}/baseline.json`,
    });
    assert.equal(qa.parity.passed, true);
    for (const format of ["gif", "godot"]) {
      const job = await call("start_export", {
        file,
        revision: saved.revision,
        out: `${recipe.id}/${format}`,
        options: { view: "stage", format, scale: format === "gif" ? 3 : 1 },
      });
      for (let i = 0; ; i++) {
        if (i > 2000) throw Error("Stage export timed out");
        const status = await call("get_export_job", { id: job.id });
        if (["succeeded", "failed", "cancelled"].includes(status.status)) {
          assert.equal(status.status, "succeeded", JSON.stringify(status));
          break;
        }
        await new Promise((done) => setTimeout(done, 50));
      }
    }
    const gif = await readFile(join(dir, "gif/animation.gif"));
    items.push({
      id: recipe.id,
      name: recipe.name,
      preset: recipe.preset,
      view: "stage",
      draftKeptSource: true,
      draftCommitPngSha256: preview.images[0].sha256,
      parity: qa.parity,
      gifSha256: createHash("sha256").update(gif).digest("hex"),
      gifBytes: gif.length,
    });
    process.stdout.write(
      `${recipe.id}: camera draft/commit parity and exports passed\n`,
    );
  }
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify(
      {
        version: capabilities.version,
        tools: (await client.listTools()).tools.length,
        items,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(root, "transcript.json"),
    JSON.stringify(transcript, null, 2) + "\n",
  );
} finally {
  await client.close();
}

// Replay the inspected example through real stdio MCP, including image fallbacks.
// node scripts/verify-agent.mjs NEW_OUTPUT_DIRECTORY [ABSOLUTE_MCP_ENTRY]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
if (!process.argv[2]) throw Error("Provide a fresh output directory");
const root = resolve(process.argv[2]),
  server = resolve(process.argv[3] ?? "dist/mcp.js"),
  recipe = JSON.parse(
    await readFile(
      new URL("../examples/agent-workflow/recipe.json", import.meta.url),
      "utf8",
    ),
  ),
  client = new Client({ name: "vfx-agent-replay", version: "1" }),
  transcript = [];
await mkdir(root);
const sha = (b) => createHash("sha256").update(b).digest("hex");
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert(!response.isError, JSON.stringify(response));
  const value = response.structuredContent;
  transcript.push({ tool: name, arguments: args, result: value });
  return value;
}
async function snapshot(label, args) {
  const seen = await call("observe_project", {
    file: "effect.vfx.json",
    ...args,
  });
  await writeFile(
    join(root, `${label}.json`),
    JSON.stringify(seen, null, 2) + "\n",
  );
  const image = seen.images.find((i) => i.role === "annotated");
  const saved = await call("save_preview", {
    uri: image.uri,
    out: `${label}.png`,
  });
  assert.equal(sha(await readFile(saved.absolutePath)), image.sha256);
  return seen;
}
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server, "--root", root],
      cwd: root,
      stderr: "pipe",
    }),
  );
  assert.equal((await client.listTools()).tools.length, 40);
  const guide = await client.readResource({ uri: "vfx://guide" });
  assert(guide.contents[0].text.includes("canvas"));
  const a = await call("new_project", {
    file: "effect.vfx.json",
    preset: recipe.preset,
  });
  const before = await readFile(join(root, "effect.vfx.json"));
  await snapshot("before", { view: "storyboard" });
  const draft = await snapshot("draft", {
    revision: a.revision,
    edits: recipe.edits,
    time: recipe.time,
  });
  assert(draft.draft);
  assert.deepEqual(await readFile(join(root, "effect.vfx.json")), before);
  const dry = await call("apply_edits", {
    file: "effect.vfx.json",
    revision: a.revision,
    edits: recipe.edits,
    dryRun: true,
  });
  assert.equal(dry.proposedRevision, draft.proposedRevision);
  const resource = draft.images.find((i) => i.role === "frame"),
    read = await client.readResource({ uri: resource.uri }),
    draftPng = Buffer.from(read.contents[0].blob, "base64");
  assert.equal(sha(draftPng), resource.sha256);
  const done = await call("apply_edits", {
    file: "effect.vfx.json",
    revision: a.revision,
    edits: recipe.edits,
  });
  assert.equal(done.revision, draft.proposedRevision);
  assert.equal((await readdir(join(root, ".vfx-backups"))).length, 1);
  const final = await snapshot("final", {
    time: recipe.time,
    includeImage: false,
    point: { x: 64, y: 64 },
  });
  assert(!final.draft);
  assert(!final.imageDelivery.inline);
  assert(final.scene.layers[0].drivenBy.length > 0);
  const finalImage = final.images.find((i) => i.role === "frame");
  assert.equal(finalImage.sha256, resource.sha256);
  await call("save_preview", { uri: finalImage.uri, out: "clean.png" });
  await snapshot("storyboard", { view: "storyboard" });
  const job = await call("start_export", {
    file: "effect.vfx.json",
    revision: done.revision,
    out: "gif",
    options: { format: "gif", scale: 3 },
  });
  let terminal;
  for (let n = 0; n < 300; n++) {
    terminal = await call("get_export_job", { id: job.id });
    if (["succeeded", "failed", "cancelled"].includes(terminal.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(terminal.status, "succeeded");
  const artifacts = {};
  for (const name of [
    "effect.vfx.json",
    "before.png",
    "draft.png",
    "final.png",
    "clean.png",
    "storyboard.png",
    "gif/animation.gif",
  ])
    artifacts[name] = {
      sha256: sha(await readFile(join(root, name))),
      bytes: (await readFile(join(root, name))).length,
    };
  const report = {
    version: final.scene.version,
    protocol: "official MCP SDK over stdio",
    tools: 40,
    revision: done.revision,
    checks: {
      draftDidNotWrite: true,
      dryRunRevisionMatches: true,
      oneBackup: true,
      resourceHashMatches: true,
      draftAndCommittedPixelsMatch: true,
      textOnlyFallback: true,
      macroBindingsReported: true,
      gifJobSucceeded: true,
    },
    artifacts,
  };
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    join(root, "transcript.json"),
    JSON.stringify(transcript, null, 2) + "\n",
  );
  console.log(JSON.stringify({ root, ...report }, null, 2));
} finally {
  await client.close();
}

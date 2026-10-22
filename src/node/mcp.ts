#!/usr/bin/env node
import { Command } from "commander";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Store } from "./store.js";
import { Service } from "./service.js";
import { Jobs } from "./jobs.js";
import { getPreset } from "../core/presets.js";
import { VERSION } from "../core/model.js";
import { exportOptionsSchema } from "../core/export-options.js";
const cli = new Command()
  .name("vfx-mcp")
  .version(VERSION)
  .option("--root <directory>", "File access root", process.cwd())
  .option("--stdio", "Use stdio transport (default)")
  .parse();
const s = new Service(await Store.open(cli.opts().root)),
  jobs = new Jobs();
const server = new McpServer(
  { name: "vfx-maker", version: VERSION },
  {
    maxToolInputElements: 50000,
    instructions:
      "VFX Maker 0.4 uses editable layers, not graphs. Inspect a project to get its revision before changes. Updates merge nested objects and replace arrays. Layer order is bottom to top. Start with get_preset, then update_layer; use curves and paths for custom shapes. Export uses local Chromium + PixiJS, no network. Files are confined to the selected root and output paths must be unused. Prefer start_export and poll for long renders. TypeScript code execution is available only in the CLI build command for trusted sources.",
  },
);
const file = z.string().min(1).max(2048),
  revision = z.string().regex(/^[0-9a-f]{64}$/),
  patch = z.record(z.string(), z.unknown());
const tool = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  handler: (args: z.infer<z.ZodObject<S>>) => unknown | Promise<unknown>,
  readOnly = false,
) => {
  const schema = z.object(shape).strict();
  server.registerTool(
    name,
    {
      description,
      inputSchema: shape as z.ZodRawShape,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: !readOnly,
        idempotentHint: readOnly,
        openWorldHint: false,
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await handler(schema.parse(args)),
          object =
            result && typeof result === "object" && !Array.isArray(result)
              ? (result as Record<string, unknown>)
              : { result };
        return {
          content: [{ type: "text", text: JSON.stringify(object) }],
          structuredContent: object,
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            { type: "text", text: e instanceof Error ? e.message : String(e) },
          ],
        };
      }
    },
  );
};
tool(
  "capabilities",
  "Discover formats, limits and workflows.",
  {},
  () => ({
    version: VERSION,
    root: s.store.root,
    layerTypes: ["particles", "path", "ring", "sprite"],
    formats: ["gif", "spritesheet", "sequence", "godot", "unity"],
    limits: {
      layers: 32,
      particleBirths: 4000,
      frames: 300,
      sourcePixels: 16777216,
      fileBytes: 4194304,
    },
    editing:
      "No graph wiring. Merge fields directly on named layers; curves are arrays of {t,value,ease}; colors are {t,color} stops.",
  }),
  true,
);
tool(
  "list_presets",
  "List editable templates. No effect-specific rendering branches.",
  {},
  () => s.presets(),
  true,
);
tool(
  "get_preset",
  "Return complete editable project data for a template.",
  { id: z.string() },
  (a) => ({ project: getPreset(a.id) }),
  true,
);
tool(
  "get_schema",
  "Get schema, defaults and limits for project, layer or asset.",
  { kind: z.enum(["project", "layer", "asset"]) },
  (a) => s.schema(a.kind),
  true,
);
tool(
  "new_project",
  "Create a portable effect. Supply a preset ID or complete project data.",
  {
    file,
    preset: z.string().optional(),
    project: patch.optional(),
    seed: z.number().int().optional(),
  },
  (a) => s.create(a.file, a),
);
tool(
  "inspect_project",
  "Validate a project and return data plus revision for safe editing.",
  { file },
  (a) => s.store.read(a.file),
  true,
);
tool(
  "update_project",
  "Merge nested project fields. Arrays replace existing arrays. Revision required.",
  { file, revision, patch },
  (a) => s.update(a.file, a.revision, a.patch),
);
tool(
  "add_layer",
  "Add a layer using schema defaults. Required fields: id, name, type. Paths need points; sprites need asset.",
  { file, revision, layer: patch },
  (a) => s.addLayer(a.file, a.revision, a.layer),
);
tool(
  "update_layer",
  "Customize a named layer directly. Merge nested settings; replace curves/colors/points as arrays.",
  { file, revision, id: z.string(), patch },
  (a) => s.updateLayer(a.file, a.revision, a.id, a.patch),
);
tool(
  "remove_layer",
  "Remove an unlocked layer. Revision required.",
  { file, revision, id: z.string() },
  (a) => s.removeLayer(a.file, a.revision, a.id),
);
tool(
  "reorder_layers",
  "Set complete layer order, bottom to top.",
  { file, revision, ids: z.array(z.string()).max(32) },
  (a) => s.reorder(a.file, a.revision, a.ids),
);
tool(
  "import_asset",
  "Embed a static PNG or flipbook sheet from a path inside root.",
  {
    file,
    revision,
    png: file,
    id: z.string(),
    columns: z.number().int().optional(),
    rows: z.number().int().optional(),
    frames: z.number().int().optional(),
  },
  (a) => s.importAsset(a.file, a.revision, a.png, a),
);
server.registerTool(
  "render_preview",
  {
    description:
      "Render an actual PixiJS frame and return an inline PNG image.",
    inputSchema: { file, time: z.number().min(0).max(10).default(0.35) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (a) => {
    try {
      const result = await s.preview(a.file, a.time);
      return {
        content: [
          {
            type: "image",
            mimeType: "image/png",
            data: result.png.toString("base64"),
          },
          {
            type: "text",
            text: JSON.stringify({ revision: result.revision, time: a.time }),
          },
        ],
      };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: String(e) }] };
    }
  },
);
tool(
  "export",
  "Render to a new directory. PNG preserves alpha; GIF has an opaque matte. Use start_export for long jobs.",
  { file, out: file, revision, options: exportOptionsSchema },
  (a) => s.export(a.file, a.out, a.options, a.revision),
);
tool(
  "start_export",
  "Queue a cancellable export of an immutable snapshot. Poll get_export_job. State is session-scoped.",
  { file, out: file, revision, options: exportOptionsSchema },
  async (a) => {
    await s.store.path(a.out, false);
    const snapshot = await s.store.read(a.file);
    if (snapshot.revision !== a.revision) throw new Error("Revision conflict");
    return jobs.start((signal, progress) =>
      s.exportSnapshot(
        snapshot.project,
        snapshot.revision,
        a.out,
        a.options,
        signal,
        progress,
      ),
    );
  },
);
tool(
  "get_export_job",
  "Get queued/running/cancelling/cancelled/succeeded/failed state and frame progress.",
  { id: z.string() },
  (a) => jobs.get(a.id),
  true,
);
tool(
  "cancel_export_job",
  "Request cancellation; poll until terminal state. Completed outputs remain.",
  { id: z.string() },
  (a) => jobs.cancel(a.id),
);
const transport = new StdioServerTransport(process.stdin, process.stdout, {
  maxBufferSize: 4 * 1024 * 1024,
});
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await jobs.close();
  await server.close();
};
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
process.stdin.once("end", () => {
  void shutdown();
});
try {
  await server.connect(transport);
} catch (e) {
  process.stderr.write(String(e) + "\n");
  process.exitCode = 1;
}

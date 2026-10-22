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
import { pixelOptionsSchema } from "../core/pixel-options.js";
import { exportOptionsSchema } from "../core/export-options.js";
import { creativeEditSchema } from "../core/creative.js";
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
      "VFX Maker 0.7 uses editable layers and portable ordered modifiers. Use inspect_creative and edit_creative for macro controls, variants and timing; save_component/insert_component reuse editable parts. Inspect a project to get its revision before changes. Updates merge nested objects and replace arrays. Layer order is bottom to top. Start with get_preset, then update_layer; use curves, Bezier path handles and layer masks for custom shapes. Group and transform selected layers together. Keyframe times are normalized within each layer. Each disk edit backs up the previous file; list_backups and restore_backup recover it. Editor references never render or export. Export uses local Chromium + PixiJS, no network. Files are confined to the selected root and output paths must be unused. Prefer start_export and poll for long renders. TypeScript code execution is available only in the CLI build command for trusted sources.",
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
    layerTypes: ["particles", "path", "ring", "sprite", "field"],
    modifiers: [
      "outline",
      "pixelate",
      "color-replace",
      "ramp",
      "shockwave",
      "noise-warp",
      "dissolve",
    ],
    creative:
      "inspect_creative lists macro controls, variants and valid layer binding targets. edit_creative edits modifiers, controls, variants and timing. save_component and insert_component reuse selected layers across projects. start_variant_export queues a batch of 1..8 variants.",
    formats: ["gif", "spritesheet", "sequence", "godot", "unity"],
    limits: {
      layers: 32,
      particleBirths: 4000,
      frames: 300,
      sourcePixels: 16777216,
      fileBytes: 4194304,
      pngInputSide: 1024,
      outputScale: [0.125, 8],
      pngOutputPixels: 16777216,
      gifOutputPixels: 33554432,
      paletteColors: [2, 256],
    },
    imageProcessing:
      "Local PNG optimization needs no browser. Palette, scale, block and alpha reductions are lossy; default PNG recompression preserves decoded RGBA.",
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
  "Get schema, defaults and limits for project, layer, asset, pixels or export.",
  {
    kind: z.enum([
      "project",
      "layer",
      "asset",
      "pixels",
      "export",
      "creative",
      "modifier",
      "control",
    ]),
  },
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
  "group_layers",
  "Create a named selection group without changing compositing order. Moves members out of previous groups.",
  {
    file,
    revision,
    id: z.string(),
    name: z.string(),
    ids: z.array(z.string()).min(1).max(32),
  },
  (a) => s.group(a.file, a.revision, a.id, a.name, a.ids),
);
tool(
  "transform_layers",
  "Move, rotate and uniformly scale selected layers around their mean anchor or an explicit pivot. Locked layers are skipped by default.",
  {
    file,
    revision,
    ids: z.array(z.string()).min(1).max(32),
    x: z.number().optional(),
    y: z.number().optional(),
    rotation: z.number().min(-360).max(360).optional(),
    scale: z.number().positive().max(16).optional(),
    pivot: z.object({ x: z.number(), y: z.number() }).optional(),
    includeLocked: z.boolean().default(false),
  },
  (a) => s.transform(a.file, a.revision, a.ids, a),
);
tool(
  "put_keyframe",
  "Insert or replace a curve key. Time is normalized 0..1 within the layer; other channels stay unchanged. Channel examples: motion.x, opacity, width, draw.",
  {
    file,
    revision,
    id: z.string(),
    channel: z.string(),
    time: z.number().min(0).max(1),
    value: z.number(),
    ease: z.enum(["linear", "smooth", "hold"]).default("linear"),
  },
  (a) =>
    s.keyframe(a.file, a.revision, a.id, a.channel, a.time, a.value, a.ease),
);
tool(
  "list_backups",
  "List the five retained versions of a root-scoped project before disk edits.",
  { file },
  (a) => s.store.backups(a.file),
  true,
);
tool(
  "restore_backup",
  "Restore a listed backup with a revision check. Backs up the current file first.",
  { file, revision, id: z.string() },
  (a) => s.store.restore(a.file, a.revision, a.id),
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
tool(
  "optimize_png",
  "Optimize a root-scoped static PNG to a new file. No Chromium needed; returns actual size/dimension/color stats and SHA-256.",
  {
    png: file,
    out: file,
    options: pixelOptionsSchema.default({
      scale: 1,
      colors: 0,
      dither: false,
      pixelSize: 1,
      alphaLevels: 0,
    }),
  },
  (a) => s.optimize(a.png, a.out, a.options),
);
tool(
  "optimize_asset",
  "Optimize an embedded PNG with a required revision. Rejects resized sheets whose grid no longer divides the image.",
  { file, revision, id: z.string(), options: pixelOptionsSchema },
  (a) => s.optimizeAsset(a.file, a.revision, a.id, a.options),
);
tool(
  "resize_project",
  "Uniformly fit and center the complete composition, or crop/expand just the canvas. Required revision; whole-project resize includes locked layers.",
  {
    file,
    revision,
    width: z.number().int().min(16).max(512),
    height: z.number().int().min(16).max(512),
    mode: z.enum(["scale", "canvas"]).default("scale"),
  },
  (a) => s.resize(a.file, a.revision, a.width, a.height, a.mode),
);
tool(
  "recolor_project",
  "Rotate all or selected layer gradients/tints while retaining shading. Texture pixels stay unchanged. Locked layers are skipped unless included.",
  {
    file,
    revision,
    hue: z.number().min(-360).max(360),
    includeLocked: z.boolean().default(false),
    ids: z.array(z.string()).max(32).optional(),
  },
  (a) => s.recolor(a.file, a.revision, a.hue, a.includeLocked, a.ids),
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
tool(
  "inspect_creative",
  "Inspect exposed controls, saved variants, modifier order and valid numeric/curve/hue binding targets.",
  { file },
  (a) => s.creative(a.file),
  true,
);
tool(
  "edit_creative",
  "Apply a validated operation with revision checks: put/remove modifier or control, set control, capture/apply/remove variant, retime or stagger. Controls are evaluated from base fields, in stored order; curve bindings transform every key value. Use get_schema creative.",
  { file, revision, operation: creativeEditSchema },
  (a) => s.editCreative(a.file, a.revision, a.operation),
);
tool(
  "save_component",
  "Save selected editable layers with referenced assets, groups and macro bindings to a new portable .vfx-component.json. Preview references are excluded.",
  {
    file,
    revision,
    out: file,
    ids: z.array(z.string()).min(1).max(32),
    name: z.string().min(1).max(100),
  },
  (a) => s.saveComponent(a.file, a.out, a.ids, a.name, a.revision),
);
tool(
  "insert_component",
  "Insert a portable component, remapping all IDs/references and reusing identical textures. Returns inserted layer IDs. Instances are independent editable copies.",
  {
    file,
    revision,
    source: file,
    x: z.number().finite().min(-4096).max(4096).optional(),
    y: z.number().finite().min(-4096).max(4096).optional(),
  },
  (a) => s.insertComponent(a.file, a.revision, a.source, a.x, a.y),
);
tool(
  "start_variant_export",
  "Queue 1..8 saved variants from an immutable snapshot to a new directory. Uses one browser and supports progress/cancellation via existing job tools.",
  {
    file,
    revision,
    out: file,
    ids: z.array(z.string()).min(1).max(8),
    options: exportOptionsSchema,
  },
  async (a) => {
    await s.store.path(a.out, false);
    const snapshot = await s.store.read(a.file);
    if (snapshot.revision !== a.revision) throw Error("Revision conflict");
    return jobs.start((signal, progress) =>
      s.exportVariants(
        snapshot.project,
        snapshot.revision,
        a.out,
        a.ids,
        a.options,
        signal,
        progress,
      ),
    );
  },
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

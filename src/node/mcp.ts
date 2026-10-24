#!/usr/bin/env node
import { closeRenderPool, renderStats } from "./driver.js";
import { nodeCatalog, addCatalogNode } from "../core/catalog.js";
import { MAX_LAYERS } from "../core/limits.js";
import { MAX_BATCH_PROJECTS } from "../core/limits.js";
import { batchSchema } from "./batch.js";
import { analysisSchema } from "../core/analysis.js";
import { colorSchema, gradientSchema } from "../core/model.js";
import { Command } from "commander";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFile } from "node:fs/promises";
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
import { observationSchema } from "../core/observation.js";
import { editBatchSchema } from "../core/operations.js";
import { COORDINATES } from "../core/spatial.js";
import { describeBlueprint } from "../core/parameters.js";
import { stageDefaults, STAGE_COORDINATES } from "../core/stage.js";
import { ImageCache, type CachedImage } from "./image-cache.js";
import { toolError } from "./tool-errors.js";
import { AGENT_INSTRUCTIONS, AGENT_GUIDE } from "./agent-guide.js";
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
    instructions: AGENT_INSTRUCTIONS,
  },
);
const file = z.string().min(1).max(2048),
  revision = z.string().regex(/^[0-9a-f]{64}$/),
  patch = z.record(z.string(), z.unknown());
const images = new ImageCache();
const publicImage = ({ png: _png, ...metadata }: CachedImage) => metadata;
const failure = (error: unknown): CallToolResult => {
  const value = toolError(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
};
server.registerResource(
  "agent-guide",
  "vfx://guide",
  {
    title: "VFX Maker agent workflow",
    description:
      "Coordinate conventions, images, safe batches and observe-edit-verify examples.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: AGENT_GUIDE }],
  }),
);
server.registerResource(
  "preview-images",
  new ResourceTemplate("vfx://images/{id}", {
    list: async () => ({ resources: images.list() }),
  }),
  { title: "Immutable rendered PNG snapshots", mimeType: "image/png" },
  async (uri) => {
    const image = images.get(uri.href);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "image/png",
          blob: image.png.toString("base64"),
        },
      ],
    };
  },
);
server.registerPrompt(
  "effect_workflow",
  {
    title: "Create or refine an effect with visual feedback",
    description: "Plan an observe-edit-verify workflow for an effect task.",
    argsSchema: {
      request: z.string().min(1).max(4000),
      file: z.string().min(1).max(2048),
    },
  },
  async (a) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `${AGENT_GUIDE}\n\nTask: ${a.request}\nProject file: ${JSON.stringify(a.file)}\nUse actual MCP calls and view returned images when the host supports them. Report edits, resulting files, verification and any image-viewing limitation accurately.`,
        },
      },
    ],
  }),
);
const tool = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  handler: (args: z.infer<z.ZodObject<S>>) => unknown | Promise<unknown>,
  readOnly = false,
  destructiveHint = !readOnly,
) => {
  const schema = z.object(shape).strict();
  server.registerTool(
    name,
    {
      description,
      inputSchema: shape as z.ZodRawShape,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint,
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
        return failure(e);
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
    renderer: renderStats(),
    nodeCatalog:
      "get_node_catalog returns the real Add menu, limits/availability and validated example apply_edits operations. Studio and MCP share these factories.",
    projectBatch:
      "batch_projects prepares independent projects, edits and optional exports. dryRun writes nothing; real runs return a background job. Inspect result.ok and each item, even when the job completes. Transactions are per file, not across files.",
    qa: "analyze_project hashes straight RGBA at each requested frame (all export frames by default), rerenders in reverse order for parity, and optionally compares a root-scoped saved baseline. Peak activity is not a game hit marker.",
    coordinates: COORDINATES,
    agentWorkflow: {
      observe:
        "observe_project returns an annotated image, scene positions, isolated pixel bounds, timing, picks and revision. Try view=storyboard before editing.",
      edit: "apply_edits performs 1..64 atomic operations with one backup. Preview the same edits through observe_project with file/revision/edits; drafts do not write.",
      visionFallback:
        "images[].uri can be read through resources/read or saved by save_preview for a host image viewer. If no image viewer is available, use structured scene metadata; do not claim to have seen an image.",
      guide: "vfx://guide",
      schemas: ["observation", "edits"],
      resources: { maxImages: 16, maxBytes: 25165824, sessionLocal: true },
    },
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
    stage:
      "Optional separate camera scene: get_stage and get_schema stage/stage_placement, apply_edits configure_stage/place_stage_layer, render_preview and analyze_project view=stage, export options.view=stage. Same source layer frames on ground/upright/billboard planes; camera-baked output, not volumetric XYZ particles.",
    formats: ["gif", "spritesheet", "sequence", "godot", "unity"],
    limits: {
      layers: MAX_LAYERS,
      particleBirths: 4000,
      frames: 300,
      stageLayerPixels: 67108864,
      sourcePixels: 16777216,
      fileBytes: 4194304,
      pngInputSide: 1024,
      outputScale: [0.125, 8],
      pngOutputPixels: 16777216,
      gifOutputPixels: 33554432,
      paletteColors: [2, 256],
      observationInlinePngBytes: 2097152,
      observationTimes: 9,
      editOperations: 64,
      batchProjects: MAX_BATCH_PROJECTS,
    },
    imageProcessing:
      "Local PNG optimization needs no browser. Palette, scale, block and alpha reductions are lossy; default PNG recompression preserves decoded RGBA.",
    editing:
      "get_blueprint discovers control outputs, typed layer inputs, connections and ordered modifiers. apply_edits connect_control/disconnect_control routes parameters; edit_path_point maintains Bezier anchors and handles. Merge base fields directly when appropriate; curves are {t,value,ease} arrays, colors are {t,color} stops.",
  }),
  true,
);
tool(
  "get_node_catalog",
  "Discover the same searchable Add menu as Studio: layer generators, modifiers and Number controls, availability reasons and validated example atomic edits for this project. No browser or file write. Use an available entry.edit through apply_edits with the returned revision, optionally dryRun and observe_project edits first.",
  { file, layer: z.string().optional() },
  async (a) => {
    const { project, revision } = await s.store.read(a.file),
      layer = a.layer ?? project.layers.find((l) => !l.locked)?.id;
    if (a.layer && !project.layers.some((l) => l.id === a.layer))
      throw Error(`Unknown layer ${a.layer}`);
    const occupied = new Set([
      ...project.layers.map((l) => l.id),
      ...project.controls.map((c) => c.id),
      ...project.layers.flatMap((l) => l.modifiers.map((m) => m.id)),
    ]);
    return {
      revision,
      layer,
      entries: nodeCatalog(project, layer).map((entry) => {
        if (entry.disabled) return entry;
        let id = entry.id.replace(":", "-") + "-new",
          i = 2;
        while (occupied.has(id))
          id = entry.id.replace(":", "-") + "-new-" + i++;
        return {
          ...entry,
          edit: addCatalogNode(project, entry.id, id, layer).edit,
        };
      }),
      limits: { layers: 64, controls: 16, modifiersPerLayer: 8 },
    };
  },
  true,
);
tool(
  "get_stage",
  "Inspect the separate 2.5D/3D camera stage, world axes, plane placements and editable layer IDs. apply_edits configure_stage changes camera/defaults; place_stage_layer edits an unlocked plane. render_preview view=stage returns a real camera PNG, analyze_project view=stage verifies parity, and export options.view=stage bakes that camera into normal game assets. Default effect authoring/export remains 2D. No volumetric XYZ particles are simulated.",
  { file },
  async (a) => {
    const { project, revision } = await s.store.read(a.file);
    return {
      revision,
      configured: !!project.stage,
      stage: project.stage ?? stageDefaults(),
      coordinates: STAGE_COORDINATES,
      layers: project.layers.map((l) => ({
        id: l.id,
        name: l.name,
        locked: l.locked,
        visible: l.visible,
      })),
      render: { tool: "render_preview", file: a.file, view: "stage" },
      export: { options: { view: "stage" } },
    };
  },
  true,
);
tool(
  "get_blueprint",
  "Read the same control/layer graph used by Studio Blueprint: stable node IDs, typed valid parameter ports, binding modes/factors/offsets, lock state, modifier order and ready-to-use disconnect edits. No browser or asset payload. Use apply_edits connect_control/disconnect_control or creative operations; preview those edits with observe_project before committing. Binding indices are valid only for the returned revision.",
  { file },
  async (a) => {
    const { project, revision } = await s.store.read(a.file);
    return { revision, ...describeBlueprint(project) };
  },
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
      "edits",
      "observation",
      "analysis",
      "batch",
      "stage",
      "stage_placement",
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
  { file, revision, ids: z.array(z.string()).max(MAX_LAYERS) },
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
    ids: z.array(z.string()).min(1).max(MAX_LAYERS),
  },
  (a) => s.group(a.file, a.revision, a.id, a.name, a.ids),
);
tool(
  "transform_layers",
  "Move, rotate and uniformly scale selected layers around their mean anchor or an explicit pivot. Locked layers are skipped by default.",
  {
    file,
    revision,
    ids: z.array(z.string()).min(1).max(MAX_LAYERS),
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
  (a) =>
    s.importAsset(a.file, a.revision, a.png, {
      id: a.id,
      columns: a.columns,
      rows: a.rows,
      frames: a.frames,
    }),
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
    ids: z.array(z.string()).max(MAX_LAYERS).optional(),
  },
  (a) => s.recolor(a.file, a.revision, a.hue, a.includeLocked, a.ids),
);
tool(
  "set_gradient",
  "Set one solid color or a complete gradient on all/selected unlocked layers, including grayscale smoke. Fully selected hue controls reset to neutral; mixed hue bindings are detached only for changed layers. One revisioned edit and backup. Texture pixels stay unchanged.",
  {
    file,
    revision,
    colors: z.union([colorSchema, gradientSchema]),
    ids: z.array(z.string()).min(1).max(MAX_LAYERS).optional(),
    includeLocked: z.boolean().default(false),
  },
  (a) => s.gradient(a.file, a.revision, a.colors, a.includeLocked, a.ids),
);
tool(
  "preflight_export",
  "Estimate and validate export budgets before rendering. Reports used/limit per resource and memory estimates; creates no files and starts no browser.",
  {
    file,
    revision: revision.optional(),
    options: exportOptionsSchema.prefault({}),
  },
  (a) => s.preflight(a.file, a.options, a.revision),
  true,
);
tool(
  "analyze_project",
  "Numeric QA: exact straight-RGBA SHA-256 per frame, alpha/bounds/activity stats, reverse-order parity and optional baseline comparison. Defaults to all export frames. baseline/out are root-scoped JSON files; out must be fresh. Inspect ok; identical rerenders do not establish artistic correctness.",
  {
    file,
    revision: revision.optional(),
    ...analysisSchema.shape,
    baseline: file.optional(),
    out: file.optional(),
  },
  (a) =>
    s.analyze(
      a.file,
      { times: a.times, parity: a.parity, view: a.view },
      a.revision,
      a.baseline,
      a.out,
    ),
  false,
  false,
);
tool(
  "batch_projects",
  "Prepare 1..32 independent create/edit/export tasks; create/edit tasks may include an export. dryRun returns per-item validation without writing or rendering. Real runs use a background job with project-count progress; inspect result.ok and each result, including partial writes if an export fails. Cancellation preserves completed projects. Atomicity is per file. Paths must be distinct; options require out.",
  {
    items: batchSchema,
    dryRun: z.boolean().default(false),
  },
  async (a) => {
    const prepared = await s.prepareBatch(a.items);
    if (a.dryRun)
      return {
        dryRun: true,
        ok: prepared.results.every((r) => r.status === "ready"),
        atomicAcrossProjects: false,
        snapshotBytes: prepared.snapshotBytes,
        results: prepared.results,
      };
    return {
      ...jobs.start(
        (signal, progress) => s.executeBatch(prepared, signal, progress),
        "projects",
      ),
      progressUnit: "projects",
      items: prepared.results,
    };
  },
);
server.registerTool(
  "render_preview",
  {
    description:
      "Return a clean inline PNG, actual pixel bounds, coordinates, revision and a reusable image URI. Omit time to sample a visible frame. Prefer observe_project for annotated 2D views and layer positions. view=stage uses the saved 3D camera. Optional revision+edits renders an uncommitted draft without writing.",
    inputSchema: {
      file,
      revision: revision.optional(),
      edits: editBatchSchema.optional(),
      time: z.number().min(0).max(10).optional(),
      view: z.enum(["effect", "stage"]).default("effect"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (a) => {
    try {
      const result = await s.preview(
        a.file,
        a.time,
        a.view,
        a.revision,
        a.edits,
      );
      const image = images.put({
        name: "preview.png",
        file: a.file,
        revision: result.revision,
        draft: result.metadata.draft,
        role: "frame",
        width: result.metadata.canvas.width,
        height: result.metadata.canvas.height,
        time: result.metadata.time,
        png: result.png,
      });
      const metadata = { ...result.metadata, images: [publicImage(image)] };
      return {
        content: [
          {
            type: "image",
            mimeType: "image/png",
            data: result.png.toString("base64"),
          },
          {
            type: "text",
            text: JSON.stringify(metadata),
          },
          {
            type: "resource_link",
            uri: image.uri,
            name: image.name,
            mimeType: image.mimeType,
            size: image.bytes,
          },
        ],
        structuredContent: metadata,
      };
    } catch (e) {
      return failure(e);
    }
  },
);
const observeShape = {
  file,
  revision: revision.optional(),
  edits: editBatchSchema.optional(),
  includeImage: z.boolean().default(true),
  ...observationSchema.shape,
};
server.registerTool(
  "observe_project",
  {
    description:
      "Preferred visual inspection: a real annotated PNG plus compact scene coordinates, layer IDs, isolated rendered bounds, picks, controls and timing. view is frame, storyboard or layers. Omit time to find a representative visible moment. Optional revision+edits previews an uncommitted DRAFT. Clean PNGs are resource URIs; includeImage:false supports text-only hosts. No project writes.",
    inputSchema: observeShape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      const { file, revision, edits, includeImage, ...options } = z
        .object(observeShape)
        .strict()
        .parse(args);
      const result = await s.observe(file, options, revision, edits);
      const cached = result.report.images.map((info) =>
        images.put({
          ...info,
          file,
          revision: result.revision,
          draft: result.draft,
          png: result.files[info.name],
        }),
      );
      const annotated = cached.find((i) => i.role === "annotated")!;
      const { images: _images, ...scene } = result.report;
      const metadata = {
        file,
        revision: result.revision,
        draft: result.draft,
        ...(result.draft
          ? {
              proposedRevision: result.proposedRevision,
              changes: result.changes,
              nextAction:
                "This is a draft. Commit the same edits with apply_edits using this source revision, then observe the saved result.",
            }
          : {}),
        scene,
        images: cached.map(publicImage),
      };
      const content: CallToolResult["content"] = [];
      const inlineBytes =
        Math.ceil(annotated.bytes / 3) * 4 +
        Buffer.byteLength(JSON.stringify(metadata)) * 2 +
        32768;
      const payload = {
        ...metadata,
        imageDelivery: {
          inline: includeImage && inlineBytes <= 3.75 * 1024 * 1024,
          reason: !includeImage
            ? "requested-text-only"
            : inlineBytes > 3.75 * 1024 * 1024
              ? "response-budget; read an image URI or save_preview instead"
              : "inline-and-resources",
        },
      };
      if (includeImage && inlineBytes <= 3.75 * 1024 * 1024)
        content.push({
          type: "image",
          mimeType: "image/png",
          data: annotated.png.toString("base64"),
        });
      content.push({ type: "text", text: JSON.stringify(payload) });
      for (const image of cached)
        content.push({
          type: "resource_link",
          uri: image.uri,
          name: image.name,
          mimeType: image.mimeType,
          size: image.bytes,
        });
      return { content, structuredContent: payload };
    } catch (e) {
      return failure(e);
    }
  },
);
tool(
  "apply_edits",
  "Apply 1..64 validated operations atomically with one revision check and one backup. A failed operation writes nothing. Use get_schema edits. set_path_points supports canvas/normalized coordinates at a project time; creative wraps existing modifier/control/timing operations. dryRun validates without writing; observe_project with the same edits renders a draft.",
  {
    file,
    revision,
    edits: editBatchSchema,
    dryRun: z.boolean().default(false),
  },
  (a) => s.apply(a.file, a.revision, a.edits, a.dryRun),
);
server.registerTool(
  "save_preview",
  {
    description:
      "Save a cached PNG URI returned by observe_project/render_preview to a fresh .png inside --root. Returns an absolute server path for a local host's image viewer, dimensions, hash and source revision. Existing paths are never overwritten.",
    inputSchema: {
      uri: z.string().regex(/^vfx:\/\/images\/[a-f0-9]{64}$/),
      out: file,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (a) => {
    try {
      if (!/\.png$/i.test(a.out))
        throw Error("Preview output must be a .png file");
      const image = images.get(a.uri),
        path = await s.store.path(a.out, false);
      await writeFile(path, image.png, { flag: "wx" });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...publicImage(image),
              out: a.out,
              absolutePath: path,
            }),
          },
        ],
        structuredContent: {
          ...publicImage(image),
          out: a.out,
          absolutePath: path,
        },
      };
    } catch (e) {
      return failure(e);
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
    ids: z.array(z.string()).min(1).max(MAX_LAYERS),
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
  await closeRenderPool();
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

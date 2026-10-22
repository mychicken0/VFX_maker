import * as fs from "node:fs/promises";
import { z } from "zod";
import { groupLayers, transformLayers, putKeyframe } from "../core/editing.js";
import { getPreset, PRESETS } from "../core/presets.js";
import {
  assetSchema,
  layerSchema,
  parseProject,
  projectSchema,
  type Project,
} from "../core/model.js";
import type { ExportOptions } from "../render/export.js";
import { optimizePng, inspectPng, decodePng } from "../core/pixels.js";
import { pixelOptionsSchema, type PixelInput } from "../core/pixel-options.js";
import { exportOptionsSchema, exportPlan } from "../core/export-options.js";
import {
  recolorProject,
  replaceAssetPng,
  resizeProject,
} from "../core/authoring.js";
import { Store, revision as hash } from "./store.js";
import { render } from "./driver.js";
import {
  editCreative,
  creativeCapabilities,
  creativeEditSchema,
  type CreativeEdit,
} from "../core/creative.js";
import { modifierSchema, controlSchema } from "../core/creative-schema.js";
import { makeComponent, insertComponent } from "../core/components.js";
import { variantPlan } from "../core/variants.js";
import {
  applyEdits,
  editBatchSchema,
  summarizeChanges,
  updateLayerData,
  updateProjectData,
  removeLayerData,
  reorderLayerData,
} from "../core/operations.js";
import {
  observationSchema,
  pixelMetrics,
  type ObservationInput,
  type ObservationReport,
} from "../core/observation.js";
import { COORDINATES } from "../core/spatial.js";
import { serialize } from "../core/api.js";
export class Service {
  constructor(readonly store: Store) {}
  presets() {
    return PRESETS.map(({ id, name, description, tags }) => ({
      id,
      name,
      description,
      tags,
    }));
  }
  schema(
    kind:
      | "project"
      | "layer"
      | "asset"
      | "pixels"
      | "export"
      | "creative"
      | "modifier"
      | "control"
      | "edits"
      | "observation",
  ) {
    return z.toJSONSchema(
      {
        project: projectSchema,
        layer: layerSchema,
        asset: assetSchema,
        pixels: pixelOptionsSchema,
        export: exportOptionsSchema,
        creative: creativeEditSchema,
        modifier: modifierSchema,
        control: controlSchema,
        edits: editBatchSchema,
        observation: observationSchema,
      }[kind],
    );
  }
  create(
    file: string,
    options: { preset?: string; project?: unknown; seed?: number } = {},
  ) {
    const project = options.project
      ? parseProject(options.project)
      : getPreset(options.preset);
    if (options.seed !== undefined) project.seed = options.seed;
    return this.store.create(file, project);
  }
  async creative(file: string) {
    const { project, revision } = await this.store.read(file);
    return { revision, ...creativeCapabilities(project) };
  }
  editCreative(file: string, revision: string, operation: CreativeEdit) {
    return this.store.edit(file, revision, (p) => editCreative(p, operation));
  }
  async saveComponent(
    file: string,
    out: string,
    ids: string[],
    name: string,
    expected: string,
  ) {
    const { project, revision } = await this.store.read(file);
    if (expected !== revision) throw Error("Revision conflict");
    const component = makeComponent(project, ids, name),
      dest = await this.store.path(out, false);
    const text = JSON.stringify(component, null, 2) + "\n";
    if (Buffer.byteLength(text) > 4194304)
      throw Error("Component exceeds 4 MiB");
    await fs.writeFile(dest, text, { flag: "wx" });
    return { file: out, revision, layers: ids.length };
  }
  async insertComponent(
    file: string,
    revision: string,
    source: string,
    x?: number,
    y?: number,
  ) {
    const path = await this.store.path(source);
    if ((await fs.stat(path)).size > 4194304)
      throw Error("Component exceeds 4 MiB");
    const component: unknown = JSON.parse(await fs.readFile(path, "utf8"));
    let ids: string[] = [];
    const result = await this.store.edit(file, revision, (p) => {
      const inserted = insertComponent(p, component, {
        x: x ?? p.canvas.width / 2,
        y: y ?? p.canvas.height / 2,
      });
      ids = inserted.ids;
      return inserted.project;
    });
    return { ...result, ids };
  }
  async exportVariants(
    project: Project,
    revision: string,
    out: string,
    ids: string[],
    options: ExportOptions,
    signal?: AbortSignal,
    progress?: (a: number, b: number) => void,
  ) {
    variantPlan(project, ids, options);
    await this.store.path(out, false);
    const files = await render(
      project,
      { options, variants: ids },
      signal,
      progress,
    );
    return { ...(await this.store.publish(out, files, signal)), revision };
  }
  update(file: string, revision: string, patch: unknown) {
    return this.store.edit(file, revision, (p) => updateProjectData(p, patch));
  }
  group(
    file: string,
    revision: string,
    id: string,
    name: string,
    ids: string[],
  ) {
    return this.store.edit(file, revision, (p) =>
      groupLayers(p, id, name, ids),
    );
  }
  transform(
    file: string,
    revision: string,
    ids: string[],
    options: Parameters<typeof transformLayers>[2],
  ) {
    return this.store.edit(file, revision, (p) =>
      transformLayers(p, ids, options),
    );
  }
  keyframe(
    file: string,
    revision: string,
    id: string,
    channel: string,
    time: number,
    value: number,
    ease: "linear" | "smooth" | "hold" = "linear",
  ) {
    return this.store.edit(file, revision, (p) =>
      putKeyframe(p, id, channel, time, value, ease),
    );
  }
  updateLayer(file: string, revision: string, id: string, patch: unknown) {
    return this.store.edit(file, revision, (p) =>
      updateLayerData(p, id, patch),
    );
  }
  addLayer(file: string, revision: string, layer: unknown) {
    return this.store.edit(file, revision, (p) => ({
      ...p,
      layers: [...p.layers, layerSchema.parse(layer)],
    }));
  }
  removeLayer(file: string, revision: string, id: string) {
    return this.store.edit(file, revision, (p) => removeLayerData(p, id));
  }
  reorder(file: string, revision: string, ids: string[]) {
    return this.store.edit(file, revision, (p) => reorderLayerData(p, ids));
  }
  async importAsset(
    file: string,
    revision: string,
    png: string,
    options: { id: string; columns?: number; rows?: number; frames?: number },
  ) {
    const path = await this.store.path(png),
      stat = await fs.stat(path);
    if (stat.size > 1048576) throw new Error("PNG exceeds 1 MiB");
    const bytes = await fs.readFile(path);
    const { width, height } = inspectPng(bytes);
    const asset = assetSchema.parse({
      ...options,
      name: png.split(/[\\/]/).at(-1),
      data: `data:image/png;base64,${bytes.toString("base64")}`,
      width,
      height,
    });
    return this.store.edit(file, revision, (p) => ({
      ...p,
      assets: [...p.assets, asset],
    }));
  }
  async optimize(png: string, out: string, options: PixelInput = {}) {
    const path = await this.store.path(png),
      dest = await this.store.path(out, false);
    if ((await fs.stat(path)).size > 4194304)
      throw new Error("PNG exceeds 4 MiB");
    const result = optimizePng(await fs.readFile(path), options);
    await fs.writeFile(dest, result.png, { flag: "wx" });
    return {
      file: dest,
      stats: result.stats,
      sha256: hash(Buffer.from(result.png)),
    };
  }
  async optimizeAsset(
    file: string,
    revision: string,
    id: string,
    options: PixelInput = {},
  ) {
    let stats: ReturnType<typeof optimizePng>["stats"] | undefined;
    const result = await this.store.edit(file, revision, (project) => {
      const asset = project.assets.find((a) => a.id === id);
      if (!asset) throw new Error(`Unknown asset ${id}`);
      const optimized = optimizePng(
        Buffer.from(asset.data.split(",")[1], "base64"),
        options,
      );
      stats = optimized.stats;
      return replaceAssetPng(
        project,
        id,
        optimized.png,
        optimized.bitmap.width,
        optimized.bitmap.height,
      );
    });
    return { ...result, stats };
  }
  resize(
    file: string,
    revision: string,
    width: number,
    height: number,
    mode: "scale" | "canvas" = "scale",
  ) {
    return this.store.edit(file, revision, (project) =>
      resizeProject(project, width, height, mode),
    );
  }
  recolor(
    file: string,
    revision: string,
    hue: number,
    includeLocked = false,
    ids?: string[],
  ) {
    return this.store.edit(file, revision, (p) =>
      recolorProject(p, hue, includeLocked, ids),
    );
  }
  async observe(
    file: string,
    options: ObservationInput = {},
    expected?: string,
    edits?: unknown,
  ) {
    const snapshot = await this.store.read(file);
    if (expected && snapshot.revision !== expected)
      throw Error(
        "Revision conflict: inspect the project again before observing",
      );
    if (edits !== undefined && !expected)
      throw Error("A revision is required to preview uncommitted edits");
    const project =
      edits === undefined
        ? snapshot.project
        : applyEdits(snapshot.project, edits);
    const files = await render(project, {
      observation: observationSchema.parse(options),
      draft: edits !== undefined,
    });
    const report = JSON.parse(
      files["observation.json"].toString("utf8"),
    ) as ObservationReport;
    delete files["observation.json"];
    return {
      report,
      files,
      file,
      revision: snapshot.revision,
      draft: edits !== undefined,
      ...(edits === undefined
        ? {}
        : {
            changes: summarizeChanges(snapshot.project, project),
            proposedRevision: hash(serialize(project)),
          }),
    };
  }
  async apply(file: string, revision: string, edits: unknown, dryRun = false) {
    const operations = editBatchSchema.parse(edits);
    if (dryRun) {
      const before = await this.store.read(file);
      if (before.revision !== revision)
        throw Error(
          "Revision conflict: inspect the project again before editing",
        );
      const after = applyEdits(before.project, operations);
      return {
        file,
        revision,
        dryRun: true,
        proposedRevision: hash(serialize(after)),
        operations: operations.length,
        changes: summarizeChanges(before.project, after),
      };
    }
    let changes: ReturnType<typeof summarizeChanges> | undefined;
    const after = await this.store.edit(file, revision, (p) => {
      const next = applyEdits(p, operations);
      changes = summarizeChanges(p, next);
      return next;
    });
    return {
      file,
      revision: after.revision,
      dryRun: false,
      operations: operations.length,
      changes,
    };
  }
  async preview(file: string, time?: number) {
    if (time === undefined) {
      const result = await this.observe(file, {
        view: "frame",
        grid: false,
        guides: false,
        includeReference: false,
        scale: 1,
      });
      const frame = result.report.frames[0];
      return {
        png: result.files["frame-0.png"],
        revision: result.revision,
        metadata: {
          file,
          revision: result.revision,
          time: frame.time,
          canvas: result.report.canvas,
          coordinates: COORDINATES,
          pixels: frame,
          automaticTime: true,
          warnings: result.report.warnings,
        },
      };
    }
    const { project, revision } = await this.store.read(file),
      files = await render(project, { time });
    const png = files["preview.png"],
      bitmap = decodePng(png),
      pixels = pixelMetrics(bitmap.rgba, bitmap.width, bitmap.height);
    return {
      png,
      revision,
      metadata: {
        file,
        revision,
        time,
        canvas: project.canvas,
        coordinates: COORDINATES,
        pixels,
        automaticTime: false,
        warnings: pixels.visiblePixels
          ? []
          : [
              {
                code: "EMPTY_FRAME",
                message:
                  "Requested frame is empty. Use observe_project with automatic time or storyboard view to inspect timing and layer positions.",
              },
            ],
      },
    };
  }
  async export(
    file: string,
    out: string,
    options: ExportOptions,
    expected?: string,
    signal?: AbortSignal,
    progress?: (a: number, b: number) => void,
  ) {
    await this.store.path(out, false);
    const { project, revision } = await this.store.read(file);
    if (expected && expected !== revision)
      throw new Error(
        "Revision conflict: inspect the project again before exporting",
      );
    return this.exportSnapshot(
      project,
      revision,
      out,
      options,
      signal,
      progress,
    );
  }
  async exportSnapshot(
    project: Project,
    revision: string,
    out: string,
    options: ExportOptions,
    signal?: AbortSignal,
    progress?: (a: number, b: number) => void,
  ) {
    exportPlan(project, options);
    const files = await render(project, { options }, signal, progress);
    return { ...(await this.store.publish(out, files, signal)), revision };
  }
}

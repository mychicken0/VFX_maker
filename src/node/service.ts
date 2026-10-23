import * as fs from "node:fs/promises";
import { z } from "zod";
import { groupLayers, transformLayers, putKeyframe } from "../core/editing.js";
import { getPreset, PRESETS } from "../core/presets.js";
import {
  assetSchema,
  layerSchema,
  parseProject,
  projectSchema,
  type Gradient,
  type Project,
} from "../core/model.js";
import type { ExportOptions } from "../render/export.js";
import { optimizePng, inspectPng, decodePng } from "../core/pixels.js";
import { pixelOptionsSchema, type PixelInput } from "../core/pixel-options.js";
import {
  exportOptionsSchema,
  exportPlan,
  preflightExport,
} from "../core/export-options.js";
import {
  recolorProject,
  setProjectGradient,
  replaceAssetPng,
  resizeProject,
} from "../core/authoring.js";
import { Store, revision as hash } from "./store.js";
import { render, renderStats } from "./driver.js";
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
import {
  analysisSchema,
  analysisTimes,
  analysisBaselineSchema,
  compareAnalysis,
  type AnalysisInput,
  type AnalysisReport,
} from "../core/analysis.js";
import {
  batchSchema,
  type BatchPreparation,
  type BatchItemResult,
} from "./batch.js";
import { MAX_BATCH_SOURCE_BYTES } from "../core/limits.js";
import { toolError } from "./tool-errors.js";
export class Service {
  constructor(readonly store: Store) {}
  gradient(
    file: string,
    revision: string,
    colors: Gradient | string,
    includeLocked = false,
    ids?: string[],
  ) {
    return this.store.edit(file, revision, (p) =>
      setProjectGradient(p, colors, includeLocked, ids),
    );
  }
  async preflight(
    file: string,
    options: ExportOptions = {},
    expected?: string,
  ) {
    const snapshot = await this.store.read(file);
    if (expected && expected !== snapshot.revision)
      throw Error("Revision conflict");
    return {
      file,
      revision: snapshot.revision,
      ...preflightExport(snapshot.project, options),
    };
  }
  async analyze(
    file: string,
    options: AnalysisInput = {},
    expected?: string,
    baselineFile?: string,
    out?: string,
  ) {
    const snapshot = await this.store.read(file);
    if (expected && snapshot.revision !== expected)
      throw Error("Revision conflict");
    let baseline: unknown;
    if (baselineFile) {
      const path = await this.store.path(baselineFile);
      if ((await fs.stat(path)).size > 4194304)
        throw Error("Baseline exceeds 4 MiB");
      baseline = analysisBaselineSchema.parse(
        JSON.parse(await fs.readFile(path, "utf8")),
      );
    }
    const parsed = analysisSchema.parse({
      ...options,
      ...(options.times === undefined && baseline
        ? {
            times: analysisBaselineSchema
              .parse(baseline)
              .frames.map((f) => f.time),
          }
        : {}),
    });
    analysisTimes(snapshot.project, parsed);
    const destination = out ? await this.store.path(out, false) : undefined;
    const files = await render(snapshot.project, { analysis: parsed }),
      analysis = JSON.parse(
        files["analysis.json"].toString(),
      ) as AnalysisReport;
    const comparison = baseline
      ? compareAnalysis(analysis, baseline)
      : undefined;
    const report = {
      ...analysis,
      file,
      revision: snapshot.revision,
      ok: analysis.parity.passed !== false && comparison?.passed !== false,
      ...(comparison ? { baseline: comparison } : {}),
      renderer: renderStats(),
    };
    if (destination)
      await fs.writeFile(destination, JSON.stringify(report, null, 2) + "\n", {
        flag: "wx",
      });
    return { ...report, ...(out ? { out } : {}) };
  }
  async prepareBatch(input: unknown): Promise<BatchPreparation> {
    const tasks = batchSchema.parse(input),
      ready: BatchPreparation["ready"] = [],
      results: BatchItemResult[] = [],
      seen = new Set<string>();
    let snapshotBytes = 0;
    const duplicates: string[] = [];
    for (const [index, task] of tasks.entries()) {
      try {
        const paths = [
          await this.store.path(task.file, task.action !== "create"),
          ...(task.out ? [await this.store.path(task.out, false)] : []),
        ];
        for (const path of paths) {
          if (seen.has(path)) duplicates.push(path);
          seen.add(path);
        }
        if (task.options && !task.out)
          throw Error("Export options require an output directory");
        let project: Project, sourceRevision: string | undefined;
        if (task.action === "create") {
          if (task.project !== undefined && task.preset)
            throw Error("Choose project or preset, not both");
          project =
            task.project !== undefined
              ? parseProject(task.project)
              : getPreset(task.preset);
          if (task.seed !== undefined)
            project = parseProject({ ...project, seed: task.seed });
          if (task.edits) project = applyEdits(project, task.edits);
        } else {
          const snapshot = await this.store.read(task.file);
          if (snapshot.revision !== task.revision)
            throw Error("Revision conflict");
          sourceRevision = snapshot.revision;
          project =
            task.action === "edit"
              ? applyEdits(snapshot.project, task.edits)
              : snapshot.project;
        }
        if (task.out) exportPlan(project, task.options ?? {});
        const text = serialize(project),
          revision = hash(text);
        snapshotBytes += Buffer.byteLength(text);
        if (Buffer.byteLength(text) > 4194304)
          throw Error("Project exceeds 4 MiB");
        ready.push({
          index,
          task,
          project,
          revision: task.action === "export" ? sourceRevision! : revision,
          sourceRevision,
        });
        results.push({
          index,
          file: task.file,
          action: task.action,
          status: "ready",
          revision: task.action === "export" ? sourceRevision : revision,
        });
      } catch (e) {
        results.push({
          index,
          file: task.file,
          action: task.action,
          status: "failed",
          error: toolError(e).error,
        });
      }
    }
    if (duplicates.length)
      throw Error("Batch paths must be distinct: " + duplicates.join(", "));
    if (snapshotBytes > MAX_BATCH_SOURCE_BYTES)
      throw Error("Batch snapshots exceed 16 MiB; split the batch");
    return { ready, results, snapshotBytes };
  }
  async executeBatch(
    prepared: BatchPreparation,
    signal?: AbortSignal,
    progress?: (a: number, b: number) => void,
  ) {
    const results = structuredClone(prepared.results),
      total = results.length;
    let completed = results.filter((r) => r.status === "failed").length;
    progress?.(completed, total);
    for (const item of prepared.ready) {
      const result = results[item.index],
        task = item.task;
      if (signal?.aborted) {
        result.status = "cancelled";
        completed++;
        progress?.(completed, total);
        continue;
      }
      let written = false;
      try {
        signal?.throwIfAborted();
        if (task.action === "create") {
          const saved = await this.store.create(task.file, item.project);
          result.revision = saved.revision;
          written = true;
        } else if (task.action === "edit") {
          const saved = await this.store.edit(
            task.file,
            item.sourceRevision!,
            () => item.project,
          );
          result.revision = saved.revision;
          written = true;
        }
        if (task.out)
          result.export = await this.exportSnapshot(
            item.project,
            result.revision!,
            task.out,
            task.options ?? {},
            signal,
          );
        result.status = "succeeded";
      } catch (e) {
        result.status = written
          ? "partial"
          : signal?.aborted
            ? "cancelled"
            : "failed";
        result.error = toolError(e).error;
      }
      completed++;
      progress?.(completed, total);
    }
    return {
      kind: "project-batch",
      cancelled: signal?.aborted ?? false,
      ok: results.every((r) => r.status === "succeeded"),
      atomicAcrossProjects: false,
      results,
    };
  }
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
      | "observation"
      | "analysis"
      | "batch",
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
        analysis: analysisSchema,
        batch: batchSchema,
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
    await this.store.path(out, false);
    const files = await render(project, { options }, signal, progress);
    return { ...(await this.store.publish(out, files, signal)), revision };
  }
}

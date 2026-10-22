import * as fs from "node:fs/promises";
import { z } from "zod";
import {
  cleanupGroups,
  groupLayers,
  transformLayers,
  putKeyframe,
} from "../core/editing.js";
import { getPreset, PRESETS } from "../core/presets.js";
import {
  assetSchema,
  layerSchema,
  parseProject,
  projectSchema,
  type Project,
} from "../core/model.js";
import type { ExportOptions } from "../render/export.js";
import { optimizePng, inspectPng } from "../core/pixels.js";
import { pixelOptionsSchema, type PixelInput } from "../core/pixel-options.js";
import { exportOptionsSchema, exportPlan } from "../core/export-options.js";
import {
  recolorProject,
  replaceAssetPng,
  resizeProject,
} from "../core/authoring.js";
import { Store, merge, revision as hash } from "./store.js";
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
      | "control",
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
    return this.store.edit(file, revision, (p) => merge(p, patch));
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
    return this.store.edit(file, revision, (p) => {
      const i = p.layers.findIndex((l) => l.id === id);
      if (i < 0) throw new Error(`Unknown layer ${id}`);
      if (
        p.layers[i].locked &&
        !(
          patch &&
          typeof patch === "object" &&
          Object.keys(patch).length === 1 &&
          "locked" in patch &&
          patch.locked === false
        )
      )
        throw new Error("Unlock the layer before editing");
      p.layers[i] = layerSchema.parse(merge(p.layers[i], patch));
      return p;
    });
  }
  addLayer(file: string, revision: string, layer: unknown) {
    return this.store.edit(file, revision, (p) => ({
      ...p,
      layers: [...p.layers, layerSchema.parse(layer)],
    }));
  }
  removeLayer(file: string, revision: string, id: string) {
    return this.store.edit(file, revision, (p) => {
      const l = p.layers.find((l) => l.id === id);
      if (!l) throw new Error(`Unknown layer ${id}`);
      if (l.locked) throw new Error("Unlock the layer before removing it");
      return cleanupGroups({
        ...p,
        layers: p.layers.filter((l) => l.id !== id),
      });
    });
  }
  reorder(file: string, revision: string, ids: string[]) {
    return this.store.edit(file, revision, (p) => {
      if (
        ids.length !== p.layers.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !p.layers.some((l) => l.id === id))
      )
        throw new Error(
          "Supply each existing layer ID exactly once, bottom to top",
        );
      return {
        ...p,
        layers: ids.map((id) => p.layers.find((l) => l.id === id)!),
      };
    });
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
  async preview(file: string, time = 0.3) {
    const { project, revision } = await this.store.read(file),
      files = await render(project, { time });
    return { png: files["preview.png"], revision };
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

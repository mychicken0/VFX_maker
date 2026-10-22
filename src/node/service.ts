import * as fs from "node:fs/promises";
import { z } from "zod";
import { getPreset, PRESETS } from "../core/presets.js";
import {
  assetSchema,
  layerSchema,
  parseProject,
  projectSchema,
  type Project,
} from "../core/model.js";
import type { ExportOptions } from "../render/export.js";
import { Store, merge } from "./store.js";
import { render } from "./driver.js";
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
  schema(kind: "project" | "layer" | "asset") {
    return z.toJSONSchema(
      { project: projectSchema, layer: layerSchema, asset: assetSchema }[kind],
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
  update(file: string, revision: string, patch: unknown) {
    return this.store.edit(file, revision, (p) => merge(p, patch));
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
      return { ...p, layers: p.layers.filter((l) => l.id !== id) };
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
    if (
      bytes.length < 33 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("Input is not a PNG");
    for (let i = 8; i + 12 <= bytes.length;) {
      const size = bytes.readUInt32BE(i);
      if (bytes.toString("ascii", i + 4, i + 8) === "acTL")
        throw new Error("APNG is not supported; use a static flipbook sheet");
      i += size + 12;
    }
    const asset = assetSchema.parse({
      ...options,
      name: png.split(/[\\/]/).at(-1),
      data: `data:image/png;base64,${bytes.toString("base64")}`,
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    });
    return this.store.edit(file, revision, (p) => ({
      ...p,
      assets: [...p.assets, asset],
    }));
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
    const files = await render(project, { options }, signal, progress);
    return { ...(await this.store.publish(out, files, signal)), revision };
  }
}

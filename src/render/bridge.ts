import { parseProject, projectSchema, layerSchema } from "../core/model.js";
import { PRESETS } from "../core/presets.js";
import { exportEffect, preview, toBase64 } from "./export.js";
import type { ExportOptions } from "./export.js";
import { VfxRenderer } from "./pixi.js";
import { z } from "zod";
import { exportVariants } from "./variants.js";
import { observe } from "./observation.js";
import type { ObservationInput } from "../core/observation.js";
import { analyze } from "./analysis.js";
import type { AnalysisInput } from "../core/analysis.js";
const renderer = await VfxRenderer.create();
document.body.append(renderer.canvas);
let stageRenderer: Promise<import("./stage.js").StageRenderer> | undefined;
const stage = () =>
  (stageRenderer ??= import("./stage.js")
    .then((m) => m.StageRenderer.create())
    .catch((e) => {
      stageRenderer = undefined;
      throw e;
    }));
const bridge = {
  async analyze(value: unknown, options: AnalysisInput = {}) {
    const report = await analyze(
      options.view === "stage" ? await stage() : renderer,
      parseProject(value),
      options,
    );
    return {
      "analysis.json": toBase64(
        new TextEncoder().encode(JSON.stringify(report)),
      ),
    };
  },
  async observe(value: unknown, options: ObservationInput, draft = false) {
    const result = await observe(renderer, parseProject(value), options, draft);
    return Object.fromEntries(
      Object.entries({
        ...result.files,
        "observation.json": new TextEncoder().encode(
          JSON.stringify(result.report),
        ),
      }).map(([name, bytes]) => [name, toBase64(bytes)]),
    );
  },
  async preview(
    value: unknown,
    time: number,
    view: "effect" | "stage" = "effect",
  ) {
    const p = parseProject(value);
    const target = view === "stage" ? await stage() : renderer;
    await target.setProject(p);
    return toBase64(await preview(target, p, time));
  },
  async export(value: unknown, options: ExportOptions) {
    const p = parseProject(value);
    const target = options.view === "stage" ? await stage() : renderer;
    await target.setProject(p);
    const files = await exportEffect(target, p, options, (completed, total) => {
      window.dispatchEvent(
        new CustomEvent("vfx-progress", { detail: { completed, total } }),
      );
    });
    return Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [name, toBase64(bytes)]),
    );
  },
  presets: PRESETS,
  async variants(value: unknown, ids: string[], options: ExportOptions) {
    const files = await exportVariants(
      renderer,
      parseProject(value),
      ids,
      options,
      (completed, total) =>
        window.dispatchEvent(
          new CustomEvent("vfx-progress", { detail: { completed, total } }),
        ),
    );
    return Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [name, toBase64(bytes)]),
    );
  },
  schemas: {
    project: z.toJSONSchema(projectSchema),
    layer: z.toJSONSchema(layerSchema),
  },
};
declare global {
  interface Window {
    vfx: typeof bridge;
  }
}
window.vfx = bridge;

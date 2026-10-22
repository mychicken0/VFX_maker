import { parseProject, projectSchema, layerSchema } from "../core/model.js";
import { PRESETS } from "../core/presets.js";
import { exportEffect, preview, toBase64 } from "./export.js";
import type { ExportOptions } from "./export.js";
import { VfxRenderer } from "./pixi.js";
import { z } from "zod";
const renderer = await VfxRenderer.create();
document.body.append(renderer.canvas);
const bridge = {
  async preview(value: unknown, time: number) {
    const p = parseProject(value);
    await renderer.setProject(p);
    return toBase64(await preview(renderer, p, time));
  },
  async export(value: unknown, options: ExportOptions) {
    const p = parseProject(value);
    await renderer.setProject(p);
    const files = await exportEffect(
      renderer,
      p,
      options,
      (completed, total) => {
        window.dispatchEvent(
          new CustomEvent("vfx-progress", { detail: { completed, total } }),
        );
      },
    );
    return Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [name, toBase64(bytes)]),
    );
  },
  presets: PRESETS,
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

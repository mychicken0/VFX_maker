import { parseProject, type Project } from "../core/model.js";
import { type ExportOptions } from "../core/export-options.js";
import { variantPlan } from "../core/variants.js";
import { exportEffect, type ExportFiles, type Progress } from "./export.js";
import type { VfxRenderer } from "./pixi.js";

/** Render sequentially in one context, keeping browser and GPU memory bounded. */
export async function exportVariants(
  renderer: VfxRenderer,
  value: Project,
  ids: string[],
  options: ExportOptions,
  progress?: Progress,
  signal?: AbortSignal,
): Promise<ExportFiles> {
  const p = parseProject(value),
    variants = variantPlan(p, ids, options),
    total = variants.reduce((n, v) => n + v.plan.count, 0);
  const files: ExportFiles = {
    "variants.vfx.json": new TextEncoder().encode(
      JSON.stringify(
        { ...p, editor: { ...p.editor, reference: undefined } },
        null,
        2,
      ),
    ),
  };
  let completed = 0,
    bytes = files["variants.vfx.json"].length;
  for (const variant of variants) {
    signal?.throwIfAborted();
    await renderer.setProject(variant.project);
    const rendered = await exportEffect(
      renderer,
      variant.project,
      options,
      (done) => progress?.(completed + done, total),
      signal,
    );
    for (const [name, content] of Object.entries(rendered)) {
      bytes += content.length;
      if (bytes > 67108864)
        throw Error(
          "Variant output exceeds 64 MiB; export fewer variants or reduce output size",
        );
      files[`${variant.id}/${name}`] = content;
    }
    completed += variant.plan.count;
  }
  return files;
}

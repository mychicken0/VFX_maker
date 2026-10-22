import { applyVariant } from "./parameters.js";
import { exportPlan, type ExportOptions } from "./export-options.js";
import type { Project } from "./model.js";

export function variantPlan(p: Project, ids: string[], options: ExportOptions) {
  if (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length)
    throw Error("Choose 1..8 distinct variants");
  const variants = ids.map((id) => {
    const project = applyVariant(p, id);
    return { id, project, plan: exportPlan(project, options) };
  });
  if (
    variants.reduce(
      (n, v) => n + v.plan.count * p.canvas.width * p.canvas.height,
      0,
    ) > 33554432
  )
    throw Error(
      "Variant batch exceeds 32 million source pixels; export fewer variants or frames",
    );
  return variants;
}

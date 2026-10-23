import { z } from "zod";
import { type Project } from "../core/model.js";
import { editBatchSchema } from "../core/operations.js";
import { exportOptionsSchema } from "../core/export-options.js";
import { MAX_BATCH_PROJECTS } from "../core/limits.js";
const file = z.string().min(1).max(2048),
  revision = z.string().regex(/^[0-9a-f]{64}$/);
export const batchItemSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      file,
      preset: z.string().max(100).optional(),
      project: z.unknown().optional(),
      seed: z.number().int().min(0).max(0xffffffff).optional(),
      edits: editBatchSchema.optional(),
      out: file.optional(),
      options: exportOptionsSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("edit"),
      file,
      revision,
      edits: editBatchSchema,
      out: file.optional(),
      options: exportOptionsSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("export"),
      file,
      revision,
      out: file,
      options: exportOptionsSchema.prefault({}),
    })
    .strict(),
]);
export const batchSchema = z
  .array(batchItemSchema)
  .min(1)
  .max(MAX_BATCH_PROJECTS);
export type BatchItem = z.infer<typeof batchItemSchema>;
export type BatchPrepared = {
  index: number;
  task: BatchItem;
  project: Project;
  revision: string;
  sourceRevision?: string;
};
export interface BatchItemResult {
  index: number;
  file: string;
  action: BatchItem["action"];
  status: "ready" | "succeeded" | "failed" | "partial" | "cancelled";
  revision?: string;
  error?: unknown;
  export?: unknown;
}
export interface BatchPreparation {
  ready: BatchPrepared[];
  results: BatchItemResult[];
  snapshotBytes: number;
}

import { z } from "zod";
import { EditBatchError } from "../core/operations.js";
import { readableError } from "../core/errors.js";
import { ExportBudgetError } from "../core/export-options.js";
export function toolError(error: unknown) {
  const batch = error instanceof EditBatchError ? error : undefined;
  const cause = batch ? batch.original : error;
  const message = readableError(cause).slice(0, 2000);
  const errno =
    cause && typeof cause === "object" && "code" in cause
      ? cause.code
      : undefined;
  let code = "INVALID_OPERATION";
  if (cause instanceof ExportBudgetError) code = "LIMIT_EXCEEDED";
  else if (cause instanceof z.ZodError) code = "VALIDATION_ERROR";
  else if (errno === "ENOENT") code = "FILE_NOT_FOUND";
  else if (/revision conflict/i.test(message)) code = "REVISION_CONFLICT";
  else if (/unlock the layer|unlocked layer|locked layer/i.test(message))
    code = "LAYER_LOCKED";
  else if (/locked/i.test(message)) code = "PROJECT_LOCKED";
  else if (/unknown layer|existing layer IDs/i.test(message))
    code = "UNKNOWN_LAYER";
  else if (/inside --root|escapes --root/i.test(message))
    code = "PATH_OUT_OF_ROOT";
  else if (/already exists/i.test(message)) code = "OUTPUT_EXISTS";
  else if (
    /Chromium is required|VFX_CHROMIUM_PATH does not exist/i.test(message)
  )
    code = "BROWSER_REQUIRED";
  else if (/renderer busy/i.test(message)) code = "RENDERER_BUSY";
  else if (/resource expired|resource.*unknown/i.test(message))
    code = "IMAGE_EXPIRED";
  else if (/time.*outside.*duration/i.test(message)) code = "INVALID_TIME";
  const recoveries: Record<string, string> = {
    REVISION_CONFLICT:
      "Read observe_project or inspect_project again; plan against the returned revision.",
    IMAGE_EXPIRED: "Call observe_project again to obtain fresh image URIs.",
    BROWSER_REQUIRED:
      "Run vfx doctor and configure an installed browser, or use vfx browser install.",
    OUTPUT_EXISTS:
      "Choose a fresh output path; existing files are never overwritten.",
    RENDERER_BUSY: "Wait for an active render to finish, then retry.",
    PROJECT_LOCKED:
      "Wait for the active edit, then re-inspect. Do not bypass a live lock.",
    LAYER_LOCKED:
      "Choose an unlocked layer, or explicitly unlock the layer before editing it.",
    PATH_OUT_OF_ROOT:
      "Use a path inside the configured root; parent folders must already exist.",
    INVALID_TIME:
      "Use project seconds inside the reported duration, or omit time to choose an automatic observation.",
  };
  return {
    error: {
      code,
      message,
      recovery:
        recoveries[code] ??
        "Inspect the scene and get_schema for valid IDs, operation fields and limits; correct the request before retrying.",
      retryable: code === "RENDERER_BUSY" || code === "PROJECT_LOCKED",
      ...(cause instanceof ExportBudgetError
        ? { budget: cause.preflight }
        : {}),
      ...(batch
        ? {
            operationIndex: batch.index,
            operationNumber: batch.index + 1,
            action: batch.action,
            atomic: true,
          }
        : {}),
      ...(cause instanceof z.ZodError
        ? {
            issues: cause.issues.slice(0, 12).map((i) => ({
              path: i.path.join(".").slice(0, 512),
              message: i.message.slice(0, 500),
              code: i.code,
            })),
          }
        : {}),
    },
  };
}

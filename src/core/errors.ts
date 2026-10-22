import { z } from "zod";
export function readableError(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues
      .slice(0, 3)
      .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
      .join("\n");
  return error instanceof Error ? error.message : String(error);
}

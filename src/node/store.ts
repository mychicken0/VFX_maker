import * as fs from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseProject, parseText, type Project } from "../core/model.js";
import { serialize } from "../core/api.js";
export const revision = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
export class Store {
  private constructor(readonly root: string) {}
  static async open(root: string) {
    return new Store(await fs.realpath(resolve(root)));
  }
  async path(name: string, exists = true): Promise<string> {
    if (!name || name.includes("\0")) throw new Error("Empty or invalid path");
    const path = resolve(this.root, name),
      rel = relative(this.root, path);
    if (
      rel === "" ||
      rel === ".." ||
      rel.startsWith("../") ||
      rel.startsWith("..\\") ||
      isAbsolute(rel)
    )
      throw new Error("Path must be inside --root");
    const real = exists
      ? await fs.realpath(path)
      : resolve(await fs.realpath(dirname(path)), basename(path));
    const realRel = relative(this.root, real);
    if (
      realRel === ".." ||
      realRel.startsWith("../") ||
      realRel.startsWith("..\\") ||
      isAbsolute(realRel)
    )
      throw new Error("Path escapes --root through a symlink");
    if (!exists) {
      try {
        await fs.lstat(path);
        throw new Error("Output already exists");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return real;
  }
  async read(name: string) {
    const path = await this.path(name),
      stat = await fs.stat(path);
    if (stat.size > 4 * 1024 * 1024) throw new Error("Project exceeds 4 MiB");
    const text = await fs.readFile(path, "utf8");
    return { project: parseText(text), revision: revision(text) };
  }
  async create(name: string, value: unknown) {
    const path = await this.path(name, false),
      project = parseProject(value),
      text = serialize(project);
    if (Buffer.byteLength(text) > 4 * 1024 * 1024)
      throw new Error("Project exceeds 4 MiB");
    await fs.writeFile(path, text, { flag: "wx" });
    return { project, revision: revision(text) };
  }
  async edit(
    name: string,
    expected: string,
    operation: (project: Project) => unknown,
  ) {
    const path = await this.path(name),
      lock = await fs.open(path + ".lock", "wx").catch(() => {
        throw new Error("Project is locked by another edit");
      });
    try {
      const current = await this.read(name);
      if (current.revision !== expected)
        throw new Error(
          "Revision conflict: inspect the project again before editing",
        );
      const project = parseProject(operation(structuredClone(current.project))),
        text = serialize(project);
      if (Buffer.byteLength(text) > 4 * 1024 * 1024)
        throw new Error("Project exceeds 4 MiB");
      const temp = path + "." + randomUUID() + ".tmp";
      try {
        await fs.writeFile(temp, text, { flag: "wx" });
        await fs.rename(temp, path);
      } finally {
        await fs.rm(temp, { force: true });
      }
      return { project, revision: revision(text) };
    } finally {
      await lock.close();
      await fs.unlink(path + ".lock");
    }
  }
  async publish(
    name: string,
    files: Record<string, Buffer>,
    signal?: AbortSignal,
  ) {
    const path = await this.path(name, false);
    signal?.throwIfAborted();
    await fs.mkdir(path); // Exclusive reservation: never replace an existing output.
    try {
      await fs.writeFile(
        resolve(path, ".vfx-exporting"),
        "Export in progress\n",
        { flag: "wx" },
      );
      for (const [name, bytes] of Object.entries(files).sort(([a], [b]) =>
        a === "metadata.json"
          ? 1
          : b === "metadata.json"
            ? -1
            : a.localeCompare(b),
      )) {
        signal?.throwIfAborted();
        if (
          !/^[\w./-]+$/.test(name) ||
          name.split("/").includes("..") ||
          isAbsolute(name)
        )
          throw new Error("Invalid output member");
        const dest = resolve(path, name);
        await fs.mkdir(dirname(dest), { recursive: true });
        await fs.writeFile(dest, bytes, { flag: "wx" });
      }
      signal?.throwIfAborted();
      await fs.unlink(resolve(path, ".vfx-exporting"));
      return { directory: path, files: Object.keys(files) };
    } catch (e) {
      await fs.rm(path, { recursive: true, force: true });
      throw e;
    }
  }
}
/** Nested object updates replace arrays and reject unknown fields at final validation. */
export function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    return patch as T;
  if (!base || typeof base !== "object" || Array.isArray(base))
    return patch as T;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (["__proto__", "constructor", "prototype"].includes(k))
      throw new Error("Invalid property name");
    out[k] = merge(out[k], v);
  }
  return out as T;
}

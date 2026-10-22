import { parseText, type Project } from "../core/model.js";
import { serialize } from "../core/api.js";
import { databaseRequest } from "./persistence.js";
export type WritableFile = {
  write: (text: string) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
};
export type ProjectFileHandle = {
  name: string;
  kind?: "file";
  getFile: () => Promise<File>;
  createWritable: () => Promise<WritableFile>;
  isSameEntry?: (other: ProjectFileHandle) => Promise<boolean>;
  queryPermission?: (o: { mode: "readwrite" }) => Promise<string>;
  requestPermission?: (o: { mode: "readwrite" }) => Promise<string>;
};
export type FileRecord = {
  id: string;
  handle: ProjectFileHandle;
  revision: string;
  name: string;
};
export type BrowserBackup = {
  key: string;
  id: string;
  updated: number;
  bytes: number;
  text: string;
};
export const ACTIVE_FILE = "vfx-maker.active-file";
export const RECOVERY = "vfx-maker.recovery";
export async function textRevision(text: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
async function readText(handle: ProjectFileHandle) {
  const file = await handle.getFile();
  if (file.size > 4194304) throw Error("Project exceeds 4 MiB");
  return file.text();
}
export async function putBrowserBackup(id: string, text: string) {
  const hash = await textRevision(text);
  await databaseRequest("backups", "readwrite", (s) =>
    s.put({
      key: id + ":" + hash,
      id,
      updated: Date.now(),
      bytes: new TextEncoder().encode(text).length,
      text,
    }),
  );
  const backups = await browserBackups(id);
  for (const entry of backups.slice(5))
    await databaseRequest("backups", "readwrite", (s) => s.delete(entry.key));
}
export async function browserBackups(id: string) {
  const list = await databaseRequest<BrowserBackup[]>(
    "backups",
    "readonly",
    (s) => s.getAll(),
  );
  return list.filter((e) => e.id === id).sort((a, b) => b.updated - a.updated);
}
export async function rememberFile(record: FileRecord) {
  await databaseRequest("documents", "readwrite", (s) => s.put(record));
  try {
    localStorage.setItem(ACTIVE_FILE, record.id);
  } catch {}
}
export async function knownFile(
  handle: ProjectFileHandle,
): Promise<FileRecord | undefined> {
  if (!handle.isSameEntry) return;
  const records = await databaseRequest<FileRecord[]>(
    "documents",
    "readonly",
    (s) => s.getAll(),
  );
  for (const record of records)
    if (await handle.isSameEntry(record.handle).catch(() => false))
      return record;
}
export async function rememberedFile(): Promise<FileRecord | undefined> {
  let id: string | null;
  try {
    id = localStorage.getItem(ACTIVE_FILE);
  } catch {
    return;
  }
  return id
    ? databaseRequest("documents", "readonly", (s) => s.get(id))
    : undefined;
}
export async function saveNative(
  handle: ProjectFileHandle,
  project: Project,
  expected: string | undefined,
  backup: (text: string) => Promise<void>,
) {
  if (
    handle.requestPermission &&
    (await handle.queryPermission?.({ mode: "readwrite" })) !== "granted" &&
    (await handle.requestPermission({ mode: "readwrite" })) !== "granted"
  )
    throw Error(
      "File permission was not granted. Use Save As to choose another file.",
    );
  const before = await readText(handle),
    hash = await textRevision(before);
  if (expected && hash !== expected)
    throw Error(
      "Revision conflict: the file changed outside Studio. Open it again or use Save As.",
    );
  if (before) await backup(before);
  const text = serialize(project);
  if (new TextEncoder().encode(text).length > 4194304)
    throw Error("Project exceeds 4 MiB");
  // Re-read after backup I/O, before opening the replacement write stream.
  if ((await textRevision(await readText(handle))) !== hash)
    throw Error("Revision conflict: file changed during save");
  const stream = await handle.createWritable();
  try {
    await stream.write(text);
    await stream.close();
  } catch (e) {
    await stream.abort?.().catch(() => {});
    throw e;
  }
  return { revision: await textRevision(text), text };
}
export function filePickers() {
  return window as unknown as {
    showSaveFilePicker?: (options: unknown) => Promise<ProjectFileHandle>;
    showOpenFilePicker?: (options: unknown) => Promise<ProjectFileHandle[]>;
  };
}
export const pickerOptions = {
  types: [
    {
      description: "VFX Maker project",
      accept: { "application/json": [".vfx.json", ".json"] },
    },
  ],
  excludeAcceptAllOption: true,
};
export async function readNative(handle: ProjectFileHandle) {
  const text = await readText(handle);
  return { project: parseText(text), revision: await textRevision(text) };
}

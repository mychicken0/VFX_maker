import { useEffect, useRef, useState } from "react";
import { parseText, type Project } from "../core/model.js";
import { serialize } from "../core/api.js";
import { downloadFile, safeFilename } from "./files.js";
import {
  ACTIVE_FILE,
  RECOVERY,
  browserBackups,
  filePickers,
  pickerOptions,
  readNative,
  rememberedFile,
  rememberFile,
  knownFile,
  saveNative,
  putBrowserBackup,
  type FileRecord,
} from "./documents.js";
export type DiskDocument = {
  id: string;
  file: string;
  revision: string;
  project: Project;
};
type Binding =
  | { kind: "server"; file: string; id: string; revision: string }
  | { kind: "native"; record: FileRecord };
function sessionToken(value?: string | null): string | null {
  try {
    if (value === null) sessionStorage.removeItem("vfx-maker.document-token");
    else if (value !== undefined)
      sessionStorage.setItem("vfx-maker.document-token", value);
    return sessionStorage.getItem("vfx-maker.document-token");
  } catch {
    return null;
  }
}
export type BackupItem = { id: string; updated: number; bytes: number };
export function useDocument() {
  useEffect(() => {
    // Pasting the CLI's connection link into an already open Studio tab only
    // changes the hash. Start a fresh document session just as a new tab does.
    const connectLink = () => {
      if (new URLSearchParams(location.hash.slice(1)).get("project"))
        location.reload();
    };
    window.addEventListener("hashchange", connectLink);
    return () => window.removeEventListener("hashchange", connectLink);
  }, []);
  const [binding, setState] = useState<Binding | null>(null),
    [busy, setBusy] = useState(false);
  const current = useRef<Binding | null>(null),
    locked = useRef(false);
  const token = useRef(
    new URLSearchParams(location.hash.slice(1)).get("project") ??
      sessionToken(),
  );
  const setBinding = (b: Binding | null) => {
    current.current = b;
    setState(b);
  };
  const api = async <T>(path: string, body?: unknown): Promise<T> => {
    const r = await fetch("/api/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token.current ?? ""}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await r.json().catch(() => ({
      error: "Could not reconnect to the Studio file session",
    }));
    if (!r.ok) throw Error(value.error ?? "File operation failed");
    return value;
  };
  const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
    if (locked.current) throw Error("A file operation is already in progress");
    locked.current = true;
    setBusy(true);
    try {
      return await run();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const detach = () => {
    setBinding(null);
    token.current = null;
    sessionToken(null);
    try {
      localStorage.removeItem(ACTIVE_FILE);
    } catch {}
  };
  const connect = async () =>
    exclusive(async () => {
      if (token.current) {
        sessionToken(token.current);
        window.history.replaceState(null, "", location.pathname);
        const doc = await api<DiskDocument | null>("document");
        if (doc) {
          setBinding({
            kind: "server",
            file: doc.file,
            id: doc.id,
            revision: doc.revision,
          });
          return doc;
        }
      }
      const record = await rememberedFile().catch(() => undefined);
      if (record) {
        if (
          !record.handle.queryPermission ||
          (await record.handle.queryPermission({ mode: "readwrite" })) ===
            "granted"
        ) {
          const value = await readNative(record.handle);
          const connected = { ...record, revision: value.revision };
          setBinding({ kind: "native", record: connected });
          await rememberFile(connected).catch(() => {});
          return { ...value, id: record.id, file: record.name };
        }
        // Without permission we can only bind a browser copy identified as
        // this document. Another tab may have autosaved a different project.
        try {
          const recovery = JSON.parse(localStorage.getItem(RECOVERY) ?? "null");
          if (recovery?.id === record.id)
            setBinding({ kind: "native", record });
        } catch {}
      }
      return null;
    });
  const openNative = async () =>
    exclusive(async () => {
      const picker = filePickers().showOpenFilePicker;
      if (!picker) return null;
      const [handle] = await picker({ ...pickerOptions, multiple: false });
      const value = await readNative(handle),
        previous = await knownFile(handle).catch(() => undefined),
        record = {
          id: previous?.id ?? crypto.randomUUID(),
          handle,
          name: handle.name,
          revision: value.revision,
        };
      token.current = null;
      sessionToken(null);
      setBinding({ kind: "native", record });
      await rememberFile(record).catch(() => {});
      return value.project;
    });
  const save = async (project: Project, as = false, path?: string) =>
    exclusive(async () => {
      const b = current.current;
      if (b?.kind === "server" && (!as || path)) {
        const result = await api<DiskDocument>(
          as ? "save-as" : "save",
          as
            ? { file: path, project, documentId: b.id }
            : { revision: b.revision, project, documentId: b.id },
        );
        setBinding({
          kind: "server",
          file: result.file,
          id: result.id,
          revision: result.revision,
        });
        return { kind: "disk" as const, name: result.file };
      }
      if (b?.kind === "native" && !as) {
        const result = await saveNative(
            b.record.handle,
            project,
            b.record.revision,
            (text) => putBrowserBackup(b.record.id, text),
          ),
          record = { ...b.record, revision: result.revision };
        setBinding({ kind: "native", record });
        await rememberFile(record).catch(() => {});
        return { kind: "disk" as const, name: record.name };
      }
      const picker = filePickers().showSaveFilePicker;
      if (picker) {
        const handle = await picker({
            ...pickerOptions,
            suggestedName: safeFilename(project.name) + ".vfx.json",
          }),
          id =
            (await knownFile(handle).catch(() => undefined))?.id ??
            crypto.randomUUID(),
          result = await saveNative(handle, project, undefined, (text) =>
            putBrowserBackup(id, text),
          ),
          record = { handle, id, revision: result.revision, name: handle.name };
        token.current = null;
        sessionToken(null);
        setBinding({ kind: "native", record });
        await rememberFile(record).catch(() => {});
        return { kind: "disk" as const, name: handle.name };
      }
      download(project);
      return {
        kind: "download" as const,
        name: safeFilename(project.name) + ".vfx.json",
      };
    });
  const download = (project: Project) =>
    downloadFile(
      new TextEncoder().encode(serialize(project)),
      safeFilename(project.name) + ".vfx.json",
      "application/json",
    );
  const backups = async (): Promise<BackupItem[]> => {
    const b = current.current;
    if (b?.kind === "server") return api("backups");
    if (b?.kind === "native")
      return (await browserBackups(b.record.id)).map((e) => ({
        id: e.key,
        updated: e.updated,
        bytes: e.bytes,
      }));
    return [];
  };
  const restore = async (id: string): Promise<Project> =>
    exclusive(async () => {
      const b = current.current;
      if (b?.kind === "server") {
        const result = await api<DiskDocument>("restore", {
          id,
          documentId: b.id,
          revision: b.revision,
        });
        setBinding({ ...b, revision: result.revision });
        return result.project;
      }
      if (b?.kind === "native") {
        const backup = (await browserBackups(b.record.id)).find(
          (e) => e.key === id,
        );
        if (!backup) throw Error("Unknown backup");
        const project = parseText(backup.text),
          result = await saveNative(
            b.record.handle,
            project,
            b.record.revision,
            (text) => putBrowserBackup(b.record.id, text),
          ),
          record = { ...b.record, revision: result.revision };
        setBinding({ kind: "native", record });
        await rememberFile(record).catch(() => {});
        return project;
      }
      throw Error("No file is connected");
    });
  return {
    binding,
    busy,
    connect,
    detach,
    openNative,
    save,
    download,
    backups,
    restore,
    name:
      binding?.kind === "server"
        ? binding.file
        : binding?.kind === "native"
          ? binding.record.name
          : null,
    id:
      binding?.kind === "server"
        ? binding.id
        : binding?.kind === "native"
          ? binding.record.id
          : null,
  };
}

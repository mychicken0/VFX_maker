import { parseProject, type Project } from "../core/model.js";
export type RecentProject = { name: string; updated: number; project: Project };
import { openDatabase as db } from "./persistence.js";
export async function listRecent(): Promise<RecentProject[]> {
  const database = await db();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction("recent", "readonly"),
        request = tx.objectStore("recent").getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as RecentProject[]).sort(
            (a, b) => b.updated - a.updated,
          ),
        );
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}
export async function rememberProject(project: Project) {
  const p = parseProject(project),
    database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("recent", "readwrite");
      tx.objectStore("recent").put({
        name: p.name,
        updated: Date.now(),
        project: p,
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(new Error("Local project backup quota exceeded"));
    });
  } finally {
    database.close();
  }
  const entries = await listRecent();
  for (const e of entries.slice(8)) await removeRecent(e.name);
}
export async function removeRecent(name: string) {
  const database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("recent", "readwrite");
      tx.objectStore("recent").delete(name);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}

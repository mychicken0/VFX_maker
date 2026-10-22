import { openDatabase, databaseRequest } from "./persistence.js";
import { parseComponent, type Component } from "../core/components.js";
export interface LibraryItem {
  id: string;
  updated: number;
  component: Component;
  thumbnail: string;
}
export async function listComponents(): Promise<LibraryItem[]> {
  const items = await databaseRequest<LibraryItem[]>(
    "components",
    "readonly",
    (store) => store.getAll(),
  );
  return items
    .map((item) => ({ ...item, component: parseComponent(item.component) }))
    .sort((a, b) => b.updated - a.updated);
}
export async function saveComponent(item: LibraryItem): Promise<void> {
  const valid = { ...item, component: parseComponent(item.component) },
    db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("components", "readwrite"),
        store = tx.objectStore("components"),
        request = store.getAll();
      request.onsuccess = () => {
        const items = (request.result as LibraryItem[]).filter(
          (x) => x.id !== item.id,
        );
        if (
          items.length >= 24 ||
          new TextEncoder().encode(JSON.stringify([...items, valid])).length >
            25165824
        ) {
          tx.abort();
          reject(
            Error(
              "Library is full (24 components / 24 MiB). Download and remove some saved components.",
            ),
          );
          return;
        }
        store.put(valid);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? Error("Could not save the component"));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function removeComponent(id: string): Promise<void> {
  await databaseRequest("components", "readwrite", (store) => store.delete(id));
}

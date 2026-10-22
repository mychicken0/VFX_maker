export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vfx-maker-projects", 2);
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of [
        ["recent", "name"],
        ["documents", "id"],
        ["backups", "key"],
      ])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () =>
      reject(request.error ?? Error("Local storage is unavailable"));
    request.onblocked = () =>
      reject(Error("Close another Studio tab to upgrade local storage"));
  });
}
export async function databaseRequest<T>(
  name: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode),
        request = action(tx.objectStore(name));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(tx.error ?? Error("Local storage operation failed"));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

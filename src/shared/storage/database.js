export const DATABASE_NAME = "ctool-local-v2";

/** @param {string} [name] @param {IDBFactory} [factory] */
export function openDatabase(name = DATABASE_NAME, factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error("IndexedDB is unavailable in this browser context.")); return; }
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "id" });
      if (!db.objectStoreNames.contains("favorites")) db.createObjectStore("favorites", { keyPath: "id" });
      if (!db.objectStoreNames.contains("environments")) db.createObjectStore("environments", { keyPath: "id" });
      if (!db.objectStoreNames.contains("responses")) db.createObjectStore("responses", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local request database."));
    request.onblocked = () => reject(new Error("Close other cTool windows to finish the local database upgrade."));
  });
}

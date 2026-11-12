const RESPONSE_RETENTION_MS = 24 * 60 * 60 * 1000;
const RESPONSE_LIMIT = 10;
const HISTORY_LIMIT = 100;
/** @typedef {Record<string, any>} DbRecord */

export class StorageQuotaError extends Error {
  constructor() { super("The cTool local storage is full. Export a backup or remove old response data, then try again."); this.name = "StorageQuotaError"; }
  /** @param {unknown} error */
  static from(error) { return error && typeof error === "object" && "name" in error && error.name === "QuotaExceededError" ? new StorageQuotaError() : error; }
}

/** @template T @param {IDBRequest<T>} request @returns {Promise<T>} */
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("A local storage operation failed."));
  });
}

/** @param {IDBTransaction} transaction @returns {Promise<void>} */
function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(undefined);
    transaction.onabort = () => reject(transaction.error ?? new Error("The local storage transaction was rolled back."));
    transaction.onerror = () => reject(transaction.error ?? new Error("The local storage transaction failed."));
  });
}

/** @template T @param {IDBDatabase} db @param {string|string[]} storeNames @param {'readonly'|'readwrite'} mode @param {(transaction:IDBTransaction)=>Promise<T>} work @returns {Promise<T>} */
async function transact(db, storeNames, mode, work) {
  const transaction = db.transaction(storeNames, mode);
  const completed = transactionResult(transaction);
  try {
    const result = await work(transaction);
    await completed;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* The transaction may already be complete. */ }
    await completed.catch(() => {});
    throw StorageQuotaError.from(error);
  }
}

/** @param {DbRecord} record */
function recordTime(record) {
  const value = record.createdAt ?? record.receivedAt ?? record.updatedAt ?? record.savedAt ?? 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.parse(String(value)) || 0;
}

/** @param {IDBDatabase} db */
export function createRepositories(db) {
  /** @param {string} store @param {IDBValidKey} key */
  const get = (store, key) => transact(db, store, "readonly", (tx) => requestResult(tx.objectStore(store).get(key)));
  /** @param {string} store */
  const getAll = (store) => transact(db, store, "readonly", (tx) => requestResult(tx.objectStore(store).getAll()));
  /** @param {string} store @param {DbRecord} value */
  const put = (store, value) => transact(db, store, "readwrite", async (tx) => {
    /** @type {DbRecord} */
    const saved = { ...structuredClone(value), updatedAt: Date.now() };
    if (store === "favorites" && !saved.savedAt) saved.savedAt = saved.updatedAt;
    await requestResult(tx.objectStore(store).put(saved));
    return saved;
  });
  /** @param {string} store @param {IDBValidKey} key */
  const remove = (store, key) => transact(db, store, "readwrite", async (tx) => {
    await requestResult(tx.objectStore(store).delete(key));
  });

  return {
    /** @param {DbRecord} record @param {number} [limit] */
    async addHistory(record, limit = HISTORY_LIMIT) {
      return transact(db, "history", "readwrite", async (tx) => {
        const store = tx.objectStore("history");
        const value = { ...structuredClone(record), createdAt: record.createdAt ?? Date.now() };
        await requestResult(store.put(value));
        const all = await requestResult(store.getAll());
        all.sort((a, b) => recordTime(b) - recordTime(a));
        for (const stale of all.slice(Math.max(1, limit))) await requestResult(store.delete(stale.id));
        return value;
      });
    },
    /** @param {{search?:string,limit?:number}} [options] */
    async listHistory(options = {}) {
      const all = await getAll("history");
      const search = String(options.search ?? "").trim().toLowerCase();
      const filtered = all.filter((record) => !search || JSON.stringify([record.name, record.request?.url, record.result?.status, record.errorCode]).toLowerCase().includes(search));
      filtered.sort((a, b) => recordTime(b) - recordTime(a));
      return options.limit ? filtered.slice(0, options.limit) : filtered;
    },
    /** @param {string} id */
    getHistory: (id) => get("history", id),
    /** @param {string} id */
    deleteHistory: (id) => remove("history", id),
    clearHistory: () => transact(db, "history", "readwrite", (tx) => requestResult(tx.objectStore("history").clear())),

    /** @param {DbRecord} favorite */
    saveFavorite: (favorite) => put("favorites", favorite),
    /** @param {string} id */
    getFavorite: (id) => get("favorites", id),
    async listFavorites() { const values = await getAll("favorites"); return values.sort((a, b) => String(a.name).localeCompare(String(b.name))); },
    /** @param {string} id */
    deleteFavorite: (id) => remove("favorites", id),

    /** @param {DbRecord} environment */
    saveEnvironment: (environment) => put("environments", environment),
    /** @param {string} id */
    getEnvironment: (id) => get("environments", id),
    async listEnvironments() { const values = await getAll("environments"); return values.sort((a, b) => String(a.name).localeCompare(String(b.name))); },
    /** @param {string} id */
    deleteEnvironment: (id) => remove("environments", id),

    /** @param {DbRecord} draft */
    saveDraft: (draft) => put("drafts", draft),
    /** @param {string} [id] */
    getDraft: (id = "current") => get("drafts", id),
    async listDrafts() { const values = await getAll("drafts"); return values.sort((a, b) => recordTime(b) - recordTime(a)); },
    /** @param {string} [id] */
    deleteDraft: (id = "current") => remove("drafts", id),

    /** @param {DbRecord} response @param {number} [now] */
    async saveResponse(response, now = Date.now()) {
      return transact(db, "responses", "readwrite", async (tx) => {
        const store = tx.objectStore("responses");
        const value = { ...structuredClone(response), receivedAt: response.receivedAt ?? now };
        await requestResult(store.put(value));
        const all = await requestResult(store.getAll());
        all.sort((a, b) => recordTime(b) - recordTime(a));
        for (const stale of all.filter((entry) => recordTime(entry) < now - RESPONSE_RETENTION_MS)) await requestResult(store.delete(stale.id));
        const fresh = all.filter((entry) => recordTime(entry) >= now - RESPONSE_RETENTION_MS);
        for (const stale of fresh.slice(RESPONSE_LIMIT)) await requestResult(store.delete(stale.id));
        return value;
      });
    },
    async listResponses(now = Date.now()) {
      const all = await getAll("responses");
      return all.filter((entry) => recordTime(entry) >= now - RESPONSE_RETENTION_MS).sort((a, b) => recordTime(b) - recordTime(a)).slice(0, RESPONSE_LIMIT);
    },
    /** @param {string} id */
    getResponse: (id) => get("responses", id),
    /** @param {string} id */
    deleteResponse: (id) => remove("responses", id),

    /** @param {string} key */
    getMeta: async (key) => (await get("meta", key))?.value,
    /** @param {string} key @param {any} value */
    setMeta: (key, value) => put("meta", { id: key, key, value }),
    async getGlobalVariables() { return (await get("meta", "globalVariables"))?.value ?? []; },
    /** @param {Array<{id?:string,name:string,value:string,secret?:boolean}>} variables */
    async saveGlobalVariables(variables) { await transact(db, "meta", "readwrite", (tx) => requestResult(tx.objectStore("meta").put({ id: "globalVariables", key: "globalVariables", value: structuredClone(variables) }))); },
    /** @param {DbRecord[]} records */
    async importLegacyHistory(records) {
      return transact(db, ["history", "meta"], "readwrite", async (tx) => {
        const historyStore = tx.objectStore("history");
        for (const record of records) await requestResult(historyStore.put(structuredClone(record)));
        const all = await requestResult(historyStore.getAll());
        all.sort((a, b) => recordTime(b) - recordTime(a));
        for (const stale of all.slice(HISTORY_LIMIT)) await requestResult(historyStore.delete(stale.id));
        await requestResult(tx.objectStore("meta").put({ id: "legacyCurlHistoryV1", key: "legacyCurlHistoryV1", value: true }));
        return records.length;
      });
    },
    /** @param {{drafts?:DbRecord[],history?:DbRecord[],favorites?:DbRecord[],environments?:DbRecord[],globalVariables?:DbRecord[]}} data */
    async mergeBackup(data) {
      const stores = ["drafts", "history", "favorites", "environments", "meta"];
      return transact(db, stores, "readwrite", async (tx) => {
        const environmentIds = new Map();
        const environments = (data.environments ?? []).map((item) => {
          const id = crypto.randomUUID();
          if (item.id) environmentIds.set(item.id, id);
          return { ...structuredClone(item), id, importedAt: Date.now() };
        });
        /** @param {DbRecord} request */
        const remapRequest = (request) => ({
          ...structuredClone(request),
          id: crypto.randomUUID(),
          environmentId: environmentIds.get(request.environmentId) ?? request.environmentId ?? null
        });
        const drafts = (data.drafts ?? []).map(remapRequest);
        /** @type {DbRecord[]} */
        const favorites = (data.favorites ?? []).map((item) => ({ ...structuredClone(item), id: crypto.randomUUID(), request: remapRequest(item.request) }));
        const history = (data.history ?? []).map((item) => ({ ...structuredClone(item), id: crypto.randomUUID(), request: item.request ? remapRequest(item.request) : undefined }));
        const historyStore = tx.objectStore("history");
        for (const item of history) await requestResult(historyStore.put(item));
        const allHistory = await requestResult(historyStore.getAll());
        allHistory.sort((a, b) => recordTime(b) - recordTime(a));
        for (const stale of allHistory.slice(HISTORY_LIMIT)) await requestResult(historyStore.delete(stale.id));
        for (const item of environments) await requestResult(tx.objectStore("environments").put(item));
        for (const item of drafts) await requestResult(tx.objectStore("drafts").put(item));
        for (const item of favorites) await requestResult(tx.objectStore("favorites").put({ ...item, savedAt: item.savedAt ?? Date.now() }));
        const meta = tx.objectStore("meta");
        const currentVariables = (await requestResult(meta.get("globalVariables")))?.value ?? [];
        const importedVariables = (data.globalVariables ?? []).map((item) => ({ ...structuredClone(item), id: crypto.randomUUID() }));
        await requestResult(meta.put({ id: "globalVariables", key: "globalVariables", value: [...currentVariables, ...importedVariables] }));
        return { drafts: drafts.length, history: history.length, favorites: favorites.length, environments: environments.length, globalVariables: importedVariables.length };
      });
    }
  };
}

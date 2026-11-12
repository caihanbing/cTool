export const DEFAULT_SETTINGS = Object.freeze({
  locale: "zh-CN",
  theme: "system",
  privacyMode: false,
  followRedirects: false,
  timeoutMs: 25_000,
  selectedEnvironmentId: ""
});

/** @typedef {{locale:'zh-CN'|'en',theme:'light'|'dark'|'system',privacyMode:boolean,followRedirects:boolean,timeoutMs:number,selectedEnvironmentId:string}} Settings */

/** @param {chrome.storage.StorageArea} [storage] */
/** @returns {Promise<Settings>} */
export async function loadSettings(storage = chrome.storage.local) {
  /** @type {Record<string, any>} */
  const values = await storage.get(DEFAULT_SETTINGS);
  return {
    locale: values.locale === "en" ? "en" : "zh-CN",
    theme: ["light", "dark", "system"].includes(String(values.theme)) ? values.theme : "system",
    privacyMode: values.privacyMode === true,
    followRedirects: values.followRedirects === true,
    timeoutMs: typeof values.timeoutMs === "number" && Number.isFinite(values.timeoutMs) ? Math.max(1, Math.min(300_000, values.timeoutMs)) : DEFAULT_SETTINGS.timeoutMs,
    selectedEnvironmentId: typeof values.selectedEnvironmentId === "string" ? values.selectedEnvironmentId : ""
  };
}

/** @param {Partial<Settings>} changes @param {chrome.storage.StorageArea} [storage] */
/** @returns {Promise<Settings>} */
export async function updateSettings(changes, storage = chrome.storage.local) {
  const current = await loadSettings(storage);
  const merged = { ...current, ...changes };
  const normalized = /** @type {Settings} */ ({
    locale: merged.locale === "en" ? "en" : "zh-CN",
    theme: ["light", "dark", "system"].includes(merged.theme) ? merged.theme : "system",
    privacyMode: merged.privacyMode === true,
    followRedirects: merged.followRedirects === true,
    timeoutMs: Number.isFinite(merged.timeoutMs) ? Math.max(1, Math.min(300_000, merged.timeoutMs)) : DEFAULT_SETTINGS.timeoutMs,
    selectedEnvironmentId: String(merged.selectedEnvironmentId ?? "")
  });
  await storage.set(normalized);
  return normalized;
}

/** @param {Settings} settings @param {'draft'|'history'|'response'|'favorite'|'environment'} kind */
export function shouldPersist(settings, kind) {
  return !settings.privacyMode || kind === "favorite" || kind === "environment";
}

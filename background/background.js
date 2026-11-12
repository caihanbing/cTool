import { openDatabase } from "../src/shared/storage/database.js";
import { createRepositories } from "../src/shared/storage/repositories.js";
import { loadSettings } from "../src/shared/storage/settings.js";
import { getEphemeralResponseChunk, runRequest } from "../src/shared/request-executor.js";
import { isTrustedExtensionPage, reconcileInterruptedTask } from "../src/background/task-manager.js";

const controllers = new Map();
/** @type {Promise<{database:IDBDatabase,repositories:ReturnType<typeof createRepositories>}>|undefined} */
let initialization;

/** @typedef {{type:string,taskId?:string,requestId?:string,draft?:any,timeoutMs?:number,offset?:number,size?:number,responseId?:string}} BackgroundMessage */

async function initialize() {
  if (!initialization) initialization = (async () => {
    const database = await openDatabase();
    const repositories = createRepositories(database);
    await reconcileInterruptedTask({ repositories, dnr: chrome.declarativeNetRequest });
    return { database, repositories };
  })().catch((error) => { initialization = undefined; throw error; });
  return initialization;
}

/** @param {BackgroundMessage} message */
async function handleMessage(message) {
  const { repositories } = await initialize();
  if (message.type === "RUN_STATUS") return { active: await repositories.getActiveTask() };
  if (message.type === "RUN_CANCEL") {
    const controller = controllers.get(message.taskId);
    if (!controller) return { cancelled: false };
    controller.abort("cancelled-by-user");
    return { cancelled: true };
  }
  if (message.type === "RESPONSE_CHUNK") {
    if (!message.responseId) return { chunk: null };
    return { chunk: getEphemeralResponseChunk(message.responseId, Number(message.offset) || 0, Number(message.size) || 256 * 1024) };
  }
  if (message.type === "RUN_START") {
    const draft = message.draft;
    if (!draft || typeof draft !== "object") return { error: { code: "INVALID_REQUEST", message: "The request editor did not provide a valid request." } };
    const settings = await loadSettings();
    const taskId = typeof message.taskId === "string" ? message.taskId : crypto.randomUUID();
    const controller = new AbortController();
    controllers.set(taskId, controller);
    try {
      const requestedTimeout = Number(message.timeoutMs ?? draft.timeoutMs ?? settings.timeoutMs);
      const timeoutMs = Math.min(25_000, Number.isFinite(requestedTimeout) ? requestedTimeout : settings.timeoutMs, settings.timeoutMs);
      const result = await runRequest(draft, {
        repositories,
        dnr: chrome.declarativeNetRequest,
        extensionId: chrome.runtime.id,
        taskId,
        requestId: typeof message.requestId === "string" ? message.requestId : draft.id,
        source: "popup",
        timeoutMs,
        privacyMode: settings.privacyMode,
        signal: controller.signal
      });
      return { result };
    } finally { controllers.delete(taskId); }
  }
  return { error: { code: "UNKNOWN_MESSAGE", message: "This cTool message is not supported." } };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedExtensionPage(sender, chrome.runtime.id)) return false;
  if (!message || typeof message.type !== "string") return false;
  void handleMessage(message).then(sendResponse, (error) => sendResponse({
    error: {
      code: typeof error?.code === "string" ? error.code : "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "cTool could not process this request."
    }
  }));
  return true;
});

chrome.runtime.onStartup.addListener(() => { void initialize().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { void initialize().catch(() => {}); });
void initialize().catch(() => {});

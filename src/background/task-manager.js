import { RESTRICTED_RULE_IDS } from "../shared/request-executor.js";

const WORKBENCH_STALE_MS = 30_000;

/** @param {chrome.runtime.MessageSender} sender @param {string} extensionId */
export function isTrustedExtensionPage(sender, extensionId) {
  if (sender.id !== extensionId || typeof sender.url !== "string") return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === "chrome-extension:" && url.host === extensionId;
  }
  catch { return false; }
}

/**
 * Clear abandoned restricted-header rules and record an interrupted task.
 * A live workbench page owns its own long-running fetch; its heartbeat keeps
 * the worker from mistaking that page task for an interrupted worker request.
 * @param {{repositories:ReturnType<typeof import('../shared/storage/repositories.js').createRepositories>,dnr:typeof chrome.declarativeNetRequest,now?:()=>number,workbenchStaleMs?:number}} input
 */
export async function reconcileInterruptedTask({ repositories, dnr, now = Date.now, workbenchStaleMs = WORKBENCH_STALE_MS }) {
  const active = await repositories.getActiveTask();
  const currentTime = now();
  const lastHeartbeat = Number(active?.lastHeartbeat ?? active?.startedAt ?? 0);
  if (active?.owner === "workbench" && currentTime - lastHeartbeat <= workbenchStaleMs) return { status: "workbench-active", rulesRemoved: 0 };

  const currentRules = await dnr.getSessionRules();
  const knownRuleIds = new Set(RESTRICTED_RULE_IDS);
  const removeRuleIds = currentRules.filter(({ id }) => knownRuleIds.has(id)).map(({ id }) => id);
  if (removeRuleIds.length) await dnr.updateSessionRules({ removeRuleIds });
  if (!active) return { status: "cleaned", rulesRemoved: removeRuleIds.length };

  const historyRecord = active.privacyMode ? undefined : {
    id: active.taskId,
    requestId: active.requestId,
    createdAt: currentTime,
    request: active.request,
    result: { id: active.taskId, taskId: active.taskId, requestId: active.requestId, status: "interrupted", errorCode: "WORKER_INTERRUPTED", timingMs: 0, statusCode: null, receivedBytes: 0, bodyRef: null },
    errorCode: "WORKER_INTERRUPTED"
  };
  await repositories.completeTask({ taskId: active.taskId, historyRecord, now: currentTime });
  return { status: "interrupted", rulesRemoved: removeRuleIds.length };
}

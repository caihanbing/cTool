import { composeRequestUrl, stripFileAttachments, validateRequestDraft } from "./request-model.js";
import { resolveEnvironment } from "./environment.js";
import { RESPONSE_PREVIEW_LIMIT, readResponse, ResponseTooLargeError } from "./response-reader.js";

const RESTRICTED_HEADERS = new Set(["cookie", "referer", "origin", "user-agent"]);
const BROWSER_CONTROLLED_HEADERS = new Set(["host", "content-length", "connection", "accept-encoding", "transfer-encoding", "upgrade"]);

export class RequestPreparationError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.name = "RequestPreparationError"; this.code = code; }
}

/** @param {string} value */
function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/** @param {string} value */
function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * Create the browser Fetch request and separate headers that must be added by
 * an exact-target DNR session rule.
 * @param {import('./request-model.js').RequestDraft} draft
 * @returns {{url:string,restrictedHeaders:Array<{name:string,value:string}>,warnings:string[],init:RequestInit}}
 */
export function prepareFetchRequest(draft) {
  const errors = validateRequestDraft(draft);
  if (errors.length) throw new RequestPreparationError(errors[0].code, errors.map(({ message }) => message).join(" "));
  const target = new URL(composeRequestUrl(draft));
  target.hash = "";
  const headers = new Headers();
  /** @type {Array<{name:string,value:string}>} */
  const restrictedHeaders = [];
  const warnings = [];
  /** @param {string} name @param {string} value */
  const addHeader = (name, value) => {
    const normalized = name.trim().toLowerCase();
    if (BROWSER_CONTROLLED_HEADERS.has(normalized) || normalized.startsWith("proxy-") || normalized.startsWith("sec-")) {
      throw new RequestPreparationError("BROWSER_CONTROLLED_HEADER", `${name} is controlled by the browser and cannot be set by an extension request.`);
    }
    if (/\r|\n/.test(name + value)) throw new RequestPreparationError("INVALID_HEADER", "Header names and values cannot contain line breaks.");
    if (RESTRICTED_HEADERS.has(normalized)) { restrictedHeaders.push({ name: normalized, value }); return; }
    try { headers.append(name, value); }
    catch { throw new RequestPreparationError("INVALID_HEADER", `The ${name || "request"} header is invalid.`); }
  };
  for (const row of draft.headers) if (row.enabled) addHeader(row.name, row.value);
  if (draft.auth.type === "basic") addHeader("Authorization", `Basic ${base64Utf8(`${draft.auth.username}:${draft.auth.password}`)}`);
  if (draft.auth.type === "bearer") addHeader("Authorization", `Bearer ${draft.auth.token}`);

  /** @type {BodyInit|null} */
  let body = null;
  if (draft.body.type === "json") {
    body = draft.body.text;
    if (!headers.has("content-type")) headers.set("Content-Type", "application/json");
  } else if (draft.body.type === "text") {
    body = draft.body.text;
    if (!headers.has("content-type")) headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
  } else if (draft.body.type === "urlencoded") {
    const form = new URLSearchParams();
    if (draft.body.fields.length) {
      for (const field of draft.body.fields) if (field.enabled) form.append(field.name, field.value);
    } else form.append("", draft.body.text);
    body = form;
  } else if (draft.body.type === "multipart") {
    const form = new FormData();
    for (const field of draft.body.fields) {
      if (!field.enabled) continue;
      if (!field.isFile) { form.append(field.name, field.value); continue; }
      if (!field.fileData) throw new RequestPreparationError("FILE_REQUIRED", `Choose a file for the “${field.name}” multipart field before sending.`);
      const blob = new Blob([decodeBase64(field.fileData)], { type: field.fileType || "application/octet-stream" });
      form.append(field.name, blob, field.fileName || "upload");
    }
    body = form;
    if (headers.has("content-type")) {
      headers.delete("content-type");
      warnings.push("The browser generates the multipart boundary and replaced the imported Content-Type header.");
    }
  }
  const normalizedMethod = draft.method.toUpperCase();
  return {
    url: target.href,
    restrictedHeaders,
    warnings,
    init: {
      method: normalizedMethod,
      headers,
      body,
      credentials: "omit",
      redirect: draft.redirectMode === "follow" ? "follow" : "manual",
      cache: "no-store",
      referrerPolicy: "no-referrer"
    }
  };
}

/** @param {string} value */
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**
 * Build one DNR session rule for manually supplied browser-controlled headers.
 * @param {{id:number,extensionId:string,url:string,method:string,headers:Array<{name:string,value:string}>}} input
 * @returns {chrome.declarativeNetRequest.Rule}
 */
export function buildRestrictedHeaderRule({ id, extensionId, url, method, headers }) {
  const target = new URL(url);
  target.hash = "";
  /** @type {Map<string,string[]>} */
  const grouped = new Map();
  for (const header of headers) {
    const name = header.name.toLowerCase();
    if (!RESTRICTED_HEADERS.has(name)) throw new RequestPreparationError("UNSUPPORTED_RESTRICTED_HEADER", `${header.name} cannot be forwarded by the browser.`);
    const values = grouped.get(name) ?? [];
    values.push(header.value);
    grouped.set(name, values);
  }
  if (!grouped.size) throw new RequestPreparationError("EMPTY_RESTRICTED_HEADERS", "No browser-controlled headers were provided for the DNR rule.");
  /** @type {chrome.declarativeNetRequest.ModifyHeaderInfo[]} */
  const requestHeaders = [...grouped.entries()].map(([header, values]) => ({
    header,
    operation: /** @type {'set'} */ ("set"),
    value: values.join(header === "cookie" ? "; " : ", ")
  }));
  const normalizedMethod = method.toLowerCase();
  const requestMethod = /** @type {'connect'|'delete'|'get'|'head'|'options'|'other'|'patch'|'post'|'put'} */ (["get", "head", "post", "put", "delete", "connect", "options", "trace", "patch"].includes(normalizedMethod) ? normalizedMethod : "other");
  return {
    id,
    priority: 1,
    action: { type: "modifyHeaders", requestHeaders },
    condition: {
      regexFilter: `^${escapeRegex(target.href)}$`,
      initiatorDomains: [extensionId],
      requestDomains: [target.hostname],
      requestMethods: [requestMethod],
      resourceTypes: ["xmlhttprequest"]
    }
  };
}

export const RESTRICTED_RULE_IDS = Object.freeze([72_001, 72_002, 72_003, 72_004]);

/** @param {typeof chrome.declarativeNetRequest} dnr @param {string} extensionId @param {string} url @param {string} method @param {Array<{name:string,value:string}>} headers */
export async function installRestrictedHeaderRules(dnr, extensionId, url, method, headers) {
  if (!headers.length) return [];
  const rule = buildRestrictedHeaderRule({ id: RESTRICTED_RULE_IDS[0], extensionId, url, method, headers });
  try {
    await dnr.updateSessionRules({ removeRuleIds: [...RESTRICTED_RULE_IDS], addRules: [rule] });
  } catch (error) {
    throw new RequestPreparationError("DNR_INSTALL_FAILED", `The browser could not safely apply a temporary request header: ${error instanceof Error ? error.message : String(error)}`);
  }
  return [rule.id];
}

/** @param {typeof chrome.declarativeNetRequest} dnr @param {number[]} ruleIds */
export async function clearRestrictedHeaderRules(dnr, ruleIds = [...RESTRICTED_RULE_IDS]) {
  if (!ruleIds.length) return;
  await dnr.updateSessionRules({ removeRuleIds: ruleIds });
}

/** @param {unknown} error */
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }

/**
 * Execute one globally serialized request and commit its terminal history and
 * bounded response body. This function is shared by the MV3 worker and the
 * expanded workbench page; the latter may use a longer deadline.
 * @param {import('./request-model.js').RequestDraft} sourceDraft
 * @param {{repositories:ReturnType<typeof import('./storage/repositories.js').createRepositories>,dnr:typeof chrome.declarativeNetRequest,extensionId:string,requestId?:string,taskId?:string,source?:'popup'|'workbench',timeoutMs?:number,privacyMode?:boolean,signal?:AbortSignal,fetchImpl?:typeof fetch,now?:()=>number}} options
 */
export async function runRequest(sourceDraft, options) {
  const taskId = options.taskId ?? crypto.randomUUID();
  const requestId = options.requestId ?? sourceDraft.id;
  const source = options.source ?? "popup";
  const privacyMode = options.privacyMode === true;
  const ceiling = source === "workbench" ? 300_000 : 25_000;
  const timeoutMs = Math.max(1, Math.min(ceiling, options.timeoutMs ?? sourceDraft.timeoutMs ?? ceiling));
  const environmentId = sourceDraft.environmentId;
  const variables = await options.repositories.getGlobalVariables();
  const environment = environmentId ? await options.repositories.getEnvironment(environmentId) : null;
  const resolved = resolveEnvironment(sourceDraft, variables, environment);
  if (resolved.missing.length) throw new RequestPreparationError("MISSING_ENVIRONMENT_VARIABLE", `Set these environment variables before sending: ${resolved.missing.join(", ")}.`);
  const prepared = prepareFetchRequest(resolved.draft);
  const persistedRequest = privacyMode ? { id: sourceDraft.id, name: sourceDraft.name, method: sourceDraft.method, url: sourceDraft.url } : stripFileAttachments(sourceDraft);
  const acquired = await options.repositories.acquireActiveTask({ taskId, requestId, owner: source, source, privacyMode, startedAt: (options.now ?? Date.now)(), deadlineMs: timeoutMs, request: persistedRequest });
  if (!acquired.acquired) throw new RequestPreparationError("TASK_BUSY", "Another cTool request is already running. Wait for it to finish or cancel it first.");

  const startedAt = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle;
  const forwardAbort = () => controller.abort(options.signal?.reason ?? "cancelled");
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const heartbeat = setInterval(() => { void options.repositories.heartbeatActiveTask(taskId).catch(() => {}); }, 5_000);
  /** @type {number[]} */
  let installedRuleIds = [];
  /** @type {any} */
  let result = null;
  /** @type {any} */
  let responseRecord = null;
  try {
    await clearRestrictedHeaderRules(options.dnr);
    installedRuleIds = await installRestrictedHeaderRules(options.dnr, options.extensionId, prepared.url, prepared.init.method ?? "GET", prepared.restrictedHeaders);
    timeoutHandle = setTimeout(() => { timedOut = true; controller.abort("timeout"); }, timeoutMs);
    const response = await (options.fetchImpl ?? fetch)(prepared.url, { ...prepared.init, signal: controller.signal });
    if (sourceDraft.redirectMode !== "follow" && (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))) {
      throw new RequestPreparationError("REDIRECT_BLOCKED", "The browser returned an opaque redirect response. Enable Follow redirects to request the final URL.");
    }
    const read = await readResponse(response);
    result = {
      id: taskId,
      taskId,
      requestId,
      status: "completed",
      timingMs: Math.max(0, Math.round(performance.now() - startedAt)),
      statusCode: read.status,
      statusText: read.statusText,
      finalUrl: read.finalUrl || prepared.url,
      headers: read.headers,
      contentType: read.contentType,
      receivedBytes: read.receivedBytes,
      bodyRef: taskId,
      previewText: read.previewText,
      isBinary: read.isBinary,
      truncated: read.truncated,
      errorCode: null,
      warnings: [...prepared.warnings]
    };
    if (!privacyMode) responseRecord = { id: taskId, receivedAt: (options.now ?? Date.now)(), bytes: read.bytes, contentType: read.contentType, isBinary: read.isBinary };
    else {
      while (ephemeralResponses.size >= 10) {
        const oldest = ephemeralResponses.keys().next().value;
        if (oldest) ephemeralResponses.delete(oldest);
        else break;
      }
      ephemeralResponses.set(taskId, { bytes: read.bytes, contentType: read.contentType, isBinary: read.isBinary, receivedAt: Date.now() });
    }
  } catch (error) {
    const aborted = controller.signal.aborted;
    const errorCode = error instanceof ResponseTooLargeError ? "RESPONSE_TOO_LARGE"
      : timedOut ? "REQUEST_TIMEOUT"
        : aborted ? "REQUEST_CANCELLED"
          : error instanceof RequestPreparationError ? error.code
            : sourceDraft.redirectMode !== "follow" && /redirect/i.test(errorMessage(error)) ? "REDIRECT_BLOCKED" : "NETWORK_ERROR";
    result = {
      id: taskId,
      taskId,
      requestId,
      status: errorCode === "REQUEST_TIMEOUT" ? "timed_out" : errorCode === "REQUEST_CANCELLED" ? "cancelled" : "failed",
      timingMs: Math.max(0, Math.round(performance.now() - startedAt)),
      statusCode: null,
      finalUrl: prepared.url,
      headers: {},
      contentType: "",
      receivedBytes: 0,
      bodyRef: null,
      previewText: "",
      isBinary: false,
      truncated: false,
      errorCode,
      errorMessage: errorCode === "REDIRECT_BLOCKED" ? "The browser blocked a redirect. Enable Follow redirects to request the final URL." : errorMessage(error),
      warnings: [...prepared.warnings]
    };
  } finally {
    clearTimeout(timeoutHandle);
    clearInterval(heartbeat);
    options.signal?.removeEventListener("abort", forwardAbort);
    try { await clearRestrictedHeaderRules(options.dnr, installedRuleIds.length ? installedRuleIds : [...RESTRICTED_RULE_IDS]); }
    catch { result.warnings.push("A temporary header rule could not be removed; it will be cleared during recovery before another request."); }
  }

  const completedAt = (options.now ?? Date.now)();
  const historyRecord = privacyMode ? undefined : {
    id: taskId,
    requestId,
    createdAt: completedAt,
    request: persistedRequest,
    result: { ...result, previewText: undefined, errorMessage: undefined },
    errorCode: result.errorCode
  };
  try {
    await options.repositories.completeTask({ taskId, historyRecord, responseRecord, now: completedAt });
  } catch {
    await options.repositories.releaseActiveTask(taskId).catch(() => {});
    result.warnings.push("The request finished, but cTool could not save the result locally. Check available storage space.");
  }
  return result;
}

/** @type {Map<string,{bytes:Uint8Array,contentType:string,isBinary:boolean,receivedAt:number}>} */
const ephemeralResponses = new Map();

/** @param {string} id @param {number} offset @param {number} size */
export function getEphemeralResponseChunk(id, offset, size) {
  const entry = ephemeralResponses.get(id);
  if (!entry || Date.now() - entry.receivedAt > 30 * 60 * 1000) { ephemeralResponses.delete(id); return null; }
  return { bytes: [...entry.bytes.subarray(Math.max(0, offset), Math.max(0, offset) + Math.min(256 * 1024, Math.max(0, size)))], totalBytes: entry.bytes.byteLength, contentType: entry.contentType, isBinary: entry.isBinary };
}

export { RESPONSE_PREVIEW_LIMIT };

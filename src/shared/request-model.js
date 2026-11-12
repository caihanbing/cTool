/** @typedef {{id:string, name:string, value:string, enabled:boolean}} ValueRow */
/** @typedef {{id:string, name:string, value:string, enabled:boolean, isFile?:boolean, fileName?:string, fileType?:string, filePathHint?:string}} FormField */
/** @typedef {{type:'none'} | {type:'basic',username:string,password:string} | {type:'bearer',token:string}} AuthConfig */
/** @typedef {{type:'none'|'json'|'text'|'urlencoded'|'multipart',text:string,fields:FormField[]}} RequestBody */
/** @typedef {{id:string,name:string,method:string,url:string,query:ValueRow[],headers:ValueRow[],auth:AuthConfig,body:RequestBody,redirectMode:'error'|'follow',timeoutMs:number,environmentId:string|null}} RequestDraft */
/** @typedef {Omit<Partial<RequestDraft>, 'body'|'auth'|'query'|'headers'> & {body?:{type?:RequestBody['type'],text?:string,fields?:Array<Partial<FormField>>},auth?:AuthConfig,query?:Array<Partial<ValueRow>>,headers?:Array<Partial<ValueRow>>} } RequestDraftInput */

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** @param {Partial<ValueRow> & {name?:string,value?:string}} row */
function valueRow(row) {
  return { id: row.id ?? crypto.randomUUID(), name: text(row.name), value: text(row.value), enabled: row.enabled !== false };
}

/**
 * Create the canonical mutable request object used by all views and transports.
 * @param {RequestDraftInput} [input]
 * @returns {RequestDraft}
 */
export function createRequestDraft(input = {}) {
  let url = text(input.url) || "https://example.com/";
  /** @type {ValueRow[]} */
  let query = (input.query ?? []).map(valueRow);
  if (!input.query) {
    const queryAt = url.indexOf("?");
    const hashAt = url.indexOf("#");
    if (queryAt >= 0 && (hashAt < 0 || queryAt < hashAt)) {
      const end = hashAt < 0 ? url.length : hashAt;
      const rawQuery = url.slice(queryAt + 1, end);
      const hash = hashAt < 0 ? "" : url.slice(hashAt);
      url = url.slice(0, queryAt) + hash;
      query = rawQuery ? rawQuery.split("&").map((part) => {
        const splitAt = part.indexOf("=");
        /** @param {string} value */
        const decode = (value) => {
          try { return decodeURIComponent(value.replaceAll("+", " ")); }
          catch { return value; }
        };
        return valueRow({ name: decode(splitAt < 0 ? part : part.slice(0, splitAt)), value: decode(splitAt < 0 ? "" : part.slice(splitAt + 1)) });
      }) : [];
    }
  }
  const method = text(input.method || "GET").toUpperCase();
  /** @type {AuthConfig} */
  const auth = input.auth?.type === "basic"
    ? { type: "basic", username: text(input.auth.username), password: text(input.auth.password) }
    : input.auth?.type === "bearer"
      ? { type: "bearer", token: text(input.auth.token) }
      : { type: "none" };
  const bodyInput = input.body ?? {};
  const inputBodyType = bodyInput.type;
  /** @type {RequestBody} */
  const body = {
    type: inputBodyType === "json" || inputBodyType === "text" || inputBodyType === "urlencoded" || inputBodyType === "multipart" ? inputBodyType : "none",
    text: text(bodyInput.text),
    fields: (bodyInput.fields ?? []).map((field) => ({ ...valueRow(field), ...(field.isFile ? { isFile: true } : {}), ...(field.fileName ? { fileName: text(field.fileName) } : {}), ...(field.fileType ? { fileType: text(field.fileType) } : {}), ...(field.filePathHint ? { filePathHint: text(field.filePathHint) } : {}) }))
  };
  return {
    id: input.id ?? crypto.randomUUID(),
    name: text(input.name) || "New request",
    method: METHODS.has(method) ? method : method || "GET",
    url,
    query,
    headers: (input.headers ?? []).map(valueRow),
    auth,
    body,
    redirectMode: input.redirectMode === "follow" ? "follow" : "error",
    timeoutMs: Number.isFinite(input.timeoutMs) ? Math.min(300_000, Math.max(1, Number(input.timeoutMs))) : 25_000,
    environmentId: input.environmentId ?? null
  };
}

/** @param {RequestDraft} draft */
export function composeRequestUrl(draft) {
  const active = draft.query.filter((row) => row.enabled);
  if (!active.length) return draft.url;
  const hashAt = draft.url.indexOf("#");
  const base = hashAt < 0 ? draft.url : draft.url.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : draft.url.slice(hashAt);
  const params = new URLSearchParams();
  for (const row of active) params.append(row.name, row.value);
  return base + (base.includes("?") ? "&" : "?") + params.toString() + hash;
}

/** @param {RequestDraft} draft */
export function getAuthorizationConflict(draft) {
  return draft.auth.type !== "none" && draft.headers.some((header) => header.enabled && header.name.trim().toLowerCase() === "authorization");
}

/** @param {RequestDraft} draft */
export function validateRequestDraft(draft) {
  /** @type {Array<{code:string,message:string}>} */
  const errors = [];
  let parsed;
  try { parsed = new URL(composeRequestUrl(draft)); }
  catch { errors.push({ code: "INVALID_URL", message: "Enter a valid absolute HTTP or HTTPS URL." }); }
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(draft.method)) errors.push({ code: "INVALID_METHOD", message: "Enter a valid HTTP method token." });
  if (["CONNECT", "TRACE", "TRACK"].includes(draft.method)) errors.push({ code: "BROWSER_BLOCKED_METHOD", message: `${draft.method} is blocked by browsers and cannot be sent from an extension.` });
  if (parsed && parsed.protocol !== "http:" && parsed.protocol !== "https:") errors.push({ code: "URL_SCHEME", message: "Only HTTP and HTTPS requests are supported." });
  if (getAuthorizationConflict(draft)) errors.push({ code: "AUTHORIZATION_CONFLICT", message: "Choose either the configured authentication or the Authorization header." });
  if ((draft.method === "GET" || draft.method === "HEAD") && draft.body.type !== "none") errors.push({ code: "BODY_METHOD_CONFLICT", message: `${draft.method} requests cannot include a body in the browser transport.` });
  return errors;
}

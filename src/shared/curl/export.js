import { composeRequestUrl, getAuthorizationConflict } from "../request-model.js";

/** @param {string} value */
function quoteBash(value) { return "'" + value.replaceAll("'", "'\\''") + "'"; }

/**
 * Quote one Windows command-line argument using the quoting rules used by the
 * CRT argv parser. CMD percent expansion remains shell behavior; see docs.
 * @param {string} value
 */
function quoteCmd(value) {
  let result = '"';
  let slashes = 0;
  for (const char of value) {
    if (char === "\\") { slashes += 1; continue; }
    if (char === '"') { result += "\\".repeat(slashes * 2 + 1) + '"'; slashes = 0; continue; }
    result += "\\".repeat(slashes) + char;
    slashes = 0;
  }
  return result + "\\".repeat(slashes * 2) + '"';
}

/** @param {import('../request-model.js').RequestDraft} draft @param {'bash'|'cmd'} [shell] */
export function buildCurlCommand(draft, shell = "bash") {
  if (getAuthorizationConflict(draft)) throw new Error("Resolve the Authorization header and authentication conflict before generating cURL.");
  const quote = shell === "cmd" ? quoteCmd : quoteBash;
  const parts = [shell === "cmd" ? "curl.exe" : "curl"];
  if (draft.method !== "GET") parts.push("--request", quote(draft.method));
  if (draft.redirectMode === "follow") parts.push("--location");
  for (const header of draft.headers) if (header.enabled) parts.push("--header", quote(`${header.name}: ${header.value}`));
  if (draft.auth.type === "basic") parts.push("--user", quote(`${draft.auth.username}:${draft.auth.password}`));
  if (draft.auth.type === "bearer") parts.push("--header", quote(`Authorization: Bearer ${draft.auth.token}`));

  if (draft.body.type === "json" || draft.body.type === "text") parts.push("--data-raw", quote(draft.body.text));
  if (draft.body.type === "urlencoded") {
    if (draft.body.fields.length) {
      for (const field of draft.body.fields) if (field.enabled) parts.push("--data-urlencode", quote(field.name ? `${field.name}=${field.value}` : field.value));
    } else parts.push("--data-raw", quote(draft.body.text));
  }
  if (draft.body.type === "multipart") {
    for (const field of draft.body.fields) {
      if (!field.enabled) continue;
      if (field.isFile) {
        const file = field.filePathHint || field.fileName || "<select-file>";
        const type = field.fileType && field.fileType !== "application/octet-stream" ? `;type=${field.fileType}` : "";
        parts.push("--form", quote(`${field.name}=@${file}${type}`));
      } else parts.push("--form-string", quote(`${field.name}=${field.value}`));
    }
  }
  parts.push("--url", quote(composeRequestUrl(draft)));
  return parts.join(" ");
}

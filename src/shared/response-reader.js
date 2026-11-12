export const RESPONSE_RECEIVE_LIMIT = 20 * 1024 * 1024;
export const RESPONSE_PREVIEW_LIMIT = 1024 * 1024;

export class ResponseTooLargeError extends Error {
  /** @param {number} limitBytes */
  constructor(limitBytes) { super(`The response exceeded the ${Math.round(limitBytes / 1024 / 1024)} MiB receive limit.`); this.name = "ResponseTooLargeError"; this.limitBytes = limitBytes; }
}

/** @param {string} contentType */
function isTextType(contentType) {
  const type = contentType.split(";", 1)[0].trim().toLowerCase();
  return type.startsWith("text/") || ["application/json", "application/ld+json", "application/xml", "text/xml", "application/javascript", "application/x-javascript", "application/x-www-form-urlencoded"].includes(type) || type.endsWith("+json") || type.endsWith("+xml");
}

/** @param {Uint8Array} bytes */
function looksLikeText(bytes) {
  if (bytes.includes(0)) return false;
  try {
    const sample = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
    const controls = [...sample].filter((char) => char < " " && char !== "\n" && char !== "\r" && char !== "\t" && char !== "\f").length;
    return controls / Math.max(1, sample.length) < 0.02;
  } catch { return false; }
}

/** @param {string} contentType */
function textDecoder(contentType) {
  const charset = contentType.match(/charset\s*=\s*["']?([^;"']+)/i)?.[1]?.trim();
  try { return new TextDecoder(charset || "utf-8"); }
  catch { return new TextDecoder("utf-8"); }
}

/**
 * Read a response body in bounded chunks. HTTP error statuses are intentionally returned normally.
 * @param {Response} response
 * @param {{maxBytes?:number,previewBytes?:number}} [options]
 */
export async function readResponse(response, options = {}) {
  const maxBytes = options.maxBytes ?? RESPONSE_RECEIVE_LIMIT;
  const previewBytes = options.previewBytes ?? RESPONSE_PREVIEW_LIMIT;
  /** @type {Uint8Array[]} */
  const chunks = [];
  let receivedBytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > maxBytes) {
          await reader.cancel("Response receive limit exceeded.").catch(() => {});
          throw new ResponseTooLargeError(maxBytes);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const contentType = response.headers.get("content-type") ?? "";
  const isBinary = !isTextType(contentType) && !looksLikeText(bytes);
  const preview = bytes.subarray(0, previewBytes);
  const previewText = isBinary ? "" : textDecoder(contentType).decode(preview);
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    finalUrl: response.url,
    contentType,
    bytes,
    receivedBytes,
    previewText,
    isBinary,
    truncated: receivedBytes > previewBytes
  };
}

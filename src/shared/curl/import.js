import { createRequestDraft } from "../request-model.js";
import { CurlParseError } from "./errors.js";
import { tokenizeCurlCommand } from "./tokenize.js";

/** @typedef {import('../request-model.js').RequestBody['type']} BodyType */
/** @typedef {import('../request-model.js').AuthConfig} AuthConfig */
/** @typedef {{name:string,value:string,enabled:boolean,isFile?:boolean,fileName?:string,fileType?:string,filePathHint?:string}} ImportedField */

const UNSUPPORTED = new Set([
  "-x", "--proxy", "--preproxy", "--proxy-user", "--proxy-pass", "--proxy-cacert", "--proxy-cert", "--proxy-key",
  "--cacert", "--capath", "--cert", "--cert-type", "--key", "--key-type", "--pinnedpubkey", "--resolve", "--connect-to",
  "--interface", "--unix-socket", "--abstract-unix-socket", "--cookie-jar", "-c", "--config", "--location-trusted"
]);
const VALUE_OPTIONS = new Set([
  "-X", "--request", "-H", "--header", "-b", "--cookie", "-u", "--user", "-d", "--data", "--data-raw", "--data-binary", "--data-ascii",
  "--data-urlencode", "-F", "--form", "--form-string", "-e", "--referer", "-A", "--user-agent", "--url", "--max-time", "--connect-timeout", "-o", "--output"
]);

/** @param {string} value */
function row(value) { return { name: "", value, enabled: true }; }
/** @param {string} value */
function decodePart(value) {
  try { return decodeURIComponent(value.replaceAll("+", " ")); }
  catch { return value; }
}
/** @param {string} url */
function splitUrl(url) {
  const queryAt = url.indexOf("?");
  const hashAt = url.indexOf("#");
  if (queryAt < 0 || (hashAt >= 0 && queryAt > hashAt)) return { url, query: [] };
  const end = hashAt < 0 ? url.length : hashAt;
  const source = url.slice(queryAt + 1, end);
  const hash = hashAt < 0 ? "" : url.slice(hashAt);
  const query = source ? source.split("&").map((part) => {
    const equalsAt = part.indexOf("=");
    return { ...row(decodePart(equalsAt < 0 ? "" : part.slice(equalsAt + 1))), name: decodePart(equalsAt < 0 ? part : part.slice(0, equalsAt)) };
  }) : [];
  return { url: url.slice(0, queryAt) + hash, query };
}
/** @param {string} value */
function splitField(value) {
  const at = value.indexOf("=");
  if (at < 0) return { name: value, value: "" };
  return { name: value.slice(0, at), value: value.slice(at + 1) };
}
/** @param {string} path */
function basename(path) { return path.split(/[\\/]/).filter(Boolean).at(-1) || "upload"; }
/** @param {string} argument @param {boolean} stringOnly */
function parseFormField(argument, stringOnly = false) {
  const equalsAt = argument.indexOf("=");
  if (equalsAt < 1) throw new CurlParseError("INVALID_FORM_FIELD", "Form fields must use name=value syntax.");
  const name = argument.slice(0, equalsAt);
  const source = argument.slice(equalsAt + 1);
  const fileAt = !stringOnly && source.startsWith("@") ? source.slice(1) : "";
  if (!fileAt) return { ...row(source), name, isFile: false };
  const [filePathHint, ...attributes] = fileAt.split(";");
  let fileName = basename(filePathHint);
  let fileType = "application/octet-stream";
  for (const attribute of attributes) {
    const splitAt = attribute.indexOf("=");
    if (splitAt < 0) continue;
    const key = attribute.slice(0, splitAt).toLowerCase();
    const value = attribute.slice(splitAt + 1);
    if (key === "type") fileType = value;
    if (key === "filename") fileName = value;
    if (key === "headers") throw new CurlParseError("UNSUPPORTED_FORM_HEADER", "Custom per-part headers are not supported in multipart imports.");
  }
  return { ...row(""), name, isFile: true, fileName, fileType, filePathHint };
}

/**
 * Parse a pasted command as arguments only. No shell or local program is executed.
 * @param {string} source @param {'bash'|'cmd'|'auto'} [shell]
 */
export function parseCurlCommand(source, shell = "auto") {
  const args = tokenizeCurlCommand(source, shell);
  /** @type {string[]} */
  const warnings = [];
  /** @type {Array<{name:string,value:string,enabled:boolean}>} */
  const headers = [];
  /** @type {Array<{name:string,value:string,enabled:boolean}>} */
  const query = [];
  /** @type {Array<{name:string,value:string,enabled:boolean,isFile?:boolean,fileName?:string,fileType?:string,filePathHint?:string}>} */
  /** @type {ImportedField[]} */
  const fields = [];
  let url = "";
  let explicitMethod = "";
  let inferredMethod = "GET";
  /** @type {BodyType} */
  let bodyType = "none";
  let bodyText = "";
  /** @type {'error'|'follow'} */
  let redirectMode = "error";
  let timeoutMs = 25_000;
  /** @type {AuthConfig} */
  let auth = { type: "none" };
  let getData = false;

  /** @param {string} value @param {BodyType} [type] */
  const addBodyData = (value, type = "text") => {
    if (bodyType === "none") { bodyType = type; bodyText = value; }
    else if (bodyType === type) bodyText += "&" + value;
    else throw new CurlParseError("MIXED_BODY_TYPES", "This command mixes incompatible request body options.");
    if (!explicitMethod) inferredMethod = "POST";
  };
  /** @param {string} option @param {number} index */
  const valueFor = (option, index) => {
    const equalsAt = option.indexOf("=");
    if (option.startsWith("--") && equalsAt >= 0) return { value: option.slice(equalsAt + 1), next: index };
    if (index + 1 >= args.length) throw new CurlParseError("MISSING_OPTION_VALUE", `Option ${option.split("=")[0]} requires a value.`);
    return { value: args[index + 1], next: index + 1 };
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("-") || arg === "-") {
      if (url) throw new CurlParseError("MULTIPLE_URLS", "Only one request URL can be imported at a time.");
      url = arg;
      continue;
    }
    const optionName = arg.startsWith("--") && arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    const optionKey = optionName.startsWith("--") ? optionName.toLowerCase() : optionName;
    if (UNSUPPORTED.has(optionKey)) throw new CurlParseError("UNSUPPORTED_OPTION", `The ${optionName} option uses local or transport behavior that the browser extension cannot reproduce.`);
    if (["-s", "--silent", "-S", "--show-error", "--no-buffer", "--fail", "--fail-with-body", "-i", "--include"].includes(optionKey)) {
      if (optionKey === "-i" || optionKey === "--include") warnings.push("Response headers are always available in the browser workbench.");
      if (optionKey === "--fail" || optionKey === "--fail-with-body") warnings.push("HTTP error responses are kept visible; the browser does not turn them into cURL process exit codes.");
      continue;
    }
    if (["--compressed", "-k", "--insecure", "--path-as-is", "--http1.0", "--http1.1", "--http2", "--http2-prior-knowledge", "-v", "--verbose"].includes(optionKey)) {
      /** @type {Record<string,string>} */
      const messages = {
        "--compressed": "Compression negotiation and decompression are controlled by the browser.",
        "-k": "The browser always verifies TLS certificates; insecure TLS mode is not available.",
        "--insecure": "The browser always verifies TLS certificates; insecure TLS mode is not available.",
        "--path-as-is": "The browser may normalize URL paths before sending the request.",
        "--http1.0": "The browser chooses the HTTP protocol version.",
        "--http1.1": "The browser chooses the HTTP protocol version.",
        "--http2": "The browser chooses the HTTP protocol version.",
        "--http2-prior-knowledge": "The browser chooses the HTTP protocol version.",
        "-v": "Verbose cURL transport logging is not available; response details are shown in the workbench.",
        "--verbose": "Verbose cURL transport logging is not available; response details are shown in the workbench."
      };
      warnings.push(messages[optionKey]);
      continue;
    }
    if (optionKey === "-L" || optionKey === "--location") { redirectMode = "follow"; continue; }
    if (optionKey === "-G" || optionKey === "--get") { getData = true; continue; }
    if (optionKey === "-I" || optionKey === "--head") { inferredMethod = "HEAD"; continue; }
    if (optionKey === "--basic") continue;
    if (["--digest", "--ntlm", "--negotiate", "--anyauth"].includes(optionKey)) throw new CurlParseError("UNSUPPORTED_AUTH", `The ${optionName} authentication mode is not supported.`);

    if (/^-[sSivgkLG]+$/.test(optionKey) && optionKey.length > 2) {
      for (const flag of optionKey.slice(1)) {
        if (flag === "L") redirectMode = "follow";
        else if (flag === "G") getData = true;
        else if (flag === "i") warnings.push("Response headers are always available in the browser workbench.");
        else if (flag === "k") warnings.push("The browser always verifies TLS certificates; insecure TLS mode is not available.");
        else if (flag !== "s" && flag !== "S" && flag !== "v") throw new CurlParseError("UNSUPPORTED_OPTION", `The ${optionName} option is not supported.`);
      }
      continue;
    }

    if (!VALUE_OPTIONS.has(optionKey)) throw new CurlParseError("UNSUPPORTED_OPTION", `The ${optionName} option is not supported by cTool.`);
    const { value, next } = valueFor(arg, index);
    index = next;
    switch (optionKey) {
      case "-X": case "--request": explicitMethod = value.toUpperCase(); break;
      case "-H": case "--header": {
        const colon = value.indexOf(":");
        if (colon < 1) throw new CurlParseError("INVALID_HEADER", "Request headers must use Name: value syntax.");
        headers.push({ name: value.slice(0, colon).trim(), value: value.slice(colon + 1).trimStart(), enabled: true });
        break;
      }
      case "-b": case "--cookie": {
        if (!value.includes("=")) throw new CurlParseError("COOKIE_JAR_UNSUPPORTED", "Cookie jar files are not read. Enter cookie values directly or import a Cookie header.");
        headers.push({ name: "Cookie", value, enabled: true });
        break;
      }
      case "-u": case "--user": {
        const colon = value.indexOf(":");
        auth = { type: "basic", username: colon < 0 ? value : value.slice(0, colon), password: colon < 0 ? "" : value.slice(colon + 1) };
        break;
      }
      case "-d": case "--data": case "--data-raw": case "--data-binary": case "--data-ascii": addBodyData(value); break;
      case "--data-urlencode": {
        const split = value.indexOf("=");
        fields.push({ ...row(split < 0 ? value : value.slice(split + 1)), name: split < 0 ? "" : value.slice(0, split), enabled: true });
        bodyType = "urlencoded";
        if (!explicitMethod) inferredMethod = "POST";
        break;
      }
      case "-F": case "--form": case "--form-string":
        fields.push(parseFormField(value, optionKey === "--form-string"));
        bodyType = "multipart";
        if (!explicitMethod) inferredMethod = "POST";
        break;
      case "-e": case "--referer": headers.push({ name: "Referer", value, enabled: true }); break;
      case "-A": case "--user-agent": headers.push({ name: "User-Agent", value, enabled: true }); break;
      case "--url": url = value; break;
      case "--max-time": {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds <= 0) throw new CurlParseError("INVALID_TIMEOUT", "--max-time requires a positive number of seconds.");
        timeoutMs = Math.min(300_000, Math.max(1, seconds * 1000));
        break;
      }
      case "--connect-timeout": throw new CurlParseError("CONNECT_TIMEOUT_UNSUPPORTED", "Separate connection timeouts are not available in browser fetch; use the total request timeout.");
      case "-o": case "--output": warnings.push("The output filename is ignored; use the response download action to save the body."); break;
      default: throw new CurlParseError("UNSUPPORTED_OPTION", `The ${optionName} option is not supported by cTool.`);
    }
  }
  if (!url) throw new CurlParseError("MISSING_URL", "No request URL was found in the cURL command.");
  if (!/^https?:\/\//i.test(url) && !/\{\{[A-Za-z_][\w.-]*\}\}/.test(url)) throw new CurlParseError("INVALID_URL", "Only absolute HTTP and HTTPS URLs are supported.");
  /** @type {BodyType} */
  const importedBodyType = /** @type {BodyType} */ (String(bodyType));
  if (getData && importedBodyType !== "none") {
    if (importedBodyType === "text") {
      const data = bodyText.split("&").map(splitField);
      fields.push(...data.map(({ name, value }) => ({ ...row(value), name, enabled: true })));
      bodyType = "urlencoded";
      bodyText = "";
    } else if (importedBodyType !== "urlencoded") throw new CurlParseError("GET_BODY_UNSUPPORTED", "-G can only move text or URL-encoded data into the query string.");
    const split = splitUrl(url);
    query.push(...split.query, ...fields.map(({ name, value }) => ({ ...row(value), name, enabled: true })));
    url = split.url;
    fields.length = 0;
    bodyType = "none";
  }
  const split = splitUrl(url);
  const draft = createRequestDraft({
    url: split.url,
    query: [...split.query, ...query],
    method: explicitMethod || inferredMethod,
    headers,
    auth,
    body: { type: bodyType, text: bodyText, fields },
    redirectMode,
    timeoutMs
  });
  return { draft, warnings };
}

export { CurlParseError };

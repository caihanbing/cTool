import { CurlParseError } from "./errors.js";

/** @param {string} input @param {'bash'|'cmd'|'auto'} shell */
export function tokenizeCurlCommand(input, shell = "auto") {
  if (typeof input !== "string" || !input.trim()) throw new CurlParseError("EMPTY_COMMAND", "Paste a cURL command first.");
  const inferred = shell === "auto" ? (/curl\.exe\b|\^\s*\r?\n/i.test(input) ? "cmd" : "bash") : shell;
  const source = inferred === "cmd"
    ? input.replace(/\^[ \t]*\r?\n/g, " ")
    : input.replace(/\\[ \t]*\r?\n/g, " ");
  /** @type {string[]} */
  const tokens = [];
  let current = "";
  let started = false;
  let quote = "";
  const push = () => { if (started) tokens.push(current); current = ""; started = false; };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inferred === "cmd" && char === "^") {
      if (index + 1 < source.length) { current += source[index + 1]; started = true; index += 1; }
      continue;
    }
    if (inferred === "cmd" && char === "\\") {
      let end = index;
      while (source[end] === "\\") end += 1;
      const count = end - index;
      if (source[end] === '"') {
        current += "\\".repeat(Math.floor(count / 2));
        if (count % 2) current += '"';
        else quote = quote ? "" : '"';
        started = true;
        index = end;
      } else {
        current += "\\".repeat(count);
        started = true;
        index = end - 1;
      }
      continue;
    }
    if (inferred === "bash" && char === "\\") {
      if (index + 1 < source.length) { current += source[index + 1]; started = true; index += 1; }
      else current += char;
      continue;
    }
    if (inferred === "bash" && char === "'" && quote !== '"') { quote = quote ? "" : "'"; started = true; continue; }
    if (char === '"' && quote !== "'") { quote = quote ? "" : '"'; started = true; continue; }
    if (!quote && /\s/.test(char)) { push(); continue; }
    current += char;
    started = true;
  }
  if (quote) throw new CurlParseError("UNMATCHED_QUOTE", "The cURL command contains an unmatched quote.");
  push();
  if (!tokens.length || !/^curl(?:\.exe)?$/i.test(tokens[0])) throw new CurlParseError("INVALID_COMMAND", "The input must start with curl or curl.exe.");
  return tokens.slice(1);
}

export class CurlParseError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.name = "CurlParseError"; this.code = code; }
}

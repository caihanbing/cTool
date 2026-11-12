export const BACKUP_SCHEMA_VERSION = 1;
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const COLLECTIONS = ["drafts", "history", "favorites", "environments", "globalVariables"];

/** @param {unknown} record @returns {record is Record<string,any>} */
function looksLikeRecord(record) { return Boolean(record && typeof record === "object" && !Array.isArray(record)); }

/** @param {string} name @param {any[]} items */
function validateRows(name, items) {
  const errors = [];
  if (!Array.isArray(items)) return [`${name} must be an array.`];
  if (items.length > 1000) return [`${name} exceeds the 1,000 item import limit.`];
  for (const [index, item] of items.entries()) {
    if (!looksLikeRecord(item)) { errors.push(`${name}[${index}] must be an object.`); continue; }
    if (name === "drafts" && (!looksLikeRecord(item) || typeof item.url !== "string")) errors.push(`drafts[${index}] is missing a URL.`);
    if (name === "favorites" && (typeof item.name !== "string" || !looksLikeRecord(item.request))) errors.push(`favorites[${index}] must include a name and request.`);
    if (name === "history" && item.request != null && !looksLikeRecord(item.request)) errors.push(`history[${index}].request must be an object.`);
    if (name === "environments" && (typeof item.name !== "string" || !Array.isArray(item.variables))) errors.push(`environments[${index}] must include a name and variables array.`);
    if (name === "globalVariables" && (typeof item.name !== "string" || typeof item.value !== "string")) errors.push(`globalVariables[${index}] must include string name and value fields.`);
  }
  return errors;
}

/**
 * Create a portable backup. Ephemeral response bodies are deliberately excluded;
 * request history and saved request definitions remain in the export.
 * @param {ReturnType<typeof import('./repositories.js').createRepositories>} repositories
 * @param {{includeSecrets?:boolean,now?:()=>number}} [options]
 */
export async function buildBackup(repositories, options = {}) {
  const [drafts, history, favorites, environments, variables] = await Promise.all([
    repositories.listDrafts(), repositories.listHistory(), repositories.listFavorites(), repositories.listEnvironments(), repositories.getGlobalVariables()
  ]);
  /** @type {Array<{id?:string,name:string,value:string,secret?:boolean}>} */
  const globalVariables = variables;
  return {
    product: "cTool",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date((options.now ?? Date.now)()).toISOString(),
    drafts,
    history: history.map(({ responseBody, body, ...record }) => record),
    favorites,
    environments,
    globalVariables: globalVariables.filter((variable) => options.includeSecrets === true || variable.secret !== true)
  };
}

/** @param {string|unknown} source */
export function previewBackup(source) {
  /** @type {string[]} */
  const errors = [];
  let data = source;
  if (typeof source === "string") {
    if (new TextEncoder().encode(source).byteLength > MAX_BACKUP_BYTES) return { valid: false, errors: ["The backup exceeds the 10 MiB import limit."], counts: null, data: null };
    try { data = JSON.parse(source); }
    catch { return { valid: false, errors: ["The file is not valid JSON."], counts: null, data: null }; }
  }
  if (!looksLikeRecord(data)) return { valid: false, errors: ["The backup root must be a JSON object."], counts: null, data: null };
  const record = data;
  if (record.product !== "cTool") errors.push("The file is not a cTool backup.");
  if (record.schemaVersion !== BACKUP_SCHEMA_VERSION) errors.push(`Unsupported backup schema version: ${String(record.schemaVersion)}.`);
  for (const collection of COLLECTIONS) errors.push(...validateRows(collection, record[collection]));
  const counts = Object.fromEntries(COLLECTIONS.map((name) => [name, Array.isArray(record[name]) ? record[name].length : 0]));
  return { valid: errors.length === 0, errors, counts, data: errors.length ? null : structuredClone(record) };
}

/** @param {{valid:boolean,data:Record<string,any>|null,errors:string[]}} preview @param {ReturnType<typeof import('./repositories.js').createRepositories>} repositories */
export async function importBackup(preview, repositories) {
  if (!preview.valid || !preview.data) throw new Error(preview.errors.join(" ") || "Review a valid backup before importing it.");
  return repositories.mergeBackup(preview.data);
}

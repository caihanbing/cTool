/** @typedef {{name:string,value:string,secret?:boolean}} EnvironmentVariable */

/** @param {import('./request-model.js').RequestDraft} draft @param {EnvironmentVariable[]} [globals] @param {{variables?:EnvironmentVariable[]}|null} [environment] */
export function resolveEnvironment(draft, globals = [], environment = null) {
  const values = new Map();
  for (const variable of globals) values.set(variable.name, String(variable.value ?? ""));
  for (const variable of environment?.variables ?? []) values.set(variable.name, String(variable.value ?? ""));
  const missing = new Set();
  /** @param {string} source */
  const replace = (source) => String(source ?? "").replace(/\{\{([A-Za-z_][\w.-]*)\}\}/g, (match, name) => {
    if (!values.has(name)) { missing.add(name); return match; }
    return values.get(name);
  });
  /** @type {import('./request-model.js').RequestDraft} */
  const result = structuredClone(draft);
  result.url = replace(result.url);
  for (const row of result.query ?? []) if (row.enabled) { row.name = replace(row.name); row.value = replace(row.value); }
  for (const row of result.headers ?? []) if (row.enabled) { row.name = replace(row.name); row.value = replace(row.value); }
  if (result.auth?.type === "basic") {
    result.auth.username = replace(result.auth.username);
    result.auth.password = replace(result.auth.password);
  } else if (result.auth?.type === "bearer") result.auth.token = replace(result.auth.token);
  if (result.body.type === "json" || result.body.type === "text" || (result.body.type === "urlencoded" && result.body.fields.length === 0)) {
    result.body.text = replace(result.body.text);
  }
  if (result.body.type === "urlencoded" || result.body.type === "multipart") {
    for (const field of result.body.fields ?? []) if (field.enabled) { field.name = replace(field.name); field.value = replace(field.value); }
  }
  return { draft: result, missing: [...missing] };
}

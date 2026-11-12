import { createRequestDraft } from "../request-model.js";
import { parseCurlCommand } from "../curl/import.js";

/** @param {{repositories:ReturnType<typeof import('./repositories.js').createRepositories>,localStorage:Storage,now?:()=>number}} options */
export async function migrateLegacyHistory({ repositories, localStorage, now = Date.now }) {
  if (await repositories.getMeta("legacyCurlHistoryV1")) return { status: "already-migrated", imported: 0 };
  const raw = localStorage?.getItem("curlHistory");
  if (raw == null || raw === "") {
    await repositories.importLegacyHistory([]);
    return { status: "empty", imported: 0 };
  }
  let decoded;
  try { decoded = JSON.parse(raw); }
  catch { return { status: "corrupt", imported: 0 }; }
  if (!Array.isArray(decoded)) return { status: "corrupt", imported: 0 };
  const records = [];
  for (const entry of decoded) {
    if (!entry || typeof entry !== "object") continue;
    let request;
    try {
      if (typeof entry.curl === "string") request = parseCurlCommand(entry.curl).draft;
      else if (typeof entry.command === "string") request = parseCurlCommand(entry.command).draft;
      else if (entry.data?.url) {
        const legacy = entry.data;
        /** @param {unknown} value */
        const rows = (value) => Array.isArray(value)
          ? value.map((row) => ({ name: String(row?.name ?? ""), value: String(row?.value ?? ""), enabled: row?.enabled !== false }))
          : Object.entries(value && typeof value === "object" ? value : {}).map(([name, item]) => ({ name, value: String(item ?? ""), enabled: true }));
        const payloadPresent = legacy.payload !== undefined && legacy.payload !== null;
        request = createRequestDraft({
          url: legacy.url,
          method: typeof legacy.method === "string" ? legacy.method : "GET",
          query: rows(legacy.query ?? legacy.parameters),
          headers: rows(legacy.headers),
          body: payloadPresent ? { type: "json", text: JSON.stringify(legacy.payload), fields: [] } : { type: "none", text: "", fields: [] }
        });
      }
      else continue;
    } catch { continue; }
    const parsedTime = Date.parse(String(entry.time ?? entry.createdAt ?? ""));
    records.push({
      id: crypto.randomUUID(),
      createdAt: Number.isFinite(parsedTime) ? parsedTime : now(),
      request,
      result: { status: entry.succeed ? "completed" : "failed", migratedWithoutResponse: true },
      migratedFromLegacy: true
    });
  }
  await repositories.importLegacyHistory(records);
  return { status: "migrated", imported: records.length };
}

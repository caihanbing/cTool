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
      else if (entry.data?.url) request = createRequestDraft({ ...entry.data, headers: Array.isArray(entry.data.headers) ? entry.data.headers : Object.entries(entry.data.headers ?? {}).map(([name, value]) => ({ name, value: String(value), enabled: true })) });
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

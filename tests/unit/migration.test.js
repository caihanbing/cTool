import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { openDatabase } from "../../src/shared/storage/database.js";
import { createRepositories } from "../../src/shared/storage/repositories.js";
import { migrateLegacyHistory } from "../../src/shared/storage/migrate-legacy.js";

function memoryStorage(value) {
  return { getItem(key) { return key === "curlHistory" ? value : null; } };
}

test("corrupt legacy JSON is left untouched and does not mark migration complete", async () => {
  const db = await openDatabase("ctool-migrate-corrupt-" + crypto.randomUUID());
  try {
    const repositories = createRepositories(db);
    const result = await migrateLegacyHistory({ repositories, localStorage: memoryStorage("{broken") });
    assert.equal(result.status, "corrupt");
    assert.equal(await repositories.getMeta("legacyCurlHistoryV1"), undefined);
    assert.deepEqual(await repositories.listHistory(), []);
  } finally { db.close(); }
});

test("valid legacy records migrate once and leave existing history intact", async () => {
  const db = await openDatabase("ctool-migrate-valid-" + crypto.randomUUID());
  try {
    const repositories = createRepositories(db);
    await repositories.addHistory({ id: "new-history", createdAt: Date.now(), request: { url: "https://new.example.test" } });
    const value = JSON.stringify([
      { time: "2025-01-01 12-00-00", curl: "curl 'https://legacy.example.test/a?x=1&x='", succeed: true },
      { time: "2025-01-02 12-00-00", curl: "not a curl command", succeed: true }
    ]);
    const first = await migrateLegacyHistory({ repositories, localStorage: memoryStorage(value), now: () => 1_800_000_000_000 });
    const second = await migrateLegacyHistory({ repositories, localStorage: memoryStorage(value), now: () => 1_800_000_000_001 });
    assert.equal(first.status, "migrated");
    assert.equal(first.imported, 1);
    assert.equal(second.status, "already-migrated");
    const records = await repositories.listHistory();
    assert.equal(records.length, 2);
    assert.equal(records.some(({ id }) => id === "new-history"), true);
    const migrated = records.find(({ migratedFromLegacy }) => migratedFromLegacy);
    assert.deepEqual(migrated.request.query.map(({ value }) => value), ["1", ""]);
  } finally { db.close(); }
});

test("migrates the original parser data shape including parameters, headers, and JSON payload", async () => {
  const db = await openDatabase("ctool-migrate-original-shape-" + crypto.randomUUID());
  try {
    const repositories = createRepositories(db);
    const source = JSON.stringify([{ time: "2025-01-03 12-00-00", succeed: true, data: {
      url: "https://legacy.example.test/items",
      method: "POST",
      parameters: { page: "2", search: "red blue" },
      headers: { "Content-Type": "application/json", "X-Legacy": "kept" },
      payload: { label: "sample" }
    } }]);
    const result = await migrateLegacyHistory({ repositories, localStorage: memoryStorage(source) });
    assert.equal(result.imported, 1);
    const migrated = (await repositories.listHistory()).find(({ migratedFromLegacy }) => migratedFromLegacy);
    assert.deepEqual(migrated.request.query.map(({ name, value }) => [name, value]), [["page", "2"], ["search", "red blue"]]);
    assert.deepEqual(migrated.request.headers.map(({ name, value }) => [name, value]), [["Content-Type", "application/json"], ["X-Legacy", "kept"]]);
    assert.equal(migrated.request.method, "POST");
    assert.equal(migrated.request.body.type, "json");
    assert.equal(migrated.request.body.text, '{"label":"sample"}');
  } finally { db.close(); }
});

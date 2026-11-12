import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { openDatabase } from "../../src/shared/storage/database.js";
import { createRepositories } from "../../src/shared/storage/repositories.js";
import { buildBackup, importBackup, previewBackup } from "../../src/shared/storage/backup.js";

test("backup excludes secret variables by default and preserves deliberate inclusion", async () => {
  const db = await openDatabase("ctool-backup-secrets-" + crypto.randomUUID());
  try {
    const repositories = createRepositories(db);
    await repositories.saveGlobalVariables([
      { id: "public", name: "host", value: "api.example.test" },
      { id: "secret", name: "token", value: "fixture-token", secret: true }
    ]);
    const safe = await buildBackup(repositories, { now: () => 1_800_000_000_000 });
    const full = await buildBackup(repositories, { includeSecrets: true, now: () => 1_800_000_000_000 });
    assert.deepEqual(safe.globalVariables.map(({ name }) => name), ["host"]);
    assert.deepEqual(full.globalVariables.map(({ name }) => name), ["host", "token"]);
  } finally { db.close(); }
});

test("backup preview validates schema and reports import counts", () => {
  assert.equal(previewBackup("{broken").valid, false);
  assert.equal(previewBackup(JSON.stringify({ product: "other", schemaVersion: 8 })).valid, false);
  const source = {
    product: "cTool",
    schemaVersion: 1,
    drafts: [{ id: "current", url: "https://example.test" }],
    history: [], favorites: [{ name: "test", request: { url: "https://example.test" } }],
    environments: [{ name: "dev", variables: [] }], globalVariables: [{ name: "host", value: "example.test" }]
  };
  const preview = previewBackup(JSON.stringify(source));
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.counts, { drafts: 1, history: 0, favorites: 1, environments: 1, globalVariables: 1 });
});

test("default import merges with new IDs and remaps selected environments", async () => {
  const db = await openDatabase("ctool-backup-merge-" + crypto.randomUUID());
  try {
    const repositories = createRepositories(db);
    await repositories.saveFavorite({ id: "existing", name: "Existing", request: { id: "req-old", url: "https://existing.test" } });
    const source = previewBackup({
      product: "cTool", schemaVersion: 1,
      drafts: [{ id: "draft-old", url: "https://{{host}}", environmentId: "env-old" }],
      history: [{ id: "history-old", createdAt: 1, request: { id: "hist-req", url: "https://{{host}}", environmentId: "env-old" } }],
      favorites: [{ id: "favorite-old", name: "Imported", request: { id: "fav-req", url: "https://{{host}}", environmentId: "env-old" } }],
      environments: [{ id: "env-old", name: "Imported env", variables: [{ name: "host", value: "api.example.test" }] }],
      globalVariables: []
    });
    assert.equal(source.valid, true);
    const counts = await importBackup(source, repositories);
    assert.deepEqual(counts, { drafts: 1, history: 1, favorites: 1, environments: 1, globalVariables: 0 });
    const favorites = await repositories.listFavorites();
    assert.equal(favorites.length, 2);
    const imported = favorites.find(({ name }) => name === "Imported");
    assert.notEqual(imported.id, "favorite-old");
    const environments = await repositories.listEnvironments();
    assert.equal(imported.request.environmentId, environments[0].id);
    assert.notEqual(imported.request.id, "fav-req");
  } finally { db.close(); }
});

test("import failures leave the existing database unchanged", async () => {
  const db = await openDatabase("ctool-backup-rollback-" + crypto.randomUUID());
  try {
    const repositories = createRepositories(db);
    await repositories.saveFavorite({ id: "existing", name: "Existing", request: { url: "https://existing.test" } });
    await assert.rejects(repositories.mergeBackup({
      drafts: [{ id: "draft", url: "https://bad.test" }], history: [], favorites: [],
      environments: [], globalVariables: [{ name: "bad", value: "not cloneable", invalid: () => 1 }]
    }));
    assert.deepEqual((await repositories.listFavorites()).map(({ name }) => name), ["Existing"]);
  } finally { db.close(); }
});

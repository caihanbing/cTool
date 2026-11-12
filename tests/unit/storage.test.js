import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { openDatabase } from "../../src/shared/storage/database.js";
import { createRepositories, StorageQuotaError } from "../../src/shared/storage/repositories.js";

async function repositorySet() {
  const db = await openDatabase("ctool-test-" + crypto.randomUUID());
  return { db, repositories: createRepositories(db), close: () => db.close() };
}

test("history writes are transactional, searchable, and capped at 100", async () => {
  const state = await repositorySet();
  try {
    await Promise.all(Array.from({ length: 120 }, (_, index) => state.repositories.addHistory({
      id: `history-${index}`,
      createdAt: index,
      request: { url: `https://example.test/${index}` },
      result: { status: "completed" }
    })));
    const all = await state.repositories.listHistory();
    assert.equal(all.length, 100);
    assert.equal(all[0].id, "history-119");
    assert.equal((await state.repositories.listHistory({ search: "/11" })).some(({ id }) => id === "history-119"), true);
    await state.repositories.deleteHistory("history-119");
    assert.equal((await state.repositories.getHistory("history-119")), undefined);
    await state.repositories.clearHistory();
    assert.equal((await state.repositories.listHistory()).length, 0);
  } finally { state.close(); }
});

test("favorites and environments support create, update, read, and delete", async () => {
  const state = await repositorySet();
  try {
    await state.repositories.saveFavorite({ id: "favorite-1", name: "Initial", request: { url: "https://example.test" } });
    await state.repositories.saveFavorite({ id: "favorite-1", name: "Updated", request: { url: "https://example.test/v2" } });
    assert.equal((await state.repositories.getFavorite("favorite-1")).name, "Updated");
    await state.repositories.deleteFavorite("favorite-1");
    assert.equal(await state.repositories.getFavorite("favorite-1"), undefined);

    await state.repositories.saveEnvironment({ id: "env-1", name: "Staging", variables: [{ name: "host", value: "stage.example.test" }] });
    assert.equal((await state.repositories.listEnvironments())[0].name, "Staging");
    await state.repositories.deleteEnvironment("env-1");
    assert.deepEqual(await state.repositories.listEnvironments(), []);
  } finally { state.close(); }
});

test("concurrent history writes retain the newest records", async () => {
  const state = await repositorySet();
  try {
    await Promise.all(Array.from({ length: 140 }, (_, index) => state.repositories.addHistory({ id: `parallel-${index}`, createdAt: index })));
    const all = await state.repositories.listHistory();
    assert.equal(all.length, 100);
    assert.equal(all[0].createdAt, 139);
    assert.equal(all.at(-1).createdAt, 40);
  } finally { state.close(); }
});

test("a failed IndexedDB transaction rolls back all writes", async () => {
  const state = await repositorySet();
  try {
    await state.repositories.addHistory({ id: "preserved", createdAt: 1 });
    await assert.rejects(state.repositories.importLegacyHistory([{ id: "bad", createdAt: 2, invalid: () => "not cloneable" }]));
    assert.equal(await state.repositories.getHistory("bad"), undefined);
    assert.equal(await state.repositories.getMeta("legacyCurlHistoryV1"), undefined);
    assert.ok(await state.repositories.getHistory("preserved"));
  } finally { state.close(); }
});

test("the active request lock is global, atomic, and only released by its owner", async () => {
  const state = await repositorySet();
  try {
    const [first, second] = await Promise.all([
      state.repositories.acquireActiveTask({ taskId: "task-a", owner: "popup" }),
      state.repositories.acquireActiveTask({ taskId: "task-b", owner: "workbench" })
    ]);
    assert.equal([first, second].filter(({ acquired }) => acquired).length, 1);
    const active = await state.repositories.getActiveTask();
    assert.ok(["task-a", "task-b"].includes(active.taskId));
    assert.equal(await state.repositories.releaseActiveTask("not-the-owner"), false);
    assert.equal((await state.repositories.getActiveTask()).taskId, active.taskId);
    assert.equal(await state.repositories.releaseActiveTask(active.taskId), true);
    assert.equal(await state.repositories.getActiveTask(), null);
  } finally { state.close(); }
});

test("response bodies expire after 24 hours and only ten are retained", async () => {
  const state = await repositorySet();
  try {
    const now = Date.now();
    await state.repositories.saveResponse({ id: "expired", receivedAt: now - 86_400_001, body: "old" }, now);
    for (let index = 0; index < 12; index += 1) await state.repositories.saveResponse({ id: `response-${index}`, receivedAt: now + index, body: `body-${index}` }, now + index);
    const retained = await state.repositories.listResponses(now + 12);
    assert.equal(retained.length, 10);
    assert.equal(retained.some(({ id }) => id === "expired"), false);
    assert.equal(retained[0].id, "response-11");
  } finally { state.close(); }
});

test("quota failures are exposed as a user-facing storage error", () => {
  const error = new DOMException("full", "QuotaExceededError");
  assert.throws(() => { throw StorageQuotaError.from(error); }, /local storage is full/i);
});

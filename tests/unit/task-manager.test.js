import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { openDatabase } from "../../src/shared/storage/database.js";
import { createRepositories } from "../../src/shared/storage/repositories.js";
import { RESTRICTED_RULE_IDS } from "../../src/shared/request-executor.js";
import { isTrustedExtensionPage, reconcileInterruptedTask } from "../../src/background/task-manager.js";

test("accepts only pages belonging to this extension", () => {
  assert.equal(isTrustedExtensionPage({ id: "abc", url: "chrome-extension://abc/popup/view/popup.html" }, "abc"), true);
  assert.equal(isTrustedExtensionPage({ id: "abc", url: "https://attacker.test/" }, "abc"), false);
  assert.equal(isTrustedExtensionPage({ id: "other", url: "chrome-extension://other/page.html" }, "abc"), false);
});

test("worker recovery removes abandoned rules and records interruption without replay", async () => {
  const db = await openDatabase("ctool-reconcile-" + crypto.randomUUID());
  try {
    const repositories = createRepositories(db);
    await repositories.acquireActiveTask({ taskId: "stale-task", requestId: "request-1", owner: "popup", request: { url: "https://fixture.test/slow" }, privacyMode: false });
    const transaction = db.transaction("meta", "readwrite");
    const active = await new Promise((resolve, reject) => {
      const request = transaction.objectStore("meta").get("activeTask");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    active.value.lastHeartbeat = 0;
    transaction.objectStore("meta").put(active);
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });

    let currentRules = [...RESTRICTED_RULE_IDS.map((id) => ({ id })), { id: 55 }];
    const dnr = {
      async getSessionRules() { return currentRules; },
      async updateSessionRules({ removeRuleIds = [] }) { currentRules = currentRules.filter(({ id }) => !removeRuleIds.includes(id)); }
    };
    const result = await reconcileInterruptedTask({ repositories, dnr, now: () => 100_000 });
    assert.deepEqual(result, { status: "interrupted", rulesRemoved: 4 });
    assert.deepEqual(currentRules, [{ id: 55 }]);
    assert.equal(await repositories.getActiveTask(), null);
    const history = await repositories.getHistory("stale-task");
    assert.equal(history.result.status, "interrupted");
    assert.equal(history.request.url, "https://fixture.test/slow");
  } finally { db.close(); }
});

test("recovery preserves a recently heartbeating workbench request", async () => {
  const db = await openDatabase("ctool-workbench-live-" + crypto.randomUUID());
  try {
    const repositories = createRepositories(db);
    await repositories.acquireActiveTask({ taskId: "live-task", requestId: "request-2", owner: "workbench", request: { url: "https://fixture.test/slow" } });
    const dnr = { async getSessionRules() { throw new Error("should not clean a live task"); }, async updateSessionRules() { throw new Error("should not clear a live rule"); } };
    const result = await reconcileInterruptedTask({ repositories, dnr, now: () => Date.now() });
    assert.deepEqual(result, { status: "workbench-active", rulesRemoved: 0 });
    assert.equal((await repositories.getActiveTask()).taskId, "live-task");
  } finally { db.close(); }
});

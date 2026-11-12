import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, loadSettings, shouldPersist, updateSettings } from "../../src/shared/storage/settings.js";

function storageMock(initial = {}) {
  const values = { ...initial };
  return {
    values,
    async get(defaults) { return { ...defaults, ...values }; },
    async set(changes) { Object.assign(values, changes); }
  };
}

test("settings are local, normalized, and partial updates preserve other values", async () => {
  const storage = storageMock({ locale: "en", theme: "dark", privacyMode: true });
  assert.equal((await loadSettings(storage)).theme, "dark");
  const updated = await updateSettings({ theme: "invalid", timeoutMs: 500_000 }, storage);
  assert.equal(updated.locale, "en");
  assert.equal(updated.privacyMode, true);
  assert.equal(updated.theme, "system");
  assert.equal(updated.timeoutMs, 300_000);
  assert.equal(storage.values.timeoutMs, 300_000);
});

test("privacy mode skips new drafts, history, and responses while explicit saves remain", () => {
  const settings = { ...DEFAULT_SETTINGS, privacyMode: true };
  assert.equal(shouldPersist(settings, "draft"), false);
  assert.equal(shouldPersist(settings, "history"), false);
  assert.equal(shouldPersist(settings, "response"), false);
  assert.equal(shouldPersist(settings, "favorite"), true);
  assert.equal(shouldPersist(settings, "environment"), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequestDraft, getAuthorizationConflict, validateRequestDraft } from "../../src/shared/request-model.js";

test("creates a complete request draft with stable defaults", () => {
  const draft = createRequestDraft({ url: "https://api.example.test/items" });
  assert.equal(draft.method, "GET");
  assert.equal(draft.url, "https://api.example.test/items");
  assert.deepEqual(draft.query, []);
  assert.deepEqual(draft.headers, []);
  assert.deepEqual(draft.auth, { type: "none" });
  assert.deepEqual(draft.body, { type: "none", text: "", fields: [] });
  assert.equal(draft.timeoutMs, 25_000);
  assert.equal(draft.redirectMode, "error");
});

test("blocks invalid URLs and auth/header conflicts", () => {
  const draft = createRequestDraft({
    url: "file:///etc/passwd",
    auth: { type: "bearer", token: "secret" },
    headers: [{ name: "authorization", value: "manual", enabled: true }]
  });
  assert.equal(getAuthorizationConflict(draft), true);
  assert.deepEqual(validateRequestDraft(draft).map((entry) => entry.code), ["URL_SCHEME", "AUTHORIZATION_CONFLICT"]);
});

test("blocks malformed and browser-forbidden HTTP methods", () => {
  assert.equal(validateRequestDraft(createRequestDraft({ method: "GET evil", url: "https://api.example.test" }))[0].code, "INVALID_METHOD");
  assert.equal(validateRequestDraft(createRequestDraft({ method: "TRACE", url: "https://api.example.test" }))[0].code, "BROWSER_BLOCKED_METHOD");
});

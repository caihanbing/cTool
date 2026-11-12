import test from "node:test";
import assert from "node:assert/strict";
import { resolveEnvironment } from "../../src/shared/environment.js";
import { createRequestDraft } from "../../src/shared/request-model.js";

test("selected environment overrides globals and substitution is single pass", () => {
  const draft = createRequestDraft({
    url: "https://{{host}}/{{path}}",
    headers: [{ name: "X-Token", value: "{{token}}", enabled: true }],
    body: { type: "text", text: "{{alias}}", fields: [] }
  });
  const resolved = resolveEnvironment(draft,
    [{ name: "host", value: "global.example.test" }, { name: "token", value: "old" }, { name: "alias", value: "{{token}}" }],
    { variables: [{ name: "host", value: "api.example.test" }, { name: "token", value: "new" }, { name: "path", value: "v2" }] }
  );
  assert.deepEqual(resolved.missing, []);
  assert.equal(resolved.draft.url, "https://api.example.test/v2");
  assert.equal(resolved.draft.headers[0].value, "new");
  assert.equal(resolved.draft.body.text, "{{token}}");
});

test("returns distinct missing variables across all request fields", () => {
  const draft = createRequestDraft({
    url: "https://{{host}}/{{host}}",
    headers: [{ name: "X-Token", value: "{{token}}", enabled: true }],
    body: { type: "text", text: "{{bodyValue}}", fields: [] }
  });
  const result = resolveEnvironment(draft, [], null);
  assert.deepEqual(result.missing.sort(), ["bodyValue", "host", "token"]);
});

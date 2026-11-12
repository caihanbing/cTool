import test from "node:test";
import assert from "node:assert/strict";
import { createRequestDraft } from "../../src/shared/request-model.js";
import { buildRestrictedHeaderRule, prepareFetchRequest, RequestPreparationError } from "../../src/shared/request-executor.js";

test("builds a credential-free fetch and moves restricted headers to a narrow DNR rule", () => {
  const draft = createRequestDraft({
    method: "POST", url: "https://api.example.test/items?x=1#section",
    headers: [
      { name: "Cookie", value: "a=1", enabled: true },
      { name: "Cookie", value: "b=2", enabled: true },
      { name: "X-Trace", value: "test", enabled: true }
    ],
    body: { type: "json", text: '{"ok":true}', fields: [] }
  });
  const prepared = prepareFetchRequest(draft);
  assert.equal(prepared.url, "https://api.example.test/items?x=1");
  assert.equal(prepared.init.credentials, "omit");
  assert.equal(prepared.init.redirect, "manual");
  assert.equal(prepared.init.headers.get("cookie"), null);
  assert.equal(prepared.init.headers.get("x-trace"), "test");
  assert.equal(prepared.restrictedHeaders.length, 2);
  const rule = buildRestrictedHeaderRule({ id: 10, extensionId: "extension-id", url: prepared.url, method: "POST", headers: prepared.restrictedHeaders });
  assert.deepEqual(rule.condition.initiatorDomains, ["extension-id"]);
  assert.deepEqual(rule.condition.requestDomains, ["api.example.test"]);
  assert.deepEqual(rule.condition.requestMethods, ["post"]);
  assert.deepEqual(rule.action.requestHeaders, [{ header: "cookie", operation: "set", value: "a=1; b=2" }]);
  assert.equal(new RegExp(rule.condition.regexFilter).test(prepared.url), true);
  assert.equal(new RegExp(rule.condition.regexFilter).test("https://api.example.test/items?x=1&other=2"), false);
});

test("creates Basic and Bearer authorization and keeps their values out of restricted headers", () => {
  const basic = prepareFetchRequest(createRequestDraft({
    method: "GET", url: "https://api.example.test", auth: { type: "basic", username: "用户", password: "secret" }
  }));
  assert.match(basic.init.headers.get("authorization"), /^Basic /);
  assert.deepEqual(basic.restrictedHeaders, []);
  const bearer = prepareFetchRequest(createRequestDraft({ method: "GET", url: "https://api.example.test", auth: { type: "bearer", token: "secret-token" } }));
  assert.equal(bearer.init.headers.get("authorization"), "Bearer secret-token");
});

test("encodes URL form fields and builds multipart attachments from selected bytes", async () => {
  const encoded = prepareFetchRequest(createRequestDraft({
    method: "POST", url: "https://api.example.test", body: { type: "urlencoded", text: "", fields: [{ name: "city name", value: "New York", enabled: true }] }
  }));
  assert.equal(String(encoded.init.body), "city+name=New+York");
  const fileData = btoa("fixture upload");
  const multipart = prepareFetchRequest(createRequestDraft({
    method: "POST", url: "https://api.example.test", headers: [{ name: "Content-Type", value: "multipart/form-data", enabled: true }],
    body: { type: "multipart", text: "", fields: [
      { name: "title", value: "report", enabled: true },
      { name: "upload", value: "", enabled: true, isFile: true, fileName: "fixture.txt", fileType: "text/plain", fileData }
    ] }
  }));
  assert.equal(multipart.init.headers.has("content-type"), false);
  assert.equal((await multipart.init.body.get("title")), "report");
  const file = multipart.init.body.get("upload");
  assert.equal(file.name, "fixture.txt");
  assert.equal(await file.text(), "fixture upload");
  assert.ok(multipart.warnings.length);
});

test("requires a user-selected file and blocks browser-controlled transport headers", () => {
  assert.throws(() => prepareFetchRequest(createRequestDraft({ method: "POST", url: "https://api.example.test", body: { type: "multipart", fields: [{ name: "file", isFile: true }] } })), (error) => error.code === "FILE_REQUIRED");
  assert.throws(() => prepareFetchRequest(createRequestDraft({ url: "https://api.example.test", headers: [{ name: "Host", value: "spoof.test", enabled: true }] })), (error) => error.code === "BROWSER_CONTROLLED_HEADER");
  assert.throws(() => prepareFetchRequest(createRequestDraft({ url: "https://api.example.test", auth: { type: "bearer", token: "x" }, headers: [{ name: "Authorization", value: "Basic x", enabled: true }] })), (error) => error.code === "AUTHORIZATION_CONFLICT");
  assert.ok(RequestPreparationError);
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseCurlCommand, CurlParseError } from "../../src/shared/curl/import.js";
import { buildCurlCommand } from "../../src/shared/curl/export.js";
import { createRequestDraft } from "../../src/shared/request-model.js";

test("preserves duplicate query keys, empty values, and duplicate headers in order", () => {
  const { draft } = parseCurlCommand("curl 'https://api.example.test/items?tag=one&tag=&last=two' -H 'X-Trace: a' -H 'X-Trace: b'", "bash");
  assert.deepEqual(draft.query.map(({ name, value }) => [name, value]), [["tag", "one"], ["tag", ""], ["last", "two"]]);
  assert.deepEqual(draft.headers.map(({ name, value }) => [name, value]), [["X-Trace", "a"], ["X-Trace", "b"]]);
});

test("explicit method wins and an empty data argument remains an explicit body", () => {
  const { draft } = parseCurlCommand("curl -X PATCH --data '' https://api.example.test/items", "bash");
  assert.equal(draft.method, "PATCH");
  assert.deepEqual(draft.body, { type: "text", text: "", fields: [] });
});

test("parses Bash quoting and continuations without evaluating shell substitutions", () => {
  const source = String.raw`curl \
  -H 'X-Text: $HOME' \
  --data-raw 'literal $(touch /tmp/ctool-pwned)' \
  'https://api.example.test/run'`;
  const { draft } = parseCurlCommand(source, "bash");
  assert.equal(draft.headers[0].value, "$HOME");
  assert.equal(draft.body.text, "literal $(touch /tmp/ctool-pwned)");
});

test("parses Windows CMD continuation, quotes, headers, and JSON data", () => {
  const source = String.raw`curl.exe -X POST ^
  -H "Content-Type: application/json" ^
  --data-binary "{\"ok\": true}" ^
  "https://api.example.test/run"`;
  const { draft } = parseCurlCommand(source, "cmd");
  assert.equal(draft.method, "POST");
  assert.equal(draft.headers[0].value, "application/json");
  assert.equal(draft.body.text, '{"ok": true}');
});

test("maps Basic auth, Cookie, and URL-encoded fields", () => {
  const { draft } = parseCurlCommand("curl -u 'alice:p:a:ss' -b 'sid=123' --data-urlencode 'city name=New York' https://api.example.test/search", "bash");
  assert.deepEqual(draft.auth, { type: "basic", username: "alice", password: "p:a:ss" });
  assert.equal(draft.headers.find((header) => header.name.toLowerCase() === "cookie").value, "sid=123");
  assert.equal(draft.body.type, "urlencoded");
  assert.deepEqual(draft.body.fields.map(({ name, value }) => [name, value]), [["city name", "New York"]]);
});

test("represents multipart files as a re-selection request, not a local path read", () => {
  const source = String.raw`curl.exe -F "title=report" -F "upload=@C:\temp\report.txt;type=text/plain" https://api.example.test/upload`;
  const { draft } = parseCurlCommand(source, "cmd");
  assert.equal(draft.body.type, "multipart");
  assert.deepEqual(draft.body.fields.map(({ name, isFile }) => [name, Boolean(isFile)]), [["title", false], ["upload", true]]);
  assert.equal(draft.body.fields[1].fileName, "report.txt");
  assert.equal(draft.body.fields[1].fileType, "text/plain");
  assert.match(draft.body.fields[1].filePathHint, /report\.txt$/);
});

test("rejects unsupported network flags with a useful parse error", () => {
  assert.throws(() => parseCurlCommand("curl --proxy http://localhost:8888 https://api.example.test", "bash"), (error) => {
    assert.ok(error instanceof CurlParseError);
    assert.equal(error.code, "UNSUPPORTED_OPTION");
    assert.match(error.message, /proxy/i);
    return true;
  });
});

test("Bash and CMD exports round-trip request semantics", () => {
  const draft = createRequestDraft({
    method: "POST",
    url: "https://api.example.test/run",
    query: [{ name: "q", value: "a b", enabled: true }, { name: "q", value: "", enabled: true }],
    headers: [{ name: "X-Text", value: 'it\'s "quoted"', enabled: true }],
    body: { type: "json", text: '{"ok": true}', fields: [] }
  });
  for (const shell of ["bash", "cmd"]) {
    const generated = buildCurlCommand(draft, shell);
    const { draft: roundTripped } = parseCurlCommand(generated, shell);
    assert.equal(roundTripped.method, draft.method, shell);
    assert.deepEqual(roundTripped.query.map(({ name, value }) => [name, value]), [["q", "a b"], ["q", ""]], shell);
    assert.equal(roundTripped.headers[0].value, draft.headers[0].value, shell);
    assert.equal(roundTripped.body.text, draft.body.text, shell);
  }
});

test("reports options whose behavior is owned by the browser", () => {
  const { warnings } = parseCurlCommand("curl --insecure --compressed https://api.example.test", "bash");
  assert.ok(warnings.some((warning) => /TLS|certificate/i.test(warning)));
  assert.ok(warnings.some((warning) => /compression/i.test(warning)));
});

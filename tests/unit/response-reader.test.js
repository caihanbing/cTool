import test from "node:test";
import assert from "node:assert/strict";
import { readResponse, ResponseTooLargeError } from "../../src/shared/response-reader.js";

test("reads text responses and bounds the preview while retaining raw bytes", async () => {
  const text = "a".repeat(1024 * 1024 + 10);
  const result = await readResponse(new Response(text, { headers: { "content-type": "text/plain" } }));
  assert.equal(result.receivedBytes, text.length);
  assert.equal(result.previewText.length, 1024 * 1024);
  assert.equal(result.isBinary, false);
  assert.equal(result.bytes.length, text.length);
  assert.equal(result.truncated, true);
});

test("preserves HTTP error response content and recognizes empty responses", async () => {
  const error = await readResponse(new Response('{"error":"fixture"}', { status: 422, headers: { "content-type": "application/json" } }));
  assert.equal(error.status, 422);
  assert.equal(error.previewText, '{"error":"fixture"}');
  const empty = await readResponse(new Response(null, { status: 204 }));
  assert.equal(empty.receivedBytes, 0);
  assert.equal(empty.previewText, "");
});

test("identifies binary content without decoding it as display text", async () => {
  const result = await readResponse(new Response(new Uint8Array([0, 1, 2, 255]), { headers: { "content-type": "application/octet-stream" } }));
  assert.equal(result.isBinary, true);
  assert.equal(result.previewText, "");
  assert.deepEqual([...result.bytes], [0, 1, 2, 255]);
});

test("stops reading when the receive limit is exceeded", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; }
  });
  await assert.rejects(readResponse(new Response(stream), { maxBytes: 10 }), (error) => {
    assert.ok(error instanceof ResponseTooLargeError);
    assert.equal(error.limitBytes, 10);
    return true;
  });
  assert.equal(cancelled, true);
});

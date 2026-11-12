import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureBase = "http://127.0.0.1:41739";
let context;
let userDataDir;

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), "ctool-run-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium", headless: true,
    args: ["--disable-extensions-except=" + extensionPath, "--load-extension=" + extensionPath]
  });
});

test.afterEach(async () => {
  await context?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

async function openExtensionPage() {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/view/popup.html`);
  return page;
}

function draft(pathname, overrides = {}) {
  return {
    id: "request-" + Math.random().toString(16).slice(2),
    name: "Local fixture",
    method: "GET",
    url: fixtureBase + pathname,
    query: [], headers: [], auth: { type: "none" },
    body: { type: "none", text: "", fields: [] },
    redirectMode: "error", timeoutMs: 5_000, environmentId: null,
    ...overrides
  };
}

async function run(page, request, options = {}) {
  return page.evaluate(({ request, options }) => chrome.runtime.sendMessage({
    type: "RUN_START", taskId: options.taskId || crypto.randomUUID(), requestId: request.id, draft: request, ...options
  }), { request, options });
}

test("manual Cookie is isolated to the exact extension request and removed afterward", async () => {
  const page = await openExtensionPage();
  const withCookie = draft("/capture", { headers: [{ name: "Cookie", value: "session=ctool-test", enabled: true }] });
  const response = await run(page, withCookie);
  expect(response.result.status).toBe("completed");
  expect(response.result.previewText).toContain('"cookie":"session=ctool-test"');

  const cleanResponse = await run(page, draft("/capture"));
  expect(cleanResponse.result.status).toBe("completed");
  expect(cleanResponse.result.previewText).not.toContain("session=ctool-test");

  const webPage = await context.newPage();
  await webPage.goto(fixtureBase + "/page");
  const cookie = await webPage.evaluate(async () => (await (await fetch("/capture")).json()).headers.cookie);
  expect(cookie ?? "").toBe("");
});

test("keeps HTTP error bodies, reports blocked redirects, and follows only when requested", async () => {
  const page = await openExtensionPage();
  const httpError = await run(page, draft("/error"));
  expect(httpError.result.status).toBe("completed");
  expect(httpError.result.statusCode).toBe(422);
  expect(httpError.result.previewText).toContain("fixture");

  const blocked = await run(page, draft("/redirect"));
  expect(blocked.result.status).toBe("failed");
  expect(blocked.result.errorCode).toBe("REDIRECT_BLOCKED");
  expect(blocked.result.errorMessage).toMatch(/redirect/i);

  const followed = await run(page, draft("/redirect", { redirectMode: "follow" }));
  expect(followed.result.status).toBe("completed");
  expect(new URL(followed.result.finalUrl).pathname).toBe("/echo");

  const credentialedRedirect = await run(page, draft("/redirect", {
    redirectMode: "follow",
    headers: [{ name: "Cookie", value: "session=initial-only", enabled: true }]
  }));
  expect(credentialedRedirect.result.status).toBe("completed");
  expect(JSON.parse(credentialedRedirect.result.previewText).headers.cookie ?? "").toBe("");
});

test("sends multipart text and selected file bytes to the loopback receiver", async () => {
  const page = await openExtensionPage();
  const uploaded = await run(page, draft("/upload", {
    method: "POST",
    body: { type: "multipart", text: "", fields: [
      { name: "title", value: "ctool", enabled: true },
      { name: "upload", value: "", enabled: true, isFile: true, fileName: "fixture.txt", fileType: "text/plain", fileData: btoa("fixture upload") }
    ] }
  }));
  expect(uploaded.result.status).toBe("completed");
  expect(uploaded.result.previewText).toContain("fixture upload");
  expect(uploaded.result.previewText).toContain("ctool");
});

test("enforces the request timeout and supports explicit cancellation", async () => {
  const page = await openExtensionPage();
  const timed = await run(page, draft("/delayed?ms=300"), { timeoutMs: 50 });
  expect(timed.result.status).toBe("timed_out");
  expect(timed.result.errorCode).toBe("REQUEST_TIMEOUT");

  const taskId = "cancel-me";
  const pending = page.evaluate(({ request, taskId }) => chrome.runtime.sendMessage({ type: "RUN_START", taskId, requestId: request.id, draft: request }), {
    request: draft("/delayed?ms=3000"), taskId
  });
  await expect.poll(async () => (await page.evaluate(() => chrome.runtime.sendMessage({ type: "RUN_STATUS" }))).active?.taskId).toBe(taskId);
  const cancelled = await page.evaluate((taskId) => chrome.runtime.sendMessage({ type: "RUN_CANCEL", taskId }), taskId);
  expect(cancelled.cancelled).toBe(true);
  expect((await pending).result.status).toBe("cancelled");
});

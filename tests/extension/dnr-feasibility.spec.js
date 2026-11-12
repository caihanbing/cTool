import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const fixtureBase = "http://127.0.0.1:41739";

async function launchProbe() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "ctool-dnr-probe-"));
  const extensionPath = path.join(tempRoot, "extension");
  await mkdir(extensionPath);
  await writeFile(path.join(extensionPath, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "cTool DNR feasibility probe",
    version: "1.0.0",
    permissions: ["declarativeNetRequestWithHostAccess"],
    host_permissions: ["http://127.0.0.1:41739/*"],
    background: { service_worker: "background.js" }
  }));
  await writeFile(path.join(extensionPath, "probe.html"), "<!doctype html><meta charset=utf-8><title>probe</title>");
  await writeFile(path.join(extensionPath, "background.js"), `
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "probe") return;
      const rule = {
        id: 1,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "Cookie", operation: "set", value: "session=ctool-test" }] },
        condition: {
          regexFilter: "^http://127\\\\.0\\\\.0\\\\.1:41739" + message.path + "$",
          initiatorDomains: [chrome.runtime.id],
          requestDomains: ["127.0.0.1"],
          requestMethods: ["get"],
          resourceTypes: ["xmlhttprequest"]
        }
      };
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1], addRules: [rule] }, async () => {
        if (chrome.runtime.lastError) { sendResponse({ error: chrome.runtime.lastError.message }); return; }
        try {
          const response = await fetch("${fixtureBase}" + message.path);
          sendResponse({ status: response.status, body: await response.text() });
        } catch (error) {
          sendResponse({ error: String(error) });
        } finally {
          chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1] });
        }
      });
      return true;
    });
  `);
  const userDataDir = path.join(tempRoot, "profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: ["--disable-extensions-except=" + extensionPath, "--load-extension=" + extensionPath]
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto("chrome-extension://" + extensionId + "/probe.html");
  return { context, page, tempRoot };
}

async function withProbe(callback) {
  const probe = await launchProbe();
  try {
    await callback(probe);
  } finally {
    await probe.context.close();
    await rm(probe.tempRoot, { recursive: true, force: true });
  }
}

test("session DNR rules scope manual Cookie to extension initiator and exact URL", async () => {
  await withProbe(async ({ context, page }) => {
    const extensionResult = await page.evaluate(async () => chrome.runtime.sendMessage({ type: "probe", path: "/capture" }));
    expect(extensionResult.error).toBeUndefined();
    expect(JSON.parse(extensionResult.body).headers.cookie).toBe("session=ctool-test");

    const webPage = await context.newPage();
    await webPage.goto(fixtureBase + "/page");
    const webResult = await webPage.evaluate(async () => (await (await fetch("/capture")).json()).headers.cookie);
    expect(webResult ?? "").toBe("");
  });
});

test("a Cookie rule matching the original URL does not add Cookie to its redirect target", async () => {
  await withProbe(async ({ page }) => {
    const result = await page.evaluate(async () => chrome.runtime.sendMessage({ type: "probe", path: "/redirect" }));
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).headers.cookie ?? "").toBe("");
  });
});

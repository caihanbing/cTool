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
  userDataDir = await mkdtemp(path.join(tmpdir(), "ctool-extension-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      "--disable-extensions-except=" + extensionPath,
      "--load-extension=" + extensionPath
    ]
  });
});

test.afterEach(async () => {
  await context?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

async function openPopup() {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto("chrome-extension://" + extensionId + "/popup/view/popup.html");
  return page;
}

function command(pathname, options = "") {
  return "curl " + options + " '" + fixtureBase + pathname + "'";
}

test("manual Cookie reaches only the extension request", async () => {
  const page = await openPopup();
  await page.locator("#curl-input").fill(command("/echo", "-H 'Cookie: session=ctool-test'"));
  await page.locator("#parse-btn").click();
  await page.locator("#send-btn").click();
  await expect.poll(async () => page.locator("#data-output").textContent()).toContain("session=ctool-test");

  const webPage = await context.newPage();
  await webPage.goto(fixtureBase + "/page");
  const pageRequest = await webPage.evaluate(async () => {
    const response = await fetch("/echo");
    return response.json();
  });
  expect(pageRequest.headers.cookie ?? "").toBe("");
});

test("a popup request finishes and is visible after the popup closes", async () => {
  const page = await openPopup();
  await page.locator("#curl-input").fill(command("/delayed?ms=900"));
  await page.locator("#parse-btn").click();
  await page.locator("#send-btn").click();
  await expect.poll(async () => {
    const response = await fetch(fixtureBase + "/stats");
    return (await response.json()).delayed;
  }).toBeGreaterThan(0);
  await page.close();
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const reopened = await openPopup();
  await expect(reopened.locator("#history-list")).toContainText("/delayed");
});

test("multipart cURL asks for file selection and sends both fields", async () => {
  const page = await openPopup();
  await page.locator("#curl-input").fill(command("/echo", "-F 'name=ctool' -F 'upload=@fixture.txt'"));
  await page.locator("#parse-btn").click();
  const fileInput = page.locator('input[type="file"][data-field="upload"]');
  await expect(fileInput).toBeVisible();
  await fileInput.setInputFiles({
    name: "fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("fixture upload")
  });
  await expect(page.locator("#app-message")).toContainText("fixture.txt");
  await page.locator("#send-btn").click();
  const output = page.locator("#data-output");
  await expect(output).toContainText("name");
  await expect(output).toContainText("ctool");
  await expect(output).toContainText("fixture upload");
});

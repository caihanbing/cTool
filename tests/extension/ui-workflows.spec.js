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
  userDataDir = await mkdtemp(path.join(tmpdir(), "ctool-ui-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium", headless: true,
    args: ["--disable-extensions-except=" + extensionPath, "--load-extension=" + extensionPath]
  });
});

test.afterEach(async () => {
  await context?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

async function openWorkbench() {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup/view/popup.html`);
  await expect(page.locator("#request-url")).toBeVisible();
  return page;
}

test("sending uses the edited request model and renders hostile response HTML as text", async () => {
  const page = await openWorkbench();
  await page.locator("#curl-input").fill(`curl '${fixtureBase}/echo'`);
  await page.locator("#parse-btn").click();
  await page.locator("#request-url").fill(`${fixtureBase}/text`);
  await page.locator("#send-btn").click();
  await expect(page.locator("#data-output")).toHaveText("fixture text");

  await page.locator("#tab-request").click();
  await page.locator("#request-url").fill(`${fixtureBase}/html`);
  await page.locator("#send-btn").click();
  await expect(page.locator("#data-output")).toContainText("<script>");
  expect(await page.locator("#data-output img, #data-output script").count()).toBe(0);
  expect(await page.evaluate(() => window.__ctoolInjected)).toBeUndefined();
});

test("environment variables block unresolved requests, then resolve and save favorites", async () => {
  const page = await openWorkbench();
  await page.locator("#tab-environments").click();
  await page.locator("#add-environment-btn").click();
  const environment = page.locator("#environment-list .environment-item").first();
  await environment.locator("[data-environment-name]").fill("dev");
  await environment.locator("button[data-action='add-variable']").click();
  const variable = environment.locator(".variable-row").first();
  await variable.locator("[data-variable-field='name']").fill("host");
  await variable.locator("[data-variable-field='value']").fill("127.0.0.1:41739");

  await page.locator("#tab-request").click();
  await page.locator("#environment-select").selectOption({ label: "dev" });
  await page.locator("#request-url").fill("http://{{missing}}/echo");
  await page.locator("#send-btn").click();
  await expect(page.locator("#app-message")).toContainText("missing");

  await page.locator("#request-url").fill("http://{{host}}/echo");
  await page.locator("#send-btn").click();
  await expect(page.locator("#data-output")).toContainText('"path":"/echo"');
  await page.locator("#tab-request").click();
  await page.locator("#save-favorite-btn").click();
  await page.locator("#favorite-name").fill("Local echo");
  await page.locator("#confirm-favorite-btn").click();
  await page.locator("#tab-favorites").click();
  await expect(page.locator("#favorite-list")).toContainText("Local echo");
  await page.locator("#favorite-list button[data-action='edit']").click();
  await expect(page.locator("#favorite-dialog")).toBeVisible();
  await page.locator("#favorite-name").fill("Edited echo");
  await page.locator("#confirm-favorite-btn").click();
  await page.locator("#tab-favorites").click();
  await expect(page.locator("#favorite-list")).toContainText("Edited echo");
});

test("privacy mode skips automatic history but allows explicit favorites", async () => {
  const page = await openWorkbench();
  await page.locator("#tab-settings").click();
  await page.locator("#privacy-setting + span").click();
  await expect(page.locator("#privacy-indicator")).toBeVisible();
  await page.locator("#tab-request").click();
  await page.locator("#request-url").fill(`${fixtureBase}/text`);
  await page.locator("#send-btn").click();
  await expect(page.locator("#data-output")).toHaveText("fixture text");
  await page.locator("#tab-history").click();
  await expect(page.locator("#history-list .empty-list")).toBeVisible();

  await page.locator("#tab-request").click();
  await page.locator("#save-favorite-btn").click();
  await page.locator("#favorite-name").fill("Private saved request");
  await page.locator("#confirm-favorite-btn").click();
  await page.locator("#tab-favorites").click();
  await expect(page.locator("#favorite-list")).toContainText("Private saved request");
});

test("saved drafts can be restored and theme and locale settings apply", async () => {
  const page = await openWorkbench();
  await page.locator("#request-url").fill(`${fixtureBase}/text`);
  await page.waitForTimeout(250);
  await page.locator("#open-drafts-btn").click();
  const savedDraft = page.locator("#draft-list button[data-draft-id]").first();
  await expect(savedDraft).toContainText(`${fixtureBase}/text`);
  await savedDraft.click();
  await expect(page.locator("#request-url")).toHaveValue(`${fixtureBase}/text`);

  await page.locator("#tab-settings").click();
  await page.locator("#theme-setting").selectOption("dark");
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe("dark");
  await page.locator("#locale-toggle").click();
  await expect(page.locator("#tab-request")).toHaveText("Request");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("response downloads contain the raw response body", async () => {
  const page = await openWorkbench();
  await page.locator("#request-url").fill(`${fixtureBase}/text`);
  await page.locator("#send-btn").click();
  await expect(page.locator("#data-output")).toHaveText("fixture text");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-response-btn").click()
  ]);
  expect(download.suggestedFilename()).toBe("ctool-response-200.txt");
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString("utf8")).toBe("fixture text");
});

test("backup import previews before merging and makes imported drafts loadable", async () => {
  const page = await openWorkbench();
  await page.locator("#tab-settings").click();
  const backup = {
    product: "cTool", schemaVersion: 1,
    drafts: [{ id: "source-draft", name: "Imported draft", url: `${fixtureBase}/text`, method: "GET", query: [], headers: [], auth: { type: "none" }, body: { type: "none", text: "", fields: [] } }],
    history: [], favorites: [], environments: [], globalVariables: []
  };
  await page.locator("#import-backup-file").setInputFiles({
    name: "ctool-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator("#import-preview")).toBeVisible();
  await expect(page.locator("#confirm-import-btn")).toBeEnabled();
  await page.locator("#confirm-import-btn").click();
  await page.locator("#tab-request").click();
  await page.locator("#open-drafts-btn").click();
  const imported = page.locator("#draft-list button[data-draft-id]").filter({ hasText: `${fixtureBase}/text` }).first();
  await expect(imported).toBeVisible();
  await imported.click();
  await expect(page.locator("#request-url")).toHaveValue(`${fixtureBase}/text`);
});

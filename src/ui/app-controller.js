import { parseCurlCommand } from "../shared/curl/import.js";
import { buildCurlCommand } from "../shared/curl/export.js";
import { createRequestDraft, stripFileAttachments, validateRequestDraft } from "../shared/request-model.js";
import { resolveEnvironment } from "../shared/environment.js";
import { composeRequestUrl } from "../shared/request-model.js";
import { openDatabase } from "../shared/storage/database.js";
import { createRepositories } from "../shared/storage/repositories.js";
import { migrateLegacyHistory } from "../shared/storage/migrate-legacy.js";
import { buildBackup, importBackup, previewBackup } from "../shared/storage/backup.js";
import { loadSettings, shouldPersist, updateSettings } from "../shared/storage/settings.js";
import { runRequest, getEphemeralResponseChunk } from "../shared/request-executor.js";
import { translate, applyLocale } from "./locale.js";

/** @typedef {import('../shared/request-model.js').RequestDraft} RequestDraft */
/** @typedef {Record<string, any>} RecordData */

const $ = (/** @type {string} */ selector) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing cTool interface element: ${selector}`);
  return /** @type {any} */ (element);
};
const text = (/** @type {unknown} */ value) => value == null ? "" : String(value);
const newId = () => crypto.randomUUID();

/**
 * Bind one popup or expanded workbench view to the shared local request model.
 * @param {{surface:'popup'|'workbench'}} options
 */
export async function startApp({ surface }) {
  const db = await openDatabase();
  const repositories = createRepositories(db);
  /** @type {any} */ let settings = await loadSettings();
  /** @type {RequestDraft} */ let draft = createRequestDraft();
  /** @type {any} */ let latestResult = null;
  /** @type {any} */ let pendingImport = null;
  /** @type {string|null} */ let editingFavoriteId = null;
  let editingFavoriteRequest = false;
  /** @type {string|null} */ let lastDisplayedResponseId = null;
  /** @type {AbortController|null} */ let workbenchAbort = null;
  let variableSaveTimer = 0;
  /** @type {Promise<void>} */ let variableSavePromise = Promise.resolve();
  /** @type {Set<Promise<void>>} */ const pendingFileReads = new Set();
  let responseSearchTerm = "";
  let responseSearchIndex = -1;
  const isWorkbench = surface === "workbench";

  function t(key, values = {}) { return translate(key, settings.locale, values); }
  function message(value = "", error = false) {
    const node = $("#app-message");
    node.textContent = value;
    node.hidden = !value;
    node.classList.toggle("is-error", error);
  }
  function setTheme() {
    document.documentElement.setAttribute("data-theme", settings.theme);
    $("#app-shell").setAttribute("data-theme", settings.theme);
    document.documentElement.lang = settings.locale;
    applyLocale(document, settings.locale);
    $("#locale-toggle").textContent = settings.locale === "en" ? "中" : "EN";
    $("#theme-setting").value = settings.theme;
    $("#privacy-setting").checked = settings.privacyMode;
    $("#privacy-indicator").hidden = !settings.privacyMode;
  }
  function setDraft(next) {
    draft = createRequestDraft(next);
    renderDraft();
    scheduleDraftSave();
  }
  let saveTimer = 0;
  function scheduleDraftSave() {
    window.clearTimeout(saveTimer);
    if (!shouldPersist(settings, "draft")) return;
    saveTimer = window.setTimeout(() => {
      if (!shouldPersist(settings, "draft")) return;
      void repositories.saveDraft({ ...stripFileAttachments(draft), id: "current", savedAt: Date.now() })
        .catch((error) => message(t("message.storageError", { error: text(error?.message) }), true));
    }, 180);
  }
  function replaceOptions(select, options, selected) {
    select.replaceChildren(...options.map((option) => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      return node;
    }));
    select.value = selected;
  }
  function renderEnvironmentSelect() {
    void repositories.listEnvironments().then((environments) => {
      const select = /** @type {HTMLSelectElement} */ $("#environment-select");
      replaceOptions(select, [{ value: "", label: t("environment.none") }, ...environments.map((environment) => ({ value: environment.id, label: environment.name }))], draft.environmentId ?? settings.selectedEnvironmentId ?? "");
      draft.environmentId = select.value || null;
    }).catch((error) => message(t("message.storageError", { error: text(error?.message) }), true));
  }
  function appendEditableRow(parent, row, kind, index) {
    const wrapper = document.createElement("div");
    wrapper.className = "editable-row";
    wrapper.dataset.kind = kind;
    wrapper.dataset.index = String(index);
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = row.enabled !== false;
    enabled.setAttribute("aria-label", "Enable row");
    enabled.dataset.rowField = "enabled";
    const name = document.createElement("input");
    name.type = "text";
    name.value = text(row.name);
    name.placeholder = kind === "headers" ? "Header" : "Key";
    name.autocomplete = "off";
    name.dataset.rowField = "name";
    name.setAttribute("aria-label", `${kind} name`);
    const value = document.createElement("input");
    value.type = "text";
    value.value = text(row.value);
    value.placeholder = "Value";
    value.autocomplete = "off";
    value.dataset.rowField = "value";
    value.setAttribute("aria-label", `${kind} value`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-row-button";
    remove.dataset.removeRow = "true";
    remove.setAttribute("aria-label", "Remove row");
    remove.textContent = "×";
    wrapper.append(enabled, name, value, remove);
    parent.append(wrapper);
  }
  function renderValueRows(parent, rows, kind) {
    parent.replaceChildren();
    rows.forEach((row, index) => appendEditableRow(parent, row, kind, index));
  }
  function renderAuth() {
    const area = $("#auth-fields");
    area.replaceChildren();
    if (draft.auth.type === "basic") {
      const username = document.createElement("input");
      username.type = "text";
      username.placeholder = t("auth.username");
      username.value = draft.auth.username;
      username.autocomplete = "username";
      username.dataset.authField = "username";
      const password = document.createElement("input");
      password.type = "password";
      password.placeholder = t("auth.password");
      password.value = draft.auth.password;
      password.autocomplete = "current-password";
      password.dataset.authField = "password";
      area.append(username, password);
    } else if (draft.auth.type === "bearer") {
      const token = document.createElement("input");
      token.type = "password";
      token.placeholder = t("auth.token");
      token.value = draft.auth.token;
      token.autocomplete = "off";
      token.dataset.authField = "token";
      area.append(token);
    }
  }
  function renderBodyFields() {
    const type = draft.body.type;
    const bodyEditor = /** @type {HTMLTextAreaElement} */ $("#body-editor");
    const rows = $("#body-fields");
    const add = $("#add-body-field");
    const structured = type === "urlencoded" || type === "multipart";
    bodyEditor.hidden = structured || type === "none";
    bodyEditor.value = draft.body.text;
    rows.hidden = !structured;
    add.hidden = !structured;
    rows.replaceChildren();
    if (!structured) return;
    draft.body.fields.forEach((field, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "editable-row body-field-row";
      wrapper.dataset.index = String(index);
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = field.enabled !== false;
      enabled.dataset.rowField = "enabled";
      enabled.setAttribute("aria-label", "Enable body field");
      const name = document.createElement("input");
      name.type = "text";
      name.value = text(field.name);
      name.placeholder = "Field name";
      name.dataset.rowField = "name";
      name.setAttribute("aria-label", "Body field name");
      const value = document.createElement("input");
      value.type = "text";
      value.value = field.isFile ? text(field.fileName || field.filePathHint) : text(field.value);
      value.placeholder = type === "multipart" && field.isFile ? "Choose a file" : "Value";
      value.dataset.rowField = "value";
      value.setAttribute("aria-label", "Body field value");
      wrapper.append(enabled, name, value);
      if (type === "multipart") {
        const fileToggle = document.createElement("label");
        fileToggle.className = "secret-flag";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = field.isFile === true;
        check.dataset.fileToggle = "true";
        fileToggle.append(check, document.createTextNode("File"));
        wrapper.append(fileToggle);
        if (field.isFile) {
          const fileInput = document.createElement("input");
          fileInput.type = "file";
          fileInput.dataset.field = field.name;
          fileInput.setAttribute("aria-label", `Choose file for ${field.name}`);
          fileInput.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const fieldIndex = index;
            const read = file.arrayBuffer().then((buffer) => {
              let binary = "";
              const bytes = new Uint8Array(buffer);
              for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
              const currentField = draft.body.fields[fieldIndex];
              if (!currentField) throw new Error("The multipart field was removed before its file finished loading.");
              currentField.fileData = btoa(binary);
              currentField.fileName = file.name;
              currentField.fileType = file.type || "application/octet-stream";
              value.value = file.name;
              scheduleDraftSave();
              message(t("message.fileSelected", { name: file.name }));
            }).catch((error) => message(text(error?.message), true)).finally(() => pendingFileReads.delete(read));
            pendingFileReads.add(read);
          });
          wrapper.append(fileInput);
        }
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-row-button";
      remove.dataset.removeRow = "true";
      remove.setAttribute("aria-label", "Remove body field");
      remove.textContent = "×";
      wrapper.append(remove);
      rows.append(wrapper);
    });
  }
  function renderDraft() {
    $("#request-method").value = draft.method;
    $("#request-url").value = draft.url;
    $("#request-timeout").value = String(Math.max(1, Math.round(draft.timeoutMs / 1000)));
    $("#auth-type").value = draft.auth.type;
    $("#body-type").value = draft.body.type;
    $("#follow-redirects").checked = draft.redirectMode === "follow";
    renderValueRows($("#query-rows"), draft.query, "query");
    renderValueRows($("#header-rows"), draft.headers, "headers");
    renderAuth();
    renderBodyFields();
    renderEnvironmentSelect();
  }
  function readRows(container, target, kind) {
    const rows = [...container.querySelectorAll(".editable-row")];
    const values = rows.map((node) => {
      const get = (field) => /** @type {HTMLInputElement|null} */ (node.querySelector(`[data-row-field="${field}"]`));
      const name = get("name");
      const value = get("value");
      const enabled = get("enabled");
      const previous = target[Number(node.dataset.index)] ?? {};
      return { ...previous, id: previous.id ?? newId(), name: name?.value ?? "", value: value?.value ?? "", enabled: enabled?.checked ?? true };
    });
    if (kind === "body") draft.body.fields = values;
    else draft[kind] = values;
  }
  function syncFromForm() {
    draft.method = /** @type {HTMLSelectElement} */ $("#request-method").value;
    draft.url = /** @type {HTMLInputElement} */ $("#request-url").value.trim();
    const seconds = Number(/** @type {HTMLInputElement} */ $("#request-timeout").value);
    draft.timeoutMs = Math.max(1, Math.min(isWorkbench ? 300_000 : 25_000, (Number.isFinite(seconds) ? seconds : (isWorkbench ? 300 : 25)) * 1000));
    draft.redirectMode = /** @type {HTMLInputElement} */ $("#follow-redirects").checked ? "follow" : "error";
    draft.environmentId = /** @type {HTMLSelectElement} */ $("#environment-select").value || null;
    const authType = /** @type {HTMLSelectElement} */ $("#auth-type").value;
    if (authType === "basic") draft.auth = { type: "basic", username: /** @type {HTMLInputElement|null} */ (document.querySelector('[data-auth-field="username"]'))?.value ?? "", password: /** @type {HTMLInputElement|null} */ (document.querySelector('[data-auth-field="password"]'))?.value ?? "" };
    else if (authType === "bearer") draft.auth = { type: "bearer", token: /** @type {HTMLInputElement|null} */ (document.querySelector('[data-auth-field="token"]'))?.value ?? "" };
    else draft.auth = { type: "none" };
    draft.body.type = /** @type {HTMLSelectElement} */ $("#body-type").value;
    draft.body.text = /** @type {HTMLTextAreaElement} */ $("#body-editor").value;
    readRows($("#query-rows"), draft.query, "query");
    readRows($("#header-rows"), draft.headers, "headers");
    readRows($("#body-fields"), draft.body.fields, "body");
    scheduleDraftSave();
    return draft;
  }

  function showWarnings(warnings) {
    const note = $("#curl-warnings");
    note.textContent = warnings.join(" ");
    note.hidden = warnings.length === 0;
  }
  function openPanel(name) {
    document.querySelectorAll(".nav-tab").forEach((node) => {
      const active = node.getAttribute("data-panel-target") === name;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", String(active));
      node.setAttribute("tabindex", active ? "0" : "-1");
    });
    document.querySelectorAll(".view-panel").forEach((node) => {
      const active = node.getAttribute("data-panel") === name;
      node.classList.toggle("is-active", active);
      /** @type {HTMLElement} */ (node).hidden = !active;
    });
    if (name === "history") void renderHistory();
    if (name === "favorites") void renderFavorites();
    if (name === "environments") void renderEnvironments();
    if (name === "response" && latestResult) void showStoredResponse(latestResult);
  }
  async function start() {
    message(t("message.loading"));
    try {
      const migration = await migrateLegacyHistory({ repositories, localStorage: window.localStorage });
      if (migration.status === "corrupt") message("旧版历史格式损坏，已保留原数据；其他功能仍可使用。", true);
      if (migration.imported) message(`已迁移 ${migration.imported} 条旧版历史记录。`);
    } catch (error) { message(t("message.storageError", { error: text(error?.message) }), true); }

    if (isWorkbench) {
      const handoff = /** @type {{handoffDraft?:any}} */ (await chrome.storage.session.get("handoffDraft").catch(() => ({})));
      if (handoff.handoffDraft) {
        draft = createRequestDraft(handoff.handoffDraft);
        await chrome.storage.session.remove("handoffDraft").catch(() => {});
      } else {
        const saved = await repositories.getDraft("current").catch(() => null);
        if (saved) draft = createRequestDraft(saved);
      }
    } else {
      const saved = await repositories.getDraft("current").catch(() => null);
      if (saved) draft = createRequestDraft(saved);
    }
    draft.timeoutMs = Math.min(draft.timeoutMs, isWorkbench ? 300_000 : 25_000);
    setTheme();
    renderDraft();
    await renderHistory();
    await renderFavorites();
    await renderEnvironments();
    const active = await chrome.runtime.sendMessage({ type: "RUN_STATUS" }).catch(() => null);
    if (active?.active) showActiveTask(active.active);
    message("");
  }

  document.querySelectorAll(".nav-tab").forEach((node) => node.addEventListener("click", () => openPanel(node.getAttribute("data-panel-target") ?? "request")));
  $("#locale-toggle").addEventListener("click", async () => {
    settings = await updateSettings({ locale: settings.locale === "en" ? "zh-CN" : "en" });
    setTheme();
    renderDraft();
    await renderHistory();
    await renderFavorites();
    await renderEnvironments();
  });
  $("#expand-workbench").hidden = isWorkbench;
  $("#expand-workbench").addEventListener("click", async () => {
    syncFromForm();
    await chrome.storage.session.set({ handoffDraft: draft });
    await chrome.tabs.create({ url: chrome.runtime.getURL("popup/view/workbench.html") });
  });
  $("#parse-btn").addEventListener("click", () => {
    try {
      const parsed = parseCurlCommand(/** @type {HTMLTextAreaElement} */ $("#curl-input").value);
      setDraft(parsed.draft);
      showWarnings(parsed.warnings);
      message("");
    } catch (error) { message(error instanceof Error ? error.message : t("message.invalidCurl"), true); }
  });
  $("#generate-curl-btn").addEventListener("click", () => {
    try {
      const command = buildCurlCommand(syncFromForm());
      /** @type {HTMLTextAreaElement} */ $("#curl-input").value = command;
      showWarnings([]);
      message("");
    } catch (error) { message(text(error?.message), true); }
  });
  $("#copy-curl-btn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(/** @type {HTMLTextAreaElement} */ $("#curl-input").value); message(t("message.copied")); }
    catch { message("Clipboard access was denied by the browser.", true); }
  });
  $("#download-curl-btn").addEventListener("click", () => {
    try { downloadBlob(new Blob([buildCurlCommand(syncFromForm())], { type: "text/plain;charset=utf-8" }), "ctool-request.sh"); }
    catch (error) { message(text(error?.message), true); }
  });
  $("#request-form").addEventListener("input", () => { syncFromForm(); });
  $("#request-form").addEventListener("change", () => { syncFromForm(); });
  document.querySelectorAll("[data-add-row]").forEach((node) => node.addEventListener("click", () => {
    const kind = node.getAttribute("data-add-row");
    if (kind === "query" || kind === "headers") {
      const rows = /** @type {any[]} */ (draft[kind]);
      rows.push({ id: newId(), name: "", value: "", enabled: true });
      renderValueRows($(kind === "query" ? "#query-rows" : "#header-rows"), rows, kind);
      scheduleDraftSave();
    }
  }));
  $("#add-body-field").addEventListener("click", () => {
    draft.body.fields.push({ id: newId(), name: "", value: "", enabled: true, ...(draft.body.type === "multipart" ? { isFile: false } : {}) });
    renderBodyFields();
    scheduleDraftSave();
  });
  document.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement ? event.target : null);
    if (target?.dataset.removeRow === "true") {
      const row = target.closest(".editable-row");
      const container = row?.parentElement;
      const index = Number(row?.getAttribute("data-index"));
      if (container?.id === "query-rows") draft.query.splice(index, 1);
      else if (container?.id === "header-rows") draft.headers.splice(index, 1);
      else if (container?.id === "body-fields") draft.body.fields.splice(index, 1);
      renderDraft();
    }
    if (target?.dataset.fileToggle === "true") {
      const row = target.closest(".editable-row");
      const index = Number(row?.getAttribute("data-index"));
      const field = draft.body.fields[index];
      if (field) { field.isFile = /** @type {HTMLInputElement} */ (target).checked; delete field.fileData; renderBodyFields(); scheduleDraftSave(); }
    }
  });
  $("#auth-type").addEventListener("change", () => { syncFromForm(); renderAuth(); });
  $("#body-type").addEventListener("change", () => {
    const type = /** @type {HTMLSelectElement} */ $("#body-type").value;
    draft.body.type = /** @type {any} */ (type);
    if ((type === "urlencoded" || type === "multipart") && !draft.body.fields.length) draft.body.fields.push({ id: newId(), name: "", value: "", enabled: true });
    renderBodyFields();
    scheduleDraftSave();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void sendCurrentRequest(); }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const active = document.activeElement?.closest(".nav-tab");
      if (!active) return;
      const tabs = [...document.querySelectorAll(".nav-tab")];
      const current = tabs.indexOf(active);
      const next = /** @type {HTMLElement|undefined} */ (tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]);
      event.preventDefault();
      next?.focus();
      next?.click();
    }
  });
  $("#send-btn").addEventListener("click", () => { void sendCurrentRequest(); });
  $("#cancel-active-task").addEventListener("click", () => { void cancelActiveTask(); });
  $("#history-search").addEventListener("input", () => { void renderHistory(); });
  $("#clear-history-btn").addEventListener("click", async () => {
    if (!window.confirm(settings.locale === "en" ? "Clear all request history?" : "清空全部请求历史？")) return;
    await repositories.clearHistory();
    await renderHistory();
    message(t("message.historyCleared"));
  });
  $("#save-favorite-btn").addEventListener("click", () => {
    syncFromForm(); editingFavoriteId = null; editingFavoriteRequest = false;
    /** @type {HTMLInputElement} */ $("#favorite-name").value = draft.name === "New request" ? "" : draft.name;
    $("#favorite-dialog").showModal();
    $("#favorite-name").focus();
  });
  $("#open-drafts-btn").addEventListener("click", async () => {
    await renderDraftList();
    $("#draft-dialog").showModal();
  });
  $("#draft-list").addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement ? event.target : null);
    const button = target?.closest("button[data-draft-id]");
    const id = button?.getAttribute("data-draft-id");
    if (!id) return;
    const saved = await repositories.getDraft(id);
    if (!saved) return;
    setDraft(saved);
    $("#draft-dialog").close();
    openPanel("request");
  });
  $("#confirm-favorite-btn").addEventListener("click", async (event) => {
    event.preventDefault();
    const name = /** @type {HTMLInputElement} */ $("#favorite-name").value.trim();
    if (!name) { $("#favorite-name").focus(); return; }
    const id = editingFavoriteId ?? newId();
    const current = editingFavoriteId ? await repositories.getFavorite(editingFavoriteId) : null;
    const savedRequest = editingFavoriteRequest || !current
      ? stripFileAttachments({ ...syncFromForm(), name })
      : current.request;
    await repositories.saveFavorite({ id, name, request: savedRequest });
    editingFavoriteId = null;
    editingFavoriteRequest = false;
    $("#favorite-dialog").close();
    await renderFavorites();
    message(t("message.favoriteSaved"));
  });
  $("#environment-select").addEventListener("change", async () => {
    syncFromForm();
    settings = await updateSettings({ selectedEnvironmentId: draft.environmentId ?? "" });
  });
  $("#add-environment-btn").addEventListener("click", async () => {
    const environment = await repositories.saveEnvironment({ id: newId(), name: "New environment", variables: [] });
    draft.environmentId = environment.id;
    settings = await updateSettings({ selectedEnvironmentId: environment.id });
    await renderEnvironments(); renderEnvironmentSelect();
    openPanel("environments");
  });
  $("#add-global-variable").addEventListener("click", async () => {
    const variables = await repositories.getGlobalVariables();
    variables.push({ id: newId(), name: "", value: "", secret: false });
    await repositories.saveGlobalVariables(variables);
    await renderEnvironments();
  });
  $("#theme-setting").addEventListener("change", async () => { settings = await updateSettings({ theme: /** @type {HTMLSelectElement} */ $("#theme-setting").value }); setTheme(); });
  $("#privacy-setting").addEventListener("change", async () => {
    settings = await updateSettings({ privacyMode: /** @type {HTMLInputElement} */ $("#privacy-setting").checked });
    setTheme();
    message(settings.privacyMode ? t("message.privacy") : "");
  });
  $("#export-backup-btn").addEventListener("click", () => { $("#include-secret-variables").checked = false; $("#export-dialog").showModal(); });
  $("#confirm-export-btn").addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      const backup = await buildBackup(repositories, { includeSecrets: /** @type {HTMLInputElement} */ $("#include-secret-variables").checked });
      downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), `ctool-backup-${new Date().toISOString().slice(0, 10)}.json`);
      $("#export-dialog").close();
    } catch (error) { message(t("message.storageError", { error: text(error?.message) }), true); }
  });
  $("#import-backup-file").addEventListener("change", async () => {
    const file = /** @type {HTMLInputElement} */ $("#import-backup-file").files?.[0];
    if (!file) return;
    try {
      pendingImport = previewBackup(await file.text());
      const preview = $("#import-preview");
      const summary = $("#import-preview-summary");
      preview.hidden = false;
      summary.textContent = pendingImport.valid
        ? t("backup.preview", pendingImport.counts)
        : `${t("backup.invalid", { error: pendingImport.errors.join(" ") })}`;
      /** @type {HTMLButtonElement} */ $("#confirm-import-btn").disabled = !pendingImport.valid;
    } catch (error) { message(t("backup.invalid", { error: text(error?.message) }), true); }
  });
  $("#confirm-import-btn").addEventListener("click", async () => {
    if (!pendingImport?.valid) return;
    try {
      const counts = await importBackup(pendingImport, repositories);
      pendingImport = null;
      $("#import-preview").hidden = true;
      await renderHistory(); await renderFavorites(); await renderEnvironments();
      message(t("backup.imported", { count: Object.values(counts).reduce((a, b) => a + Number(b), 0) }));
    } catch (error) { message(text(error?.message), true); }
  });
  $("#response-mode-preview").addEventListener("click", () => setResponseMode("preview"));
  $("#response-mode-headers").addEventListener("click", () => setResponseMode("headers"));
  $("#format-response-btn").addEventListener("click", () => formatResponse());
  $("#copy-response-btn").addEventListener("click", async () => {
    const content = /** @type {HTMLElement} */ $("#data-output").textContent ?? "";
    if (latestResult?.isBinary) { message(t("response.copyBinary"), true); return; }
    try { await navigator.clipboard.writeText(content); message(t("message.copied")); } catch { message("Clipboard access was denied by the browser.", true); }
  });
  $("#download-response-btn").addEventListener("click", () => { void downloadResponse(); });
  $("#response-find-next").addEventListener("click", () => findInResponse());
  $("#response-search").addEventListener("keydown", (event) => { if (event.key === "Enter") findInResponse(); });

  async function sendCurrentRequest() {
    if (pendingFileReads.size) await Promise.all([...pendingFileReads]);
    syncFromForm();
    try { await flushVariableSave(); }
    catch (error) { message(text(error?.message), true); return; }
    const globals = await repositories.getGlobalVariables();
    const environment = draft.environmentId ? await repositories.getEnvironment(draft.environmentId) : null;
    const resolved = resolveEnvironment(draft, globals, environment);
    if (resolved.missing.length) { message(t("message.missingVariables", { names: resolved.missing.join(", ") }), true); return; }
    const errors = validateRequestDraft(resolved.draft);
    if (errors.length) { message(errors.map((entry) => entry.message).join(" "), true); return; }
    const button = /** @type {HTMLButtonElement} */ $("#send-btn");
    button.disabled = true;
    message("");
    showActiveTask({ taskId: "pending", status: "running" });
    const taskId = newId();
    try {
      let result;
      if (isWorkbench) {
        workbenchAbort = new AbortController();
        const timeoutMs = Math.min(300_000, draft.timeoutMs);
        result = await runRequest(draft, {
          repositories,
          dnr: chrome.declarativeNetRequest,
          extensionId: chrome.runtime.id,
          requestId: draft.id,
          taskId,
          source: "workbench",
          timeoutMs,
          privacyMode: settings.privacyMode,
          signal: workbenchAbort.signal
        });
        workbenchAbort = null;
      } else {
        const response = await chrome.runtime.sendMessage({ type: "RUN_START", taskId, requestId: draft.id, draft, timeoutMs: Math.min(25_000, draft.timeoutMs) });
        if (response?.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
        result = response?.result;
      }
      if (!result) throw new Error("The request finished without a result.");
      latestResult = result;
      lastDisplayedResponseId = result.taskId ?? result.id;
      renderResponse(result);
      await renderHistory();
      openPanel("response");
      if (result.status === "failed" || result.status === "timed_out" || result.status === "cancelled" || result.status === "interrupted") {
        message(result.errorMessage ?? result.errorCode ?? t(`status.${result.status}`), true);
      } else if (result.statusCode >= 400) message(t("status.httpError", { status: result.statusCode }));
      else message("");
    } catch (error) {
      workbenchAbort = null;
      message(text(error?.message), true);
    } finally {
      button.disabled = false;
      $("#active-task-banner").hidden = true;
      await refreshTaskStatus();
    }
  }

  function showActiveTask(task) {
    const banner = $("#active-task-banner");
    banner.hidden = !task;
    if (task) {
      $("#active-task-text").textContent = task.status === "running" ? t("task.active") : `${t("status.interrupted")}`;
      banner.dataset.taskId = task.taskId;
    }
  }
  async function refreshTaskStatus() {
    const response = await chrome.runtime.sendMessage({ type: "RUN_STATUS" }).catch(() => null);
    showActiveTask(response?.active ?? null);
  }
  async function cancelActiveTask() {
    const taskId = $("#active-task-banner").dataset.taskId;
    if (isWorkbench) { workbenchAbort?.abort("cancelled-by-user"); return; }
    if (taskId && taskId !== "pending") await chrome.runtime.sendMessage({ type: "RUN_CANCEL", taskId }).catch(() => {});
  }

  async function renderHistory() {
    try {
      const search = /** @type {HTMLInputElement} */ $("#history-search").value;
      const records = await repositories.listHistory({ search });
      const list = $("#history-list");
      list.replaceChildren();
      if (!records.length) { list.append(emptyList(t("history.empty"))); return; }
      for (const record of records) list.append(recordCard(record, false));
    } catch (error) { message(t("message.storageError", { error: text(error?.message) }), true); }
  }
  async function renderFavorites() {
    try {
      const records = await repositories.listFavorites();
      const list = $("#favorite-list");
      list.replaceChildren();
      if (!records.length) { list.append(emptyList(t("favorites.empty"))); return; }
      for (const record of records) list.append(recordCard(record, true));
    } catch (error) { message(t("message.storageError", { error: text(error?.message) }), true); }
  }
  async function renderDraftList() {
    const list = $("#draft-list");
    const drafts = await repositories.listDrafts();
    list.replaceChildren();
    if (!drafts.length) { list.append(emptyList(t("drafts.empty"))); return; }
    for (const saved of drafts) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "record-main";
      button.dataset.draftId = saved.id;
      const title = document.createElement("strong"); title.className = "record-title"; title.textContent = saved.name || "New request";
      const url = document.createElement("span"); url.className = "record-url"; url.textContent = composeRequestUrl(createRequestDraft(saved));
      button.append(title, url);
      list.append(button);
    }
  }
  function emptyList(label) { const node = document.createElement("p"); node.className = "empty-list"; node.textContent = label; return node; }
  function recordCard(record, favorite) {
    const card = document.createElement("article");
    card.className = "record-card";
    card.dataset.recordId = record.id;
    const main = document.createElement("button");
    main.type = "button";
    main.className = "record-main";
    main.dataset.action = "restore";
    const title = document.createElement("strong");
    title.className = "record-title";
    title.textContent = favorite ? record.name : `${record.request?.method ?? "?"} ${record.request?.url ?? ""}`;
    const meta = document.createElement("span");
    meta.className = "record-meta";
    const status = record.result?.statusCode ? `${record.result.statusCode}` : record.errorCode ?? record.result?.status ?? "";
    meta.textContent = `${status} · ${new Date(record.createdAt ?? record.savedAt ?? 0).toLocaleString(settings.locale === "en" ? "en" : "zh-CN")}`;
    const url = document.createElement("span");
    url.className = "record-url";
    url.textContent = composeRequestUrl(createRequestDraft(record.request ?? {}));
    main.append(title, meta, url);
    const actions = document.createElement("div");
    actions.className = "record-actions";
    const restore = document.createElement("button");
    restore.type = "button"; restore.dataset.action = "restore"; restore.textContent = t("action.restore");
    actions.append(restore);
    if (favorite) {
      const edit = document.createElement("button"); edit.type = "button"; edit.dataset.action = "edit"; edit.textContent = t("action.edit"); actions.append(edit);
    }
    if (!favorite && record.result) {
      const response = document.createElement("button"); response.type = "button"; response.dataset.action = "show-response"; response.textContent = t("nav.response"); actions.append(response);
    }
    if (favorite) {
      const rename = document.createElement("button"); rename.type = "button"; rename.dataset.action = "rename"; rename.textContent = t("action.rename"); actions.append(rename);
    }
    const remove = document.createElement("button"); remove.type = "button"; remove.dataset.action = "delete"; remove.textContent = t("action.delete"); actions.append(remove);
    card.append(main, actions);
    return card;
  }
  async function renderEnvironments() {
    const globalRows = $("#global-variable-rows");
    const globals = await repositories.getGlobalVariables().catch(() => []);
    globalRows.replaceChildren(...globals.map((variable, index) => variableRow(variable, "global", "", index)));
    const list = $("#environment-list");
    const environments = await repositories.listEnvironments().catch(() => []);
    list.replaceChildren();
    for (const environment of environments) {
      const card = document.createElement("section");
      card.className = "environment-item";
      card.dataset.environmentId = environment.id;
      const heading = document.createElement("div"); heading.className = "environment-heading";
      const name = document.createElement("input"); name.value = environment.name; name.dataset.environmentName = "true"; name.setAttribute("aria-label", "Environment name");
      const selectedLabel = document.createElement("label"); selectedLabel.className = "secret-flag";
      const selected = document.createElement("input"); selected.type = "radio"; selected.name = "selected-environment"; selected.checked = (draft.environmentId ?? settings.selectedEnvironmentId) === environment.id; selected.dataset.selectEnvironment = "true";
      selectedLabel.append(selected, document.createTextNode(t("environment.selected")));
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button danger-text"; remove.dataset.action = "delete-environment"; remove.textContent = t("action.delete");
      heading.append(name, selectedLabel, remove); card.append(heading);
      environment.variables.forEach((variable, index) => card.append(variableRow(variable, "environment", environment.id, index)));
      const add = document.createElement("button"); add.type = "button"; add.className = "add-row-button"; add.dataset.action = "add-variable"; add.textContent = "+"; card.append(add);
      list.append(card);
    }
    renderEnvironmentSelect();
  }
  function variableRow(variable, scope, environmentId, index) {
    const row = document.createElement("div"); row.className = "editable-row variable-row"; row.dataset.scope = scope; row.dataset.environmentId = environmentId; row.dataset.index = String(index);
    row.dataset.id = text(variable.id);
    const enabled = document.createElement("span"); enabled.textContent = "{{ }}"; enabled.className = "secret-flag";
    const name = document.createElement("input"); name.value = text(variable.name); name.placeholder = "name"; name.dataset.variableField = "name";
    const value = document.createElement("input"); value.type = variable.secret ? "password" : "text"; value.value = text(variable.value); value.placeholder = "value"; value.dataset.variableField = "value";
    const secretLabel = document.createElement("label"); secretLabel.className = "secret-flag";
    const secret = document.createElement("input"); secret.type = "checkbox"; secret.checked = variable.secret === true; secret.dataset.variableField = "secret";
    secretLabel.append(secret, document.createTextNode(t("environment.secret")));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-row-button"; remove.dataset.action = "delete-variable"; remove.textContent = "×"; remove.setAttribute("aria-label", "Remove variable");
    row.append(enabled, name, value, secretLabel, remove);
    return row;
  }

  document.addEventListener("input", (event) => {
    const target = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement ? event.target : null);
    if (!target?.matches("[data-variable-field], [data-environment-name]")) return;
    queueVariableSave();
  });
  document.addEventListener("change", (event) => {
    const target = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement ? event.target : null);
    if (target?.matches("[data-variable-field]")) {
      if (target.getAttribute("data-variable-field") === "secret") {
        const value = /** @type {HTMLInputElement|null} */ (target.closest(".variable-row")?.querySelector('[data-variable-field="value"]'));
        if (value) value.type = /** @type {HTMLInputElement} */ (target).checked ? "password" : "text";
      }
      queueVariableSave();
    }
    if (target?.matches("[data-select-environment]")) {
      const card = target.closest("[data-environment-id]");
      draft.environmentId = card?.getAttribute("data-environment-id") ?? null;
      void updateSettings({ selectedEnvironmentId: draft.environmentId ?? "" }).then((next) => { settings = next; });
      renderEnvironmentSelect(); scheduleDraftSave();
    }
  });
  async function persistVariables() {
    const globals = [...$("#global-variable-rows").querySelectorAll(".variable-row")].map(readVariable);
    await repositories.saveGlobalVariables(globals);
    const cards = [...$("#environment-list").querySelectorAll(".environment-item")];
    for (const card of cards) {
      const id = card.getAttribute("data-environment-id");
      const environment = await repositories.getEnvironment(id);
      if (!environment) continue;
      environment.name = /** @type {HTMLInputElement} */ (card.querySelector("[data-environment-name]")).value.trim() || "Environment";
      environment.variables = [...card.querySelectorAll(".variable-row")].map(readVariable);
      await repositories.saveEnvironment(environment);
    }
    renderEnvironmentSelect();
  }
  function queueVariableSave() {
    window.clearTimeout(variableSaveTimer);
    variableSaveTimer = window.setTimeout(() => {
      variableSaveTimer = 0;
      variableSavePromise = variableSavePromise.catch(() => {}).then(persistVariables).catch((error) => { message(text(error?.message), true); });
    }, 250);
  }
  async function flushVariableSave() {
    window.clearTimeout(variableSaveTimer);
    variableSaveTimer = 0;
    await variableSavePromise;
    await persistVariables();
  }
  function readVariable(row) {
    const input = (name) => /** @type {HTMLInputElement|null} */ (row.querySelector(`[data-variable-field="${name}"]`));
    const previous = { id: row.getAttribute("data-id") ?? newId() };
    return { ...previous, name: input("name")?.value.trim() ?? "", value: input("value")?.value ?? "", secret: input("secret")?.checked ?? false };
  }
  document.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement ? event.target : null);
    const button = target?.closest("button[data-action]");
    if (!button) return;
    const card = button.closest("[data-record-id]");
    const id = card?.getAttribute("data-record-id");
    const action = button.getAttribute("data-action");
    if (id && action === "restore") {
      const favorite = await repositories.getFavorite(id);
      const record = favorite ?? await repositories.getHistory(id);
      if (!record?.request) return;
      setDraft(record.request);
      openPanel("request");
      if (favorite) message("已载入收藏；上传文件需重新选择。" );
      return;
    }
    if (id && action === "show-response") {
      const record = await repositories.getHistory(id);
      if (!record?.result) return;
      latestResult = record.result;
      await showStoredResponse(latestResult);
      openPanel("response");
      return;
    }
    if (id && action === "delete") {
      if (!window.confirm(settings.locale === "en" ? "Delete this item?" : "删除此记录？")) return;
      if (await repositories.getFavorite(id)) await repositories.deleteFavorite(id); else await repositories.deleteHistory(id);
      await renderHistory(); await renderFavorites();
      return;
    }
    if (id && action === "rename") {
      const favorite = await repositories.getFavorite(id);
      if (!favorite) return;
      editingFavoriteId = id;
      editingFavoriteRequest = false;
      /** @type {HTMLInputElement} */ $("#favorite-name").value = favorite.name;
      $("#favorite-dialog").showModal();
      return;
    }
    if (id && action === "edit") {
      const favorite = await repositories.getFavorite(id);
      if (!favorite?.request) return;
      editingFavoriteId = id;
      editingFavoriteRequest = true;
      setDraft(favorite.request);
      $("#favorite-name").value = favorite.name;
      openPanel("request");
      $("#favorite-dialog").showModal();
      return;
    }
    const variableRow = button.closest(".variable-row");
    if (variableRow && action === "delete-variable") {
      await flushVariableSave();
      const scope = variableRow.getAttribute("data-scope");
      const index = Number(variableRow.getAttribute("data-index"));
      const environmentId = variableRow.getAttribute("data-environment-id");
      if (scope === "global") {
        const variables = await repositories.getGlobalVariables();
        variables.splice(index, 1);
        await repositories.saveGlobalVariables(variables);
      } else if (environmentId) {
        const environment = await repositories.getEnvironment(environmentId);
        if (environment) { environment.variables.splice(index, 1); await repositories.saveEnvironment(environment); }
      }
      await renderEnvironments();
      return;
    }
    const environmentCard = button.closest("[data-environment-id]");
    if (environmentCard && action === "add-variable") {
      await flushVariableSave();
      const environment = await repositories.getEnvironment(environmentCard.getAttribute("data-environment-id"));
      if (environment) { environment.variables.push({ id: newId(), name: "", value: "", secret: false }); await repositories.saveEnvironment(environment); await renderEnvironments(); }
    }
    if (environmentCard && action === "delete-environment") {
      if (!window.confirm(settings.locale === "en" ? "Delete this environment?" : "删除此环境？")) return;
      const environmentId = environmentCard.getAttribute("data-environment-id");
      await repositories.deleteEnvironment(environmentId);
      if (draft.environmentId === environmentId) draft.environmentId = null;
      await renderEnvironments(); renderDraft();
    }
  });

  async function showStoredResponse(result) {
    if (!result) return;
    if (result.previewText !== undefined) { renderResponse(result); return; }
    if (!result.bodyRef) { renderResponse(result); return; }
    const response = await repositories.getResponse(result.bodyRef).catch(() => null);
    if (!response) { renderResponse(result); return; }
    const decoded = new TextDecoder().decode(response.bytes);
    renderResponse({ ...result, previewText: decoded.slice(0, 1024 * 1024), isBinary: response.isBinary });
  }
  function renderResponse(result) {
    const empty = $("#response-empty");
    const content = $("#response-content");
    const hasResponse = result.statusCode != null || result.errorCode || result.errorMessage;
    empty.hidden = hasResponse;
    content.hidden = !hasResponse;
    if (!hasResponse) return;
    $("#response-status").textContent = result.statusCode == null ? t(`status.${result.status}`) : `${result.statusCode} ${result.statusText ?? ""}`.trim();
    const failed = ["failed", "cancelled", "timed_out", "interrupted"].includes(result.status);
    $("#response-status").className = `status-pill ${failed || result.statusCode >= 400 ? "is-error" : result.statusCode >= 300 ? "is-warning" : "is-success"}`;
    $("#response-time").textContent = formatDuration(result.timingMs ?? 0);
    $("#response-size").textContent = formatBytes(result.receivedBytes ?? 0);
    $("#response-final-url").textContent = text(result.finalUrl);
    $("#response-error").textContent = result.errorMessage ?? result.errorCode ?? "";
    $("#response-error").hidden = !result.errorCode && !result.errorMessage;
    $("#response-warning").textContent = (result.warnings ?? []).join(" ");
    $("#response-warning").hidden = !(result.warnings?.length);
    $("#data-output").textContent = result.isBinary ? "" : result.previewText ?? "";
    $("#response-binary").hidden = result.isBinary !== true;
    $("#response-no-body").hidden = result.isBinary === true || result.receivedBytes !== 0;
    $("#response-truncated").hidden = !result.truncated;
    $("#download-response-btn").disabled = !result.bodyRef;
    $("#response-header-list").replaceChildren(...Object.entries(result.headers ?? {}).map(([name, value]) => {
      const row = document.createElement("div"); row.className = "header-row";
      const key = document.createElement("code"); key.textContent = name;
      const val = document.createElement("span"); val.textContent = text(value);
      row.append(key, val); return row;
    }));
    $("#response-mode-preview").classList.add("is-active");
    $("#response-mode-headers").classList.remove("is-active");
    $("#response-preview-pane").hidden = false;
    $("#response-headers-pane").hidden = true;
    latestResult = result;
    lastDisplayedResponseId = result.taskId ?? result.id ?? lastDisplayedResponseId;
  }
  function setResponseMode(mode) {
    const preview = mode === "preview";
    $("#response-preview-pane").hidden = !preview;
    $("#response-headers-pane").hidden = preview;
    $("#response-mode-preview").classList.toggle("is-active", preview);
    $("#response-mode-headers").classList.toggle("is-active", !preview);
  }
  function formatResponse() {
    const output = $("#data-output");
    try { output.textContent = JSON.stringify(JSON.parse(output.textContent ?? ""), null, 2); }
    catch { message("The response body is not valid JSON.", true); }
  }
  function findInResponse() {
    const query = /** @type {HTMLInputElement} */ $("#response-search").value;
    if (!query) return;
    const content = $("#data-output").textContent ?? "";
    if (query !== responseSearchTerm) { responseSearchTerm = query; responseSearchIndex = -1; }
    const start = content.indexOf(query, responseSearchIndex + 1);
    const index = start >= 0 ? start : content.indexOf(query);
    if (index < 0) { message(settings.locale === "en" ? "No match found." : "没有找到匹配内容。"); return; }
    responseSearchIndex = index;
    const range = document.createRange();
    range.setStart($("#data-output").firstChild ?? $("#data-output"), index);
    range.setEnd($("#data-output").firstChild ?? $("#data-output"), index + query.length);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    $("#data-output").scrollIntoView({ block: "nearest" });
  }
  async function downloadResponse() {
    if (!latestResult?.bodyRef) { message(t("response.noRaw"), true); return; }
    try {
      let bytes;
      const stored = await repositories.getResponse(latestResult.bodyRef).catch(() => null);
      if (stored) bytes = stored.bytes instanceof Uint8Array ? stored.bytes : new Uint8Array(stored.bytes);
      else {
        const pieces = [];
        let totalBytes = 0;
        for (let offset = 0; offset < 20 * 1024 * 1024; offset += 256 * 1024) {
          const response = isWorkbench
            ? { chunk: getEphemeralResponseChunk(latestResult.bodyRef, offset, 256 * 1024) }
            : await chrome.runtime.sendMessage({ type: "RESPONSE_CHUNK", responseId: latestResult.bodyRef, offset, size: 256 * 1024 });
          const chunk = response?.chunk;
          if (!chunk) break;
          const part = new Uint8Array(chunk.bytes);
          pieces.push(part);
          totalBytes = chunk.totalBytes;
          if (!part.length || offset + part.length >= totalBytes) break;
        }
        if (pieces.length) {
          bytes = new Uint8Array(pieces.reduce((sum, part) => sum + part.length, 0));
          let offset = 0;
          for (const part of pieces) { bytes.set(part, offset); offset += part.length; }
        }
      }
      if (!bytes) { message(t("response.noRaw"), true); return; }
      const contentType = latestResult.contentType || "application/octet-stream";
      const extension = contentType.includes("json") ? "json" : contentType.startsWith("text/") ? "txt" : "bin";
      downloadBlob(new Blob([bytes], { type: contentType }), `ctool-response-${latestResult.statusCode ?? "raw"}.${extension}`);
    } catch (error) { message(text(error?.message), true); }
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.hidden = true;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  function formatBytes(value) {
    if (value < 1024) return t("status.bytes", { count: value });
    if (value < 1024 * 1024) return t("status.kib", { count: (value / 1024).toFixed(1) });
    return t("status.mib", { count: (value / (1024 * 1024)).toFixed(2) });
  }
  function formatDuration(value) { return value >= 1000 ? t("status.seconds", { count: (value / 1000).toFixed(2) }) : t("status.milliseconds", { count: value }); }
  document.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement ? event.target : null);
    const card = target?.closest("[data-record-id]");
    const button = target?.closest("button[data-action='restore']");
    if (!card || !button) return;
    const id = card.getAttribute("data-record-id");
    void (async () => {
      const item = await repositories.getFavorite(id) ?? await repositories.getHistory(id);
      if (!item?.request) return;
      setDraft(item.request); openPanel("request");
    })();
  });

  await start();
  window.setInterval(() => { void refreshTaskStatus(); }, 1000);
  return { database: db, repositories, getDraft: () => draft, close: () => db.close() };
}

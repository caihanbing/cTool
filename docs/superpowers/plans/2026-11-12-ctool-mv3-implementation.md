# cTool 2.0 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task by task. Track steps in Work Item WORK-20261112-001.

**Goal:** Ship a locally private, tested cURL debugger for Chrome and Edge.

**Architecture:** Native ES modules split into shared models/parsers, IndexedDB storage, an MV3 task worker, and popup/full-tab views. Temporary network header rules are scoped to one request and removed on all terminal paths.

**Tech Stack:** Node 22, native JavaScript/CSS, JSDoc + TypeScript checkJs, node:test, Playwright + bundled Chromium.

**Spec:** docs/superpowers/specs/2026-11-12-ctool-mv3-design.md

## Global Constraints

- Keep the repository root loadable and preserve popup/view/popup.html.
- Support Chrome and Edge MV3 with HTTP/HTTPS permissions.
- Persist locally only; do not log sensitive request or response values.
- Never execute shell text or silently ignore unsupported transport flags.
- Popup request deadline 25 seconds; full-tab deadline 300 seconds.
- One active request globally; no automatic retry after worker restart.
- Response limits: 1 MiB preview, 20 MiB receive, ten retained bodies for 24 hours.

## Review Focus

- Malformed Bash/CMD quoting is rejected without execution.
- Duplicate and empty query values survive import/edit/export in order.
- Cookie rules clean up after success, timeout, cancel, and worker restart.
- Popup closure yields a stored terminal result or explicit interruption, never a ghost task.
- Imported HTML renders as text; secret export requires deliberate confirmation.

---

### Task 1: Tooling and feasibility

**Files:** package.json, package-lock.json, tsconfig.json, eslint.config.js, playwright.config.js, tests/unit/, tests/extension/, scripts/fixture-server.mjs.

**Interfaces:** npm test, npm run typecheck, npm run lint, npm run test:extension. Fixture binds loopback and serves JSON, text, empty, error, binary, redirect, delayed, Cookie echo, and multipart routes.

- [x] Add extension coverage for Cookie rule scope, popup-close completion, and multipart transport.
- [x] Add Node 22 scripts and Playwright persistent Chromium fixture with a loopback-only receiver.
- [x] Verify DNR feasibility in bundled Chromium; exact initiator/URL/method, redirect, and ordinary-page isolation pass.

### Task 2: Models, cURL, variables

**Files:** src/shared/request-model.js, src/shared/curl/{tokenize,import,export}.js, src/shared/environment.js, tests/unit/curl.test.js, tests/unit/environment.test.js.

**Interfaces:** createRequestDraft(input) returns RequestDraft; parseCurlCommand(text, shell) returns {draft,warnings} or CurlParseError; buildCurlCommand(draft,shell) returns string; resolveEnvironment(draft,globalVars,environment) returns {draft,missing}. RequestDraft contains id/name/method/url, ordered query/header rows, auth, body, redirectMode, timeoutMs, environmentId. RunResult contains id/requestId/status/timing/statusCode/finalUrl/headers/bodyRef/receivedBytes/errorCode.

- [x] Test Bash/CMD quoting, continuations, duplicate/empty query values, methods, headers, Cookie, Basic, bodies and invalid options.
- [x] Test shell text never executes, round-trip export, one-pass variable precedence, missing variables and Authorization conflicts.
- [x] Implement request models, parser/generator, variable resolution and request validation; focused and full unit suites pass.

### Task 3: Persistence and migration

**Files:** src/shared/storage/database.js, src/shared/storage/repositories.js, src/shared/storage/migrate-legacy.js, tests/unit/storage.test.js, tests/unit/migration.test.js.

- [x] Test history cap, CRUD, transaction rollback, concurrent writes, quota errors and corrupt legacy JSON.
- [x] Implement IndexedDB repositories and transactional writes; save settings in chrome.storage.local.
- [x] Migrate valid curlHistory once; preserve the new store on corrupt input. Enforce response retention bounds and visible quota errors.

### Task 4: MV3 execution and DNR

**Files:** background/background.js, src/background/{task-manager,message-router,request-executor}.js, tests/extension/{request-lifecycle,dnr-scope}.spec.js.

**Interfaces:** Internal RUN_START carries taskId/requestId/source; RUN_CANCEL carries taskId. Validate sender extension ID and own-page URL. startRun acquires the global lock, persists state, installs exact-target session rules, fetches with abort deadline, persists terminal RunResult, and removes rules/lock in finally.

- [x] Test Cookie/restricted-header target matching, web-page isolation, cleanup on terminal paths and restart reconciliation.
- [x] Implement popup 25-second and workbench 300-second execution; never auto-retry.
- [x] Test redirect default and enabled behavior; reject cross-origin credential forwarding.

### Task 5: Responses and downloads

**Files:** src/shared/response-reader.js, src/shared/downloads.js, response UI modules, tests/unit/response-reader.test.js, tests/extension/response.spec.js.

- [x] Test JSON/text/empty/4xx/5xx/binary responses, preview/receive limits and raw downloads.
- [x] Implement bounded streaming, preserved HTTP error bodies, safe header display, formatting/search/copy and raw downloads.

### Task 6: Popup and full-tab product

**Files:** popup/view/popup.html, popup/view/workbench.html, popup/script/{popup-entry,workbench-entry}.js, popup/style/, src/ui/, tests/extension/ui.spec.js.

- [x] Test RequestDraft editing, keyboard access, localization/theme, history/favorite restore and privacy mode.
- [x] Implement request/response/history/favorites/environment/settings navigation and long-request workbench.
- [x] Test schema-versioned import preview/merge IDs, secret-variable filtering, explicit full export, malicious HTML and storage errors.

### Task 7: Manifest, docs, package

**Files:** manifest.json, scripts/package.mjs, LICENSE, README.md, PRIVACY.md, docs/compatibility/curl.md, CHANGELOG.md, sanitized tests/fixtures/.

- [x] Test the old popup entry, manifest, permission declarations and package allowlist.
- [x] Remove Node debug reads, obsolete scripts and tracked test.txt; retain only loopback fixtures.
- [x] Build loadable root extension and whitelist ZIP; verify no tests, node_modules or remote scripts are packaged.
- [x] Preserve old localStorage data through tested migration; document install/upgrade/uninstall and permissions.

### Task 8: Cross-browser review and delivery

**Files:** .github/workflows/ci.yml, docs/features/{curl-request-workbench,curl-history,environment-variables,saved-requests,index}.md, docs/work-items/WORK-20261112-001.md, docs/work-items/WORK-20261112-001.md.

- [x] Run typecheck, lint, 43 unit tests, 16 extension E2E tests and package checks; all pass.
- [ ] Install unpacked build in stable Chrome and Edge; verify local request, Cookie, popup close/reopen, and multipart. Versions are known, but UI installation has not been verified in this session.
- [x] Review correctness, failure paths, concurrency, DNR, migration/privacy, compatibility and package contents; record remaining stable-browser smoke as pending.
- [x] Update and structurally validate Feature Docs and Work Item; implementation snapshot freshness is validated after the implementation commit.
- [ ] Commit, integrate the remote main fast-forward, and push without force.

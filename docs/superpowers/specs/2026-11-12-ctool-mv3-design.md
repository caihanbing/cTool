# cTool 2.0 Design

## Intent

Ship a locally private, publishable Manifest V3 cURL debugger for Chrome and Edge. Keep the toolbar popup as the main editor and add a full-tab workbench for long requests and large responses.

## Approved decisions

- Support documented Chrome/Edge DevTools Bash and Windows CMD cURL syntax. Parse command text; never execute shell. Reject unsupported proxy, certificate, and local-script options explicitly.
- Request data, drafts, history, favorites, and environments remain local. Request all HTTP/HTTPS host permissions at install time; do not read browser profile cookies.
- Use temporary declarativeNetRequest session rules for manual Cookie and selected restricted headers. Scope rules to extension-origin requests and exact URL/method. Allow one active request globally. Clean rules on all terminal paths and recovery.
- Popup-origin requests continue after closing the popup for at most 25 seconds. Requests up to 300 seconds run in the full tab. Never retry automatically after worker restart.
- Use IndexedDB for requests, history, favorites, environments, and temporary responses; use chrome.storage.local for preferences. Migrate valid curlHistory data once without overwriting new data on corruption.
- Support JSON, text, URL-encoded form, and multipart text/files. Imported local paths require user file selection; reused uploads require reselection.
- Use native JavaScript ES modules/CSS with JSDoc type checking, Node's test runner, and Playwright with bundled Chromium.
- Release version 2.0.0. Add MIT license for caihanbing. Publish source and a whitelist-built ZIP to GitHub; do not submit to a browser store.

## Functional behavior

The editor owns one RequestDraft and sends that exact edited model. It preserves duplicate ordered query parameters and enabled headers. Missing variables, authentication conflicts, invalid URLs, and unsupported behavior-changing cURL flags block sending with a clear message.

The executor stores RunResult states: success, HTTP error, network error, cancelled, timeout, interrupted. Preserve HTTP error bodies. Do not follow redirects by default. When enabled, use browser redirect behavior and do not forward manual credentials to another origin.

Persist up to 100 history records, named favorites, global and environment variables, drafts, and preferences. Store at most ten response bodies for 24 hours; limit preview to 1 MiB and receive to 20 MiB. Privacy mode skips automatic persistence except explicitly saved favorites.

Backup JSON is schema-versioned, validated and previewed before merge; imported records get new IDs. Secret-marked variables are excluded by default. Warn that other fields can also contain secrets and require explicit choice for a full export.

## Compatibility, privacy, release

Keep the existing popup entry path so users can reload in place. Render all request/response/import data as text. Accept runtime messages only from this extension. Do not load remote scripts or log sensitive values. Remove the tracked external request sample in the new commit; do not rewrite Git history.

DNR behavior is a release gate: the receiver must see Cookie/restricted headers exactly once; headers must not leak to cross-origin redirects or ordinary web-page requests. If a browser fails this gate, stop release and report the incompatibility rather than silently changing requests.

Unit and extension tests cover parser safety, duplicate/empty query values, model validation, environment precedence, persistence/migration failures, DNR cleanup, redirects, response types, multipart, popup closure, history restore, import/export, and injection-safe rendering. Use a loopback HTTP fixture. Install the built unpacked extension in the available Chrome and Edge versions and record each version before merging. See Chrome's [MV3 worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [DNR API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), and Playwright's [extension testing guide](https://playwright.dev/docs/chrome-extensions).

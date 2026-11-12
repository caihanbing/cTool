# cTool 2.0

cTool is a local-first Chrome and Edge extension for importing, editing, and sending cURL-style HTTP requests. The toolbar popup is the quick request editor; open the full-tab workbench for longer requests and more room to inspect responses.

## Install from source or ZIP

1. Download the source repository or extract `ctool-2.0.0.zip` into a stable folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Turn on **Developer mode**, select **Load unpacked**, and choose the extracted `ctool-2.0.0-unpacked` folder (or the repository root).
4. Pin cTool if you want one-click access from the toolbar.

The first install asks for access to HTTP and HTTPS sites. cTool needs that access to send the requests you enter. To upgrade an unpacked installation, replace its files in the same folder and select **Reload** on the existing extension card. Keeping the same extension installation and browser profile lets cTool migrate the old `curlHistory` data into its local database.

## Use

- Paste a cURL command from Chrome or Edge DevTools and select **Parse and import**. The parser reads command arguments; it never runs shell commands or local scripts.
- Edit the method, URL, ordered query parameters, headers, authentication, body, environment, and timeout in the request panel. **Send request** always sends the current editor state.
- Select JSON, raw text, URL-encoded, or multipart bodies. For imported file fields, choose the actual file in the browser. cTool does not open paths copied from a terminal command.
- Inspect status, duration, received size, final URL, response headers, and body. Copy or download the response body; text and JSON previews are capped at 1 MiB, while a response is capped at 20 MiB.
- Use history, saved drafts, favorites, and environment variables to reuse requests. `{{name}}` placeholders resolve once; selected environment values override globals.
- Turn on **Private mode** to stop automatic persistence of new drafts, history, and response bodies. Explicitly saved favorites remain available.
- Use **Settings → Backup and restore** to validate and preview a JSON backup before merging it. The default export omits variables marked secret; other request data can still contain credentials.

Popup requests continue in the background for up to 25 seconds after the popup closes. Use the expanded workbench for requests up to five minutes. Only one cTool request runs at a time.

## Local development

Requirements: Node.js 22 or later and npm.

```sh
npm ci
npm run icons
npm run check
```

`npm run check` performs JSDoc type checking, ESLint, unit tests, Playwright extension tests against its loopback-only HTTP fixture, and a release-package content check. `npm run package:check` creates `dist/ctool-2.0.0-unpacked` and `dist/ctool-2.0.0.zip` from an explicit file allowlist. The source root remains directly loadable as an unpacked extension.

Each successful GitHub Actions verification uploads `ctool-2.0.0.zip` as a 90-day workflow artifact.

The automated extension suite uses Playwright's bundled Chromium. Check a release in installed Chrome and Edge by loading the unpacked folder from each browser's extension management page, then follow the popup, request, Cookie isolation, multipart, and popup-close steps in the Work Item. Current stable Chrome and Edge do not support Playwright's command-line extension sideload flags, so that installed-browser check is a manual release step.

See [cURL compatibility](docs/compatibility/curl.md), [privacy](PRIVACY.md), and [release notes](CHANGELOG.md). cTool is distributed under the [MIT License](LICENSE).

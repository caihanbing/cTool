# cTool Privacy

Last updated: 2026-11-12

cTool is a browser extension for requests that the user explicitly enters or imports. It does not include an account, server component, analytics, advertising, or telemetry.

## Network access

cTool requests access to all HTTP and HTTPS sites at installation. This host permission allows the extension to send requests to URLs entered by the user, including cross-origin APIs. The extension does not crawl pages or make background requests to third-party services.

The extension does not read, import, or send the browser profile's stored cookies. Requests use `credentials: omit`. If a user explicitly supplies `Cookie`, `Referer`, `Origin`, or `User-Agent`, cTool applies that value through a short-lived browser network rule scoped to the extension, request method, and exact initial target URL. The rule is removed when the request ends and is not applied to ordinary page requests or a different redirect URL. cTool does not disable TLS certificate checks.

## Local data

Request drafts, history, favorites, environments, and retained response bodies are stored in the current browser profile using IndexedDB. Preferences are stored in `chrome.storage.local`; these stores are not synced by cTool. Data is not encrypted by cTool and is subject to the browser profile's local-device security and storage behavior.

History retains up to 100 request results. Raw response bodies are limited to 20 MiB each, and the most recent ten are retained for up to 24 hours. Response previews show up to 1 MiB. Browser storage quota failures are reported in the interface.

Private mode prevents automatic persistence of new drafts, history entries, and response bodies. A response needed for the current private-mode session may remain temporarily in extension memory. Saving a favorite is an explicit action and continues to store that favorite locally.

## Import and export

cURL parsing treats pasted content as text and never evaluates it. A file path in a multipart cURL command is only a hint; the user must select the file through the browser picker.

Backup files may contain URLs, headers, request bodies, and authentication values. Variables marked secret are excluded by default. Selecting the explicit include-secrets option includes those variables; it does not remove credentials that may be present in other request fields. Store exported files carefully.

## Permissions

- `storage` saves preferences in `chrome.storage.local` and keeps popup-to-workbench handoff data in the temporary `chrome.storage.session` area.
- `declarativeNetRequestWithHostAccess` applies temporary user-supplied restricted headers to a request.
- HTTP and HTTPS host access lets the extension send the user's chosen requests.

cTool does not request access to the browser cookie store, browsing history, or downloads API. Uninstalling the extension removes its profile data according to the browser's extension-storage behavior.

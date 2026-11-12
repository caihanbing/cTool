# cURL 请求工作台

<!-- feature-id: curl-request-workbench -->
<!-- feature-title: cURL 请求工作台 -->
<!-- feature-aliases: HTTP 请求调试, cURL 请求, 请求工作台 -->
<!-- feature-status: active -->
<!-- feature-summary: 在弹窗和全页工作台导入、编辑、发送 cURL 请求并安全查看响应。 -->
<!-- last-verified: 2026-11-12 -->
<!-- code-basis: HEAD 5dbac97825c2; worktree-digest sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->

## 快速上下文

cTool 是 Chrome、Edge Manifest V3 扩展。`popup/view/popup.html` 提供快速弹窗，`popup/view/workbench.html` 提供可展开的长请求工作台；两者加载同一 `src/ui/app-controller.js` 和统一请求模型。请求通过 Service Worker 或工作台页面执行，响应和管理对象保存在浏览器本机。

界面支持 Bash/CMD cURL 导入、编辑、生成和下载，常见 HTTP 方法、请求头、查询参数、Basic/Bearer、JSON/文本/表单/multipart，以及状态、耗时、头和正文查看。解析器只处理命令参数，不执行 Shell；传输受浏览器 Fetch、MV3 DNR 和权限约束。

## 目标与边界

### 目标

- 把粘贴的 cURL 转成可编辑的 `RequestDraft`，发送时使用编辑器当前值。
- 在弹窗与全页工作台间提供一致的请求、响应和恢复体验。
- 对浏览器无法复现的 cURL 行为给出拒绝或说明。

### 范围内

- 解析 Bash 和 Windows CMD 常见引号、转义、续行、方法、头、Cookie、认证、正文及 multipart 字段。
- 保持重复查询参数的顺序；支持 HTTP/HTTPS、GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS。
- 编辑请求行、启停查询参数和头，配置 Basic/Bearer、JSON、文本、URL 编码及 multipart；文件字段由用户重新选择。
- 展示 HTTP 成功与错误响应、状态、耗时、接收字节、最终 URL、响应头和正文；提供搜索、格式化、复制和原文下载。
- Popup 请求通过后台执行，最长 25 秒；全页工作台的请求最长 300 秒。

### 范围外

- 完整复刻系统 cURL、执行 Shell 或脚本、读取 `@path` 中本地文件、代理、客户端证书、TLS 校验绕过和连接级参数。
- 获取被浏览器隐藏的原始 3xx 正文或完整跳转链。
- 使用浏览器 profile Cookie、Native Messaging、远端请求代理或云端数据同步。

### 不变量

- `send` 对当前 `RequestDraft` 校验并执行；不会在发送时重新解析旧的 cURL 文本。
- 仅接受绝对 HTTP/HTTPS URL；Basic/Bearer 与启用的手工 `Authorization` 头冲突时拒绝发送。
- 请求使用 `credentials: "omit"`；浏览器管理的头不直接传给 Fetch。
- 上传文件在本机选择；草稿、历史、收藏、备份和迁移记录均不保留文件字节或本地路径。

## 业务行为

- `parseCurlCommand(source, shell)` 将命令读作参数；不调用 Shell、`curl` 或本机脚本。位置 URL 与 `--url` 可导入；不支持的选项返回明确解析错误。
- `-F name=@path` 只生成需要选文件的字段和文件名提示；真正上传前必须使用文件选择器。
- 每次发送先做环境变量替换和 `validateRequestDraft`；缺失变量、认证冲突、浏览器控制头、无效方法、GET/HEAD 正文或缺少文件均阻止请求。
- 手动 Cookie、Referer、Origin、User-Agent 使用限时 DNR 规则；默认不跟随重定向。开启跟随后由浏览器决定跳转行为。
- HTTP 4xx/5xx 仍展示响应正文；传输失败、取消、超时和中断显示不同状态，不会自动重发。

## 架构与代码地图

- `src/shared/request-model.js` — `createRequestDraft`、`composeRequestUrl`、`validateRequestDraft`、`stripFileAttachments`。
- `src/shared/curl/tokenize.js`、`src/shared/curl/import.js` — Bash/CMD 参数化、`parseCurlCommand`、选项校验和导入警告。
- `src/shared/curl/export.js` — `buildCurlCommand`，按 Bash 或 CMD 生成可复制文本。
- `src/shared/request-executor.js` — `prepareFetchRequest`、DNR 限定头、任务锁、超时/取消、响应读取和终态持久化。
- `src/background/task-manager.js`、`background/background.js` — Service Worker 消息入口、弹窗请求和中断恢复。
- `src/shared/response-reader.js` — 有界流读取、文本/二进制识别、预览截断与接收上限。
- `src/ui/app-controller.js`、`src/ui/locale.js` — Popup 与工作台共用控制器、本地化、表单和安全文本呈现。
- `popup/view/popup.html`、`popup/view/workbench.html`、`popup/style/app.css`、`popup/style/app-theme.css` — 两个入口与主题样式。

## API、事件与任务

### `parseCurlCommand(source, shell)` / `buildCurlCommand(draft, shell)`

- 输入：命令文本与 `auto`、`bash` 或 `cmd`；或完整 `RequestDraft` 与输出 shell。
- 输出：解析器返回 `{ draft, warnings }`；非法语法、不支持选项或多 URL 抛出 `CurlParseError`。生成器输出命令文本。
- 消费者：`src/ui/app-controller.js` 的导入、复制和下载操作；契约由 `tests/unit/curl.test.js` 覆盖。
- 兼容性：`docs/compatibility/curl.md` 列出支持、拒绝及浏览器托管选项。

### `RUN_START`, `RUN_STATUS`, `RUN_CANCEL`, `RESPONSE_CHUNK`

- 输入：扩展自有页面消息；`RUN_START` 携带 `taskId`、`requestId`、draft 和可选超时；取消按 `taskId`；响应分块按 ID、offset、size 读取。
- 输出：运行状态或带 `RunResult` 的响应；状态包含 `completed`、`failed`、`cancelled`、`timed_out`、`interrupted`。
- 错误：消息发送者不是该扩展的 `chrome-extension:` 页面时不处理；忙碌请求返回 `TASK_BUSY`。
- 消费者：`background/background.js` 与 `src/ui/app-controller.js`。Popup 超时硬上限 25,000 ms；工作台在自身页面运行，硬上限 300,000 ms。

### `runRequest(draft, options)`

- 输入：`RequestDraft`、IndexedDB repositories、DNR、扩展 ID、请求/任务 ID、来源、超时、隐私模式与取消信号。
- 输出：状态码、耗时、最终 URL、响应头、预览字节数、类型、警告或错误码；响应原文由响应仓库或短期内存分块读取。
- 错误：请求准备错误会带 `code`；网络、超限、超时、取消和重定向阻断映射到不同终态，并释放任务锁和临时规则。
- 消费者：Service Worker 和全页工作台共用；`tests/unit/request-executor.test.js` 及扩展 E2E 覆盖传输行为。

## 数据模型与迁移

- `RequestDraft` 含 `id`、`name`、`method`、`url`、有序 `query`/`headers`、`auth`、`body`、`redirectMode`、`timeoutMs`、`environmentId`。
- `IndexedDB ctool-local-v2` 包含 `drafts`、`history`、`favorites`、`environments`、`responses`、`meta`；设置另存在 `chrome.storage.local`。
- 单活动任务放在 `meta.activeTask`。自动完成后在一个读写事务内写历史、响应、删除活动锁；响应最多 10 项并清除超过 24 小时的项。
- `stripFileAttachments` 在写入请求和历史前删除 `fileData`、`filePathHint`；恢复含文件的请求时要求重新选择文件。
- 旧 `localStorage.curlHistory` 由 `migrateLegacyHistory` 一次性读入；迁移保留有效 URL、参数、头和 JSON payload。解析失败的原始值不覆盖新库，也不标记迁移成功。

## 核心流程

1. App 初始化 IndexedDB、读取 `chrome.storage.local` 设置，并尝试兼容迁移旧 `curlHistory`。
2. 用户输入 cURL；解析器返回 `RequestDraft`，控制器将结果装载到编辑器。之后发送只从可见编辑字段同步当前 draft。
3. 执行前用 `resolveEnvironment` 做一次变量替换，再验证 URL、方法、文件与认证冲突。
4. 获取全局活动任务锁；Popup 将 `RUN_START` 发给 Service Worker，工作台在扩展页面内直接执行；需要时安装限目标临时 DNR 规则。
5. Fetch 读取响应流；结果、历史及受限响应体通过事务保存，之后清除计时器、DNR 规则和活动锁。
6. 请求恢复、取消、查看响应、编辑后重新执行或导出 cURL 均不会自动重发上一次网络请求。

## 异常与边界条件

- 无效 URL/方法或认证冲突 — `validateRequestDraft` 返回错误，界面提示后不发送。
- 未知 cURL 标志、本地 shell 行为或代理/证书选项 — `parseCurlCommand` 拒绝并显示受限原因。
- 缺失环境变量或文件 — 执行前阻止，用户在环境面板补变量或重新选择附件。
- 请求忙碌 — 第二个窗口收到忙碌状态；用户等待或取消现有 `taskId`。
- 无重定向模式遇到跳转 — 浏览器可能只给 opaque redirect；显示说明，不承诺读取 3xx body。
- 正文超过 20 MiB — 读取中止并返回 `RESPONSE_TOO_LARGE`；预览最多 1 MiB，二进制内容不按 HTML/文本渲染。
- DNR 清理失败 — 结果附警告；恢复或下一任务初始化清掉遗留的受限规则。

## 并发与幂等

- `repositories.acquireActiveTask` 在 IndexedDB 事务中建立单一活动锁，Popup 和工作台共用；不同任务不能同时执行。
- 每个任务以 UUID 的 `taskId` 为锁所有者；只有所有者能释放或完成它，重复取消不会释放其他任务的锁。
- Worker 恢复时清除已知 DNR 规则并把失效任务记作 `interrupted`，不重放请求。仍有工作台心跳的页面任务保留至超时。
- 存储失败会释放锁并向界面返回提示；不保证“本地落库失败”时历史可恢复。

## 安全与权限

- `manifest.json` 只请求 `storage`、`declarativeNetRequestWithHostAccess` 和 HTTP/HTTPS 主机权限；没有 `cookies` 权限，不读取或改写浏览器 Cookie 库。
- Fetch 的 `credentials` 为 `omit`；手工受限头通过规则限定扩展 initiator、初始完整 URL、host、method 和 `xmlhttprequest` 类型。重定向目标与普通网页不匹配该规则。
- 不支持由浏览器控制的 `Host`、`Content-Length`、`Connection`、`sec-*`、代理头等输入。
- 请求、响应和导入内容以文本节点或 DOM 属性写入；远端响应不会作为 HTML 执行。生产代码不记录敏感正文日志，不加载远程脚本。
- 本机存储不云同步；本地数据和导出备份可能含凭据。备份默认排除标记为 secret 的变量。

## 配置与依赖

- `manifest.json` 使用 MV3，Popup 保留原 `popup/view/popup.html` 入口；工作台是扩展全页文档。
- 请求执行使用浏览器 Fetch、DNR、IndexedDB、`chrome.storage.local`、下载 Blob URL 和 File API。
- 默认语言简体中文；支持英文；主题为 `system`、`light` 或 `dark`。默认超时 25 秒，工作台最多 300 秒。
- Node 22/npm 仅用于开发、验证和 ZIP 打包；运行时不需要后台服务、第三方 API 或系统 cURL。

## 可观测性与运维

- UI 以内联状态呈现解析、网络、存储、忙碌和超限错误；任务终态存到历史时不含响应预览和错误原文。
- 运行时不向外传遥测；调试/fixture 服务只绑定 `127.0.0.1`，仅用于 Playwright。
- 使用 `npm run package:check` 生成 `dist/ctool-2.0.0-unpacked` 和 `dist/ctool-2.0.0.zip`；源码根目录仍能直接加载。
- Chrome/Edge 商店上架不在本轮范围；稳定版浏览器的手动安装冒烟仍需单独执行，见 Work Item。

## 测试与验证

### 已执行

- `npm run typecheck` — 通过；启用 JSDoc `checkJs`。
- `npm run lint` — 通过；ESLint 检查源代码与脚本。
- `npm test` — 43 项通过；覆盖 Bash/CMD 解析、往返生成、重复参数、环境替换、请求校验、响应限制、存储事务和恢复。
- `npm run test:extension` — 16 项通过；使用 loopback fixture 验证 DNR 精确匹配/隔离、Popup 关闭恢复、multipart、状态码、重定向、取消/超时、UI 和恶意 HTML 文本显示。
- `npm run package:check` — 通过；生成 33 个白名单文件，扫描排除测试、开发样例和远程脚本。

### 未执行

- Chrome 147.0.7727.138 与 Edge 157.0.4341.46 中的人工扩展安装和 UI 回归 — Playwright 已不再支持稳定版品牌浏览器通过命令行加载开发扩展；当前 Windows UI 自动化无法可靠取得浏览器 URL。对应浏览器版本已安装，但未声称其扩展验收通过；剩余风险是品牌浏览器的安装和实际 UI 行为差异。

## 关键决策

### DEC-001 — 以 Popup 为主并提供全页工作台

- **决定**：保留现有 Popup 入口，扩展页面供长请求和展开视图使用。
- **原因**：兼顾快捷操作与 300 秒请求生命周期。
- **取舍**：Popup 请求由后台继续执行；全页请求由页面持有控制器和心跳。
- **证据**：`manifest.json`、`popup/view/popup.html`、`popup/view/workbench.html` 与任务生命周期 E2E。

### DEC-002 — 浏览器网络限制公开说明

- **决定**：只实现可由 Fetch/DNR 安全表达的 cURL 子集，其他选项显式拒绝或警告。
- **原因**：浏览器不提供系统 cURL 的代理、TLS 绕过和完整重定向控制。
- **取舍**：不承诺一致的传输协议、TLS 或原始 3xx 表现。
- **证据**：`docs/compatibility/curl.md` 和 `src/shared/curl/import.js`。

## 已知问题与后续工作

### 稳定版 Chrome 与 Edge 安装验收待执行

- **影响**：自动化扩展回归在 Playwright 配套 Chromium 上通过，但没有证明各品牌浏览器当前版本中的手动安装及 UI 全流程。
- **当前处理**：README 提供扩展管理页手动加载步骤；测试未通过的情形不写成通过。
- **后续动作**：在 Chrome 与 Edge 扩展管理页分别加载 `dist/ctool-2.0.0-unpacked`，按 Work Item 本地 fixture 用例检查 Popup、Cookie 隔离、multipart、Popup 关闭恢复后记录版本与结果。

### 浏览器网络行为边界

- **影响**：Fetch/DNR 控制不了系统 cURL 的全部头、协议、代理、TLS 和重定向表现。
- **当前处理**：导入器拒绝本机/代理选项，兼容清单列出浏览器控制行为。
- **后续动作**：当目标浏览器扩大时，更新兼容清单并在对应版本回归。

## 变更记录

### 2026-11-12 — cTool 2.0 请求与响应闭环

- **状态**：部分完成
- **变化**：建立规范请求模型、Bash/CMD cURL 导入/生成、Popup 与工作台执行、DNR 限头、历史和多类型响应查看。
- **原因**：将原型扩展升级为本地优先、可打包的 MV3 调试工具。
- **兼容性**：保留 Popup 文件入口；历史兼容迁移在 `curl-history` 档案说明；旧命令格式按新兼容表处理。
- **验证**：`npm run check` 通过；稳定版 Chrome/Edge 人工安装仍待执行。

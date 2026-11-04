# cURL 请求工作台

<!-- feature-id: curl-request-workbench -->
<!-- feature-title: cURL 请求工作台 -->
<!-- feature-aliases: HTTP 请求调试, cURL 请求 -->
<!-- feature-status: active -->
<!-- feature-summary: 在扩展弹窗内解析和编辑 cURL 请求，发送 HTTP 请求并查看 JSON 响应；当前脚本含 Node 调试代码。 -->
<!-- last-verified: 2026-11-04 -->
<!-- code-basis: HEAD 562904fe8954; worktree-digest sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->

## 快速上下文

这是 Chrome Manifest V3 扩展弹窗中的 HTTP 请求工作台。用户在 `popup/view/popup.html` 粘贴 cURL 命令，`popup/script/popup.js` 调用 `parseCurlCommand` 将其解析为 URL、参数、请求头和载荷，允许编辑后再由 `fetch` 发送，并把 JSON 响应显示在弹窗中。

解析器 `popup/script/util/curl-parser.js` 同时包含 Node.js 的 `require('fs')` 和读取本地 `test.txt` 的调试代码。扩展页面没有 Node.js `require`；该脚本会在加载时遇到运行错误。浏览器对同一脚本中函数声明的处理以及完整弹窗流程没有运行时验证，因此档案只确认源码行为，不宣称解析和发送已在浏览器中通过验证。

## 目标与边界

### 目标

- 在扩展弹窗中把受限格式的 cURL 命令转换为可检查、可编辑的 HTTP 请求字段。
- 将请求发往命令中的 URL，并展示成功的 JSON 响应及可见响应头。
- 提供把当前响应 JSON 保存为本地文件的入口。

### 范围内

- 解析 URL 查询参数、请求头和 JSON 载荷，并在请求面板展示。
- 通过 `Update` 将编辑后的字段重新格式化为 cURL 命令。
- 通过 `fetch` 发送请求；成功时展示响应头和格式化 JSON。
- 通过弹窗中的 `Download` 按钮生成 JSON 文件。

### 范围外

- 对完整 cURL 语法的兼容、请求重试、请求取消或流式响应。
- 非 JSON 响应体的查看和下载。
- 服务端 API、身份管理或凭据管理；请求目标和请求头由用户输入。
- 扩展构建、发布和部署流程；仓库未提供相应脚本或说明。

### 不变量

- 请求目标来自解析后的 `parsedData.url`；扩展清单声明了 `<all_urls>` 主机权限。
- 请求载荷在发送时以 `JSON.stringify` 序列化；响应体固定由 `response.json()` 解析。
- 只有 `response.ok` 为真且 JSON 解析成功时，控制器才走成功显示和下载启用流程。

## 业务行为

- `Parse` 读取 cURL 输入并填入 URL、方法标记、参数表、请求头表和载荷编辑框。
- `Update` 从编辑器和表格重建 cURL。它会对参数名和值进行 URL 编码；载荷仅在方法为 `POST` 或 `PUT` 且非空时输出。
- `Send` 会重新解析原始 cURL 输入，而不是直接发送当前表格中的编辑结果。发送成功后，响应体按 JSON 格式显示，响应头写入表格。
- `Clear` 清空 cURL、URL、参数、请求头、载荷和响应输出，并隐藏请求与响应区域；方法标记没有纳入清空列表。折叠控件仅改变请求头等区域的可见状态。
- HTTP 非成功状态、网络异常或 JSON 解析错误通过控制台错误和 `alert` 展示，不显示非成功响应正文。

## 架构与代码地图

- `manifest.json` — 声明 Manifest V3、弹窗入口、后台 Service Worker 入口及权限。
- `popup/view/popup.html` — 工作台 DOM；依次加载 `popup/script/util/curl-parser.js` 和 `popup/script/popup.js`。
- `popup/script/popup.js` — `DOMContentLoaded` 控制器；绑定解析、发送、更新、清空、下载、折叠和打开历史窗口的事件。
- `popup/script/util/curl-parser.js` — 全局 `parseCurlCommand(curlCommand)`；按正则提取有限格式的 cURL 字段，并包含 Node 调试代码。
- `popup/script/util/curl-builder.js` — 当前为空文件，未被弹窗引用。
- `popup/style/main.css` 与 `popup/style/component/` — 弹窗布局与请求、响应和 cURL 区域样式。
- `background/background.js` — 当前为空文件，不参与请求工作台流程。

## API、事件与任务

### `parseCurlCommand(curlCommand)`

- 输入：字符串形式的 cURL 命令。
- 输出：包含 `url`、`method`、`headers`、`parameters`、`payload` 的对象；未匹配 URL 时 `url` 为空。
- 识别范围：单引号 URL、`-H 'Name: Value'`、`--data-raw 'JSON'`；发现 `--data` 子串时会将方法设为 `POST`。
- 错误：URL 匹配后由 `new URL` 解析，载荷由 `JSON.parse` 解析；无效 URL 或 JSON 会抛出异常。
- 消费者：`popup/script/popup.js` 的 `Parse` 和 `Send` 处理器。
- 兼容性：不解析 `-X` 方法参数；不能视为通用 cURL 解析器。

### HTTP `fetch`

- `Send` 直接调用浏览器 `fetch(parsedData.url, fetchOptions)`，选项来自解析对象的 `method` 和 `headers`；非空 `payload` 会序列化为 JSON 请求体。
- 成功输出读取 `response.headers` 和 `response.json()`；未配置独立代理、后端 API 或响应类型协商。

## 数据模型与迁移

- 临时请求模型由解析器返回：`{ url, method, headers, parameters, payload }`。表格和文本框是弹窗内的编辑状态，不单独持久化。
- 成功请求记录由工作台写入 `localStorage` 的 `curlHistory`；记录模式及历史页消费方式见 `curl-history` 档案。
- 没有数据库、Schema 或迁移脚本。

## 核心流程

1. 弹窗加载解析器脚本和控制器脚本；解析器含 Node.js 初始化语句，浏览器运行时行为尚未验证。
2. 用户输入 cURL 并点 `Parse`，控制器读取解析结果并渲染请求字段。
3. 用户可编辑字段；点 `Update` 会从当前字段生成新的 cURL 文本。
4. 点 `Send` 时控制器重新解析 cURL 输入并发起 `fetch`。
5. 成功且响应可解析为 JSON 时，控制器呈现响应头和正文、启用下载按钮，并向 `curlHistory` 写入记录。

## 异常与边界条件

- URL 正则不匹配 — 解析结果的 URL 为空；`Send` 显示无效命令提示。
- URL 或 JSON 格式不正确 — `new URL` 或 `JSON.parse` 抛错；控制器显示错误提示。
- 网络失败、HTTP 非成功状态或响应非 JSON — 进入错误处理；响应内容不呈现在响应区。
- 重复参数或同名请求头 — 解析对象使用普通对象赋值；同名项会覆盖前值。
- 原始 URL 含查询串 — 解析时将查询串拆到参数表；编辑 URL 后再由 `Update` 追加参数。
- 清空后继续编辑 — `Clear` 隐藏请求面板但未重置方法标记；后续 `Update` 仍可能读取上一次方法。

## 并发与幂等

- 没有请求锁、去重键、取消控制或幂等保护；多次点击可产生多个独立请求。
- 请求按钮未在请求期间禁用。并发请求完成顺序可能与发起顺序不同，响应区域以最后完成的处理器写入内容。
- 每次成功请求都会额外注册一次下载按钮监听器；后续点击可能触发多个已注册监听器。

## 安全与权限

- `manifest.json` 的 `<all_urls>` 允许扩展向任意主机发请求；请求 URL 和自定义请求头均由输入命令决定。
- 请求头、参数和响应头通过字符串插值写入 `innerHTML`。这些值可由用户输入或远端响应控制，存在 DOM 注入风险。
- 响应正文使用 `textContent` 写入；该路径不会按 HTML 解释正文。
- 本档案不包含仓库样例输入或其中的任何凭据、标识符。

## 配置与依赖

- 扩展清单：`manifest.json`；弹窗入口为 `popup/view/popup.html`。
- 网络依赖：浏览器 `fetch`、`URL`、`JSON` 和扩展清单中的 `<all_urls>` 主机权限。
- 清单还声明 `storage`、`downloads`、`clipboardRead`；当前工作台脚本未调用对应的 Chrome API。JSON 下载通过 `Blob`、对象 URL 和 `<a download>` 完成。
- 仓库没有 `package.json`、构建配置或自动化测试配置。

## 可观测性与运维

- 解析、更新和发送异常写入浏览器控制台并通过 `alert` 呈现。
- 没有指标、追踪、告警或后台任务；Service Worker 文件为空。
- 仓库没有扩展打包、发布或升级步骤说明。

## 测试与验证

### 已执行

- 静态源码核对 — 检查 `manifest.json`、弹窗 HTML、控制器、解析器、样式与权限声明；确认代码地图、调用路径及上述限制。
- 档案结构校验 — 分别对 `curl-request-workbench` 和 `curl-history` 运行 `feature_docs.py validate --repo . --id <feature-id> --mode structural`；两份档案均返回 `OK`。
- 实现快照校验 — 运行 `feature_docs.py validate --repo . --mode fresh`；返回 `OK all feature documents`，对应 `HEAD 562904fe8954` 和干净的实现快照。

### 未执行

- 扩展浏览器运行、HTTP 请求及下载回归 — 仓库未提供浏览器自动化测试或测试夹具，本次未执行。
- 单元与集成测试 — 仓库没有测试套件或依赖清单，本次未执行。

## 关键决策

不适用：仓库没有独立记录该功能的产品或架构决策；本档案只归纳当前代码行为，不把实现细节推断为长期产品约束。

## 已知问题与后续工作

### 解析器含浏览器不可用的 Node.js 初始化

- **影响**：加载 `curl-parser.js` 时会执行 `require('fs')` 和本地文件读取代码；浏览器扩展环境不提供 Node.js `require`。函数声明虽位于同一脚本中，但运行时是否仍可供后续脚本调用未验证。
- **当前处理**：记录为运行时兼容风险；没有声称 Parse 或 Send 已通过浏览器验证。
- **后续动作**：若继续维护，应把 Node 调试代码移出浏览器解析器，并在扩展运行时验证解析与发送流程。

### cURL 语法和方法识别有限

- **影响**：不读取 `-X`；`--data-raw` 会固定推断为 `POST`；正则仅覆盖有限引号形式。
- **当前处理**：仅按已实现的字段提取范围描述兼容性。
- **后续动作**：若扩展命令覆盖范围，应补充解析器用例并明确支持语法。

### 请求与响应表格有 DOM 注入风险

- **影响**：请求字段和响应头未经转义拼入 `innerHTML`。
- **当前处理**：只将风险记入档案；没有修改界面代码。
- **后续动作**：后续维护时应以文本节点或安全 DOM API 渲染字段，并对控制值进行浏览器验证。

### JSON 响应限制与重复下载监听器

- **影响**：非 JSON 响应失败；每次成功请求都增加下载监听器，可能重复下载。
- **当前处理**：当前成功路径只按 JSON 处理。
- **后续动作**：若需支持其他响应类型或稳定下载行为，应分别定义处理和监听器生命周期。

## 变更记录

### 2026-11-04 — 首次建立功能档案

- **状态**：已完成
- **变化**：新增 cURL 请求工作台的当前实现、边界和风险档案。
- **原因**：为后续维护提供可由仓库证据追溯的上下文。
- **兼容性**：仅新增文档，不修改扩展运行时、接口或数据。
- **验证**：静态核对 `manifest.json` 与相关源码；两份档案结构校验均返回 `OK`，实现快照校验返回 `OK all feature documents`。

# 请求历史

<!-- feature-id: curl-history -->
<!-- feature-title: 请求历史 -->
<!-- feature-aliases: cURL 历史, 请求记录 -->
<!-- feature-status: active -->
<!-- feature-summary: 将最近十条成功解析为 JSON 的请求写入扩展 localStorage，并在独立窗口展示。 -->
<!-- last-verified: 2026-11-04 -->
<!-- code-basis: HEAD 562904fe8954; worktree-digest sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->

## 快速上下文

请求历史由主弹窗 `popup/script/popup.js` 在 HTTP 成功且响应 JSON 解析成功后写入扩展来源的 `localStorage`，键名为 `curlHistory`，最多保留十条。`popup/view/history.html` 和 `popup/script/history.js` 在单独窗口中读取并展示时间、URL、结果和操作按钮。

历史列表可以显示已保存字段，但 `Apply` 当前不能恢复命令：写入记录使用 `curl` 属性，历史页读取的是 `entry.command`；此外主弹窗没有接收 `APPLY_COMMAND` 消息的处理器。历史页还引用了仓库中不存在的 `popup/style/history.css`。

## 目标与边界

### 目标

- 保存近期成功请求的命令和解析结果，供用户查看历史。
- 提供从历史窗口将命令回传主弹窗的恢复入口。

### 范围内

- 在成功请求后维护 `curlHistory`，记录时间、原始 cURL、解析数据和成功标记。
- 将记录数限制为十条，最新记录插入数组开头。
- 单独打开历史页并读取同一扩展来源的 `localStorage` 数据。
- 呈现时间、URL、结果字段和 `Apply` 控件。

### 范围外

- 服务端同步、跨设备同步、无限期归档、搜索、删除或编辑历史记录。
- 存储 HTTP 响应正文；记录中仅保存请求命令和解析数据。
- 当前不可用的命令恢复流程；代码只保留了尚未接通的按钮和消息片段。

### 不变量

- 存储键为 `curlHistory`；主弹窗成功路径最多保存十条记录。
- 记录的原始请求字段名为 `curl`，解析对象字段名为 `data`。
- 历史保存在扩展页面来源的 `localStorage`，不是远端数据库或 `chrome.storage`。

## 业务行为

- 主弹窗仅在请求被判定为成功且 `response.json()` 成功后保存一条历史。
- 每条记录包含固定 UTC+8 格式的时间、原始 cURL 文本、解析对象和 `succeed: true`；失败请求不写入历史。
- 历史窗口按数组顺序显示时间、`data.url` 和 `succeed`。界面中的结果列显示布尔值。
- `Apply` 控件当前不能把已存 cURL 恢复到主弹窗，见“已知问题与后续工作”。

## 架构与代码地图

- `manifest.json` — 配置扩展弹窗入口及 `storage` 权限；当前历史实现使用 Web Storage API。
- `popup/view/popup.html` — `history-btn` 打开历史页面。
- `popup/script/popup.js` — 从 `localStorage` 读取、更新 `curlHistory`，每次成功请求后截断至十条；通过 `window.open` 打开历史窗口。
- `popup/view/history.html` — 历史表格结构；引用缺失的 `popup/style/history.css`。
- `popup/script/history.js` — 读取历史记录并渲染行；尝试向 opener 发送恢复消息。
- `background/background.js` — 当前为空，不参与历史读写或消息转发。

## API、事件与任务

### `localStorage` 键 `curlHistory`

- 写入者：`popup/script/popup.js`。
- 读取者：主弹窗初始化逻辑和 `popup/script/history.js`。
- 值：JSON 序列化的记录数组，最多十条。
- 错误处理：`JSON.parse(localStorage.getItem(...))` 没有异常恢复；损坏数据会中断相关脚本的初始化。
- 兼容性：没有版本字段或迁移逻辑；字段名 `curl` 与历史页读取的 `command` 不一致。

### 历史窗口与 `APPLY_COMMAND`

- 主弹窗调用 `window.open('history.html', 'historyWindow', ...)` 打开子窗口。
- 历史页按钮尝试通过 `window.opener.postMessage({ type: 'APPLY_COMMAND', command }, '*')` 回传命令。
- 主弹窗没有 `message` 事件监听器；当前没有消息消费者，也没有有效的恢复操作。

## 数据模型与迁移

每条记录由主弹窗构造，形状如下：

- `time`：固定 UTC+8 偏移后格式化为 `YYYY-MM-DD HH-MM-SS`。
- `curl`：本次成功请求的原始命令字符串。
- `data`：解析对象，包含 `url`、`method`、`headers`、`parameters` 和 `payload`。
- `succeed`：成功路径写入的布尔值 `true`。

数组使用 `unshift` 添加新条目，再截取前十条。没有数据库、Schema 版本、迁移、清理 API 或同步机制。

## 核心流程

1. 主弹窗启动时从 `localStorage` 读取 `curlHistory`。
2. 请求工作台确认 HTTP 状态成功并解析 JSON 响应。
3. 工作台构造历史对象，将新对象插入数组开头，超过十条时截断并写回 `localStorage`。
4. 用户点击 `History` 后，主弹窗打开 `history.html` 窗口。
5. 历史页读取数组并渲染记录。点击 `Apply` 会尝试读取 `entry.command` 并发送 `APPLY_COMMAND`，但字段和消费端均未接通。

## 异常与边界条件

- 没有历史键 — 读取逻辑使用空数组作为初始值。
- 存储 JSON 损坏 — 未捕获的 `JSON.parse` 异常会中断初始化。
- 失败的 HTTP 请求、非 JSON 响应 — 不创建记录。
- 超过十条 — 写入时保留数组最前面的十条，最旧记录被丢弃。
- 缺失字段 — 模板插值会把缺失值渲染为字符串；`entry.command` 当前未由写入方提供。

## 并发与幂等

- 没有锁、事务、去重或请求幂等键。重复发送同一请求会形成多条历史记录。
- 主弹窗只在初始化时加载内存数组；并发写入没有合并策略，后写入可能覆盖较早加载的状态。
- 历史窗口只读，不会主动订阅主弹窗后续写入。

## 安全与权限

- 原始 cURL、请求头和载荷保存在扩展来源的 `localStorage`；如果请求命令含访问令牌或其他敏感值，这些值会随历史保留，直到被新记录挤出或用户清除扩展数据。
- `history.js` 将时间、URL 和结果直接插入 `innerHTML`；URL 可来自用户输入，存在 DOM 注入风险。
- “Apply”消息当前使用目标源 `'*'`；目前主弹窗没有消息监听器。
- `manifest.json` 声明 `storage` 权限，但当前代码调用的是 `localStorage`，没有调用 `chrome.storage`。

## 配置与依赖

- 存储依赖：浏览器 Web Storage API `localStorage`；没有外部存储服务。
- 页面依赖：扩展自身的 `popup/view/history.html` 与 `popup/script/history.js`。
- `history.html` 引用 `../style/history.css`，该文件不存在；清单中的 `storage` 权限未被历史代码使用。
- 不需要数据库或数据迁移；仓库未提供项目级构建和测试配置。

## 可观测性与运维

- 历史读写没有专用日志、指标或告警。
- 损坏存储产生的异常可见于浏览器扩展页面控制台。
- 仓库没有扩展升级、历史清理或部署步骤说明。

## 测试与验证

### 已执行

- 静态源码核对 — 检查写入记录、历史页读取、窗口打开与消息发送代码；确认字段不匹配、无消息消费者及缺失样式文件。
- 档案结构校验 — 分别对 `curl-request-workbench` 和 `curl-history` 运行 `feature_docs.py validate --repo . --id <feature-id> --mode structural`；两份档案均返回 `OK`。
- 实现快照校验 — 运行 `feature_docs.py validate --repo . --mode fresh`；返回 `OK all feature documents`，对应 `HEAD 562904fe8954` 和干净的实现快照。

### 未执行

- 浏览器历史窗口与恢复回归 — 仓库未提供浏览器自动化测试，本次未执行。
- 存储损坏、并发写入和敏感值生命周期测试 — 仓库没有相应测试套件，本次未执行。

## 关键决策

不适用：仓库未记录独立的历史产品决策；十条上限、写入时机和存储字段仅作为当前实现记录，不推断为长期产品约束。

## 已知问题与后续工作

### Apply 数据字段不匹配且没有消息消费者

- **影响**：历史记录使用 `curl`，按钮代码读取 `entry.command`；即使命令正确，主弹窗也没有 `APPLY_COMMAND` 消息监听器。
- **当前处理**：档案将恢复功能标为未接通，不描述为可用行为。
- **后续动作**：后续修复前需确认预期的恢复目标和窗口消息契约，再补充端到端验证。

### 历史值未经转义且页面样式缺失

- **影响**：用户可控 URL 等值写入 `innerHTML`，存在 DOM 注入风险；页面引用的样式文件不存在。
- **当前处理**：本次只记录源码事实，没有改写页面。
- **后续动作**：后续维护时应使用安全 DOM 渲染，并确认历史页样式归属。

### localStorage 解析没有恢复机制

- **影响**：存储内容损坏时 `JSON.parse` 可中断页面初始化；并发写入没有合并处理。
- **当前处理**：读取和写入按现有实现工作，没有额外恢复层。
- **后续动作**：如需增强可靠性，应定义损坏数据恢复和多窗口写入策略。

## 变更记录

### 2026-11-04 — 首次建立功能档案

- **状态**：已完成
- **变化**：新增请求历史的存储模型、窗口流程和已确认限制档案。
- **原因**：为后续维护提供可由仓库证据追溯的上下文。
- **兼容性**：仅新增文档，不修改扩展运行时、接口或本地数据。
- **验证**：静态核对历史写入方、读取方和页面入口；两份档案结构校验均返回 `OK`，实现快照校验返回 `OK all feature documents`。

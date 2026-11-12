# 请求历史

<!-- feature-id: curl-history -->
<!-- feature-title: 请求历史 -->
<!-- feature-aliases: cURL 历史, 请求记录, 请求历史恢复 -->
<!-- feature-status: active -->
<!-- feature-summary: 在本机保留最近 100 项请求终态，支持搜索、恢复、删除和旧历史迁移。 -->
<!-- last-verified: 2026-11-12 -->
<!-- code-basis: HEAD 5dbac97825c2; worktree-digest sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->

## 快速上下文

请求历史属于 cTool 2.0 的本机数据层。每个请求终态将脱敏后的请求快照与状态写入 IndexedDB，界面在 Popup 和全页工作台中提供搜索、恢复编辑、删除和清空。历史默认上限为最近 100 项；它不保存响应预览，响应原文位于独立且受限的 response store。

首次打开新版扩展时，`migrateLegacyHistory` 尝试从旧 `localStorage.curlHistory` 转换已有历史。新旧存储属于不同安装版本的扩展数据；原地升级和同 profile 加载是迁移前提。

## 目标与边界

### 目标

- 保留成功、HTTP 错误、网络错误、取消、超时和中断结果，便于本机回看和复用。
- 控制历史与响应的容量，允许通过隐私模式阻止新数据持久化。
- 在升级时迁移可识别的旧 `curlHistory` 请求模型。

### 范围内

- 最近 100 条历史；按 URL、名称、终态和错误码搜索。
- 恢复请求到编辑器、单条删除、清空全部。
- 事务内写终态，更新失败时显示存储提示。
- 从旧 `curl`/`command` 文本或旧 `data.url`、参数、头、JSON payload 记录迁移。
- 响应对象与历史分开存储，最多 10 份且保留 24 小时。

### 范围外

- 远端账户、云同步、多设备合并或服务端审计。
- 保证旧版已卸载、profile 已删除或浏览器已清理时仍可恢复旧数据。
- 将过去的原始响应正文、下载内容或文件字节加入历史导出。

### 不变量

- 单条历史记录以任务 ID 为键；`createdAt` 决定最近记录顺序。
- `stripFileAttachments` 删除本地文件路径和已选文件字节后才持久化请求。
- 历史记录只保存终态元数据，不嵌入 `previewText`、错误正文或响应体。
- 隐私模式下不写新请求历史或响应；已存在历史不会因打开隐私模式被自动删除。
- 旧数据只有 IndexedDB 导入事务完成后才记录 `legacyCurlHistoryV1` 标记；损坏数据不写标记。

## 业务行为

- 请求完成、HTTP 4xx/5xx、失败、取消和超时共用 `runRequest` 的终态路径；HTTP 状态码本身不被误判为网络失败。
- Popup 关闭不会主动丢弃后台任务；重新打开页面后通过历史或活动任务状态看到结果。
- 历史行可恢复请求；multipart 的本地路径和 bytes 已清除，恢复后重新选择文件。
- 搜索不区分大小写，覆盖请求 URL、名称、结果状态与错误码。
- 隐私模式只影响新自动持久化的草稿、历史与响应；用户明确保存的收藏仍保留。

## 架构与代码地图

- `src/shared/storage/database.js` — IndexedDB `ctool-local-v2` 的 `history`、`responses`、`meta` store。
- `src/shared/storage/repositories.js` — `addHistory`、`listHistory`、删除/清空、`completeTask`、`saveResponse` 与有界保留。
- `src/shared/storage/migrate-legacy.js` — `migrateLegacyHistory` 的旧记录解析与一次性迁移。
- `src/shared/request-executor.js` — 终态 `historyRecord`、响应 body 分离、隐私模式分支。
- `src/background/task-manager.js` — Worker 恢复时把过期活动任务写为 `interrupted`。
- `src/ui/app-controller.js` — `renderHistory`、行恢复、单项删除、搜索及清空交互。
- `tests/unit/storage.test.js`、`tests/unit/migration.test.js`、`tests/unit/task-manager.test.js` — 历史事务、上限、迁移和恢复测试。
- `tests/extension/request-compat.spec.js`、`tests/extension/ui-workflows.spec.js` — Popup 关闭后恢复和历史 UI 流程。

## API、事件与任务

### `repositories.listHistory({ search, limit })`

- 输入：可选搜索字符串和返回上限。
- 输出：按 `createdAt` 降序排序的记录列表；匹配名称、URL、状态和错误码。
- 错误：IndexedDB 事务失败时 Promise reject，由调用视图处理并提示。
- 消费者：历史视图与备份导出；删除使用 `deleteHistory(id)`，清空使用 `clearHistory()`。

### `repositories.completeTask({ taskId, historyRecord, responseRecord, now })`

- 输入：当前活动任务 ID、可选终态记录和独立响应 body。
- 输出：若任务锁仍由 `taskId` 所有返回 `true` 并一次性写入/删除；锁不匹配返回 `false`。
- 事务：共同更新 `meta`、`history`、`responses`；写入失败整体回滚。
- 消费者：`runRequest`；包含有界记录数的并发单测。

### `migrateLegacyHistory({ repositories, localStorage, now })`

- 输入：浏览器 `localStorage` 中可读的旧 `curlHistory` JSON 数组。
- 输出：`empty`、`migrated`、`corrupt` 或 `already-migrated` 及导入数量。
- 兼容：从旧 `curl` 或 `command` 字符串解析命令；旧 `data` 字段保留 URL、参数/查询、头和 JSON payload；旧响应不迁移。
- 错误：JSON 损坏或根值非数组返回 `corrupt`，不标记完成；单条无效记录略过，其余有效记录仍可迁移。

## 数据模型与迁移

- 历史：`{ id: taskId, requestId, createdAt, request, result, errorCode?, migratedFromLegacy? }`。请求通过 `stripFileAttachments` 移除文件路径和 bytes；结果持久化时剔除预览和错误消息。
- 响应：`responses` store 独立存 `{ id, receivedAt, bytes, contentType, isBinary }`；最近 10 项且 24 小时后过期。
- IndexedDB 的历史和响应由 `completeTask` 原子提交；上限清理在同一事务内进行。
- 旧 key 为扩展 localStorage `curlHistory`。旧版记录成功写入 `history` 并设置 meta 标志后才算迁移完成；对损坏 JSON 不做覆盖或清除。
- 新版备份导出历史及 request 定义，但不导出响应正文；导入为合并并生成新 ID，文件附件仍需重新选择。

## 核心流程

1. MV3 Worker 初始化打开 IndexedDB，清理遗留 DNR 规则并检查 `meta.activeTask`。
2. App 启动执行旧历史迁移；有效记录解析成规范 `RequestDraft` 并在事务里导入。
3. 请求通过唯一任务锁开始，执行后构造终态历史与独立响应记录。
4. 非隐私模式在同一 IndexedDB 事务完成记录写入、最近 100 条/10 份响应修剪和任务锁删除。
5. 历史 UI 读取、搜索或恢复请求；隐私模式对新请求跳过自动记录，但不删除旧数据。

## 异常与边界条件

- `curlHistory` JSON 损坏或根节点不是数组 — 不写迁移完成标志；保留原值并允许之后重试。
- 部分旧记录字段缺失或命令语法无效 — 跳过无效项，继续导入其余可解析记录。
- IndexedDB 事务或配额失败 — 数据库回滚；请求仍可能已到达服务器，UI 提示结果未能本机保存。
- 迁移后立即重复启动 — `legacyCurlHistoryV1` 防止再次导入同一批记录。
- 隐私模式期间请求失败或超时 — 不自动保留历史/响应；当前任务仍有运行时状态用于完成/取消。
- 响应超过 20 MiB — 作为失败终态保存错误元数据（隐私模式除外），不保存响应 bytes。

## 并发与幂等

- `completeTask` 检查 `meta.activeTask.taskId`，只有锁所有者能原子写历史并释放锁。
- IndexedDB readwrite 事务序列化对历史上限的更新；并发测试确认最近项不会因并发写入被错误裁剪。
- 迁移标志和批量记录处于同一事务，因此不会产生“标记已迁移但未写入历史”的中间态。
- 导入备份与旧版迁移由新 ID 防重复；一般历史写入以 task ID 覆盖同 ID 记录，不会重复累加。

## 安全与权限

- 记录只存浏览器本机，不云同步；请求历史可能包含 URL 和凭据，因此仍属于敏感本机数据。
- 不读取浏览器 Cookie 库；手动 Cookie 仅用于当次网络发送，不作为浏览器持久 Cookie。
- 文件 bytes 与本地路径不进入历史、备份或草稿持久化；迁移不执行历史命令。
- Service Worker 消息仅接受本扩展页面；错误、日志不写请求正文。
- 清空历史由用户在 UI 明确确认后执行；插件卸载/站点数据清理由浏览器管理。

## 配置与依赖

- `HISTORY_LIMIT = 100`、`RESPONSE_LIMIT = 10`、`RESPONSE_RETENTION_MS = 24h` 定义在 `src/shared/storage/repositories.js`。
- `privacyMode` 存在 `chrome.storage.local`；环境/收藏与隐私设置分离。
- 依赖 IndexedDB、`structuredClone`、`localStorage` 兼容读取和 `chrome.storage.local`；不依赖远端数据库或同步服务。
- 当前 schema 使用 `DATABASE_NAME = "ctool-local-v2"`、IndexedDB version 1；未来增 store 需推进数据库版本迁移。

## 可观测性与运维

- 历史 UI 显示任务状态、时间、状态码与错误说明；不会显示或渲染响应 HTML。
- 超限、忙碌和 IndexedDB 错误作为界面内联消息反馈；没有遥测、后台服务或运维告警。
- 原地升级要求保留原扩展数据和同一浏览器 profile；卸载旧扩展、清理站点数据或换 profile 会使旧 localStorage 不可见。

## 测试与验证

### 已执行

- `npm test` — 43 项通过；包括最近 100 条上限、并发写入、事务回滚、quota 错误、损坏和原始旧格式迁移、恢复中断。
- `npm run test:extension` — 16 项通过；Popup 关闭后请求完成并可在重新打开界面后在历史中找到，隐私模式和恢复 UI 通过。
- `npm run check` — 类型检查、ESLint、单元、扩展 E2E 与 ZIP 白名单检查全部通过。

### 未执行

- 原有已安装用户的 Chrome/Edge profile 升级回归 — 未在真实安装的扩展 profile 运行；自动化使用 Playwright 配套 Chromium。剩余风险是各品牌 profile 的旧数据访问与扩展安装行为。

## 关键决策

### DEC-001 — 历史与响应正文分开存储

- **决定**：历史保存终态和请求，不把大响应正文塞入历史；响应 store 单独限容。
- **原因**：历史搜索轻量、容量可控，同时提供短期原文下载。
- **取舍**：响应原文过期后仍保留历史终态，但不再能下载旧 body。
- **证据**：`src/shared/request-executor.js`、`src/shared/storage/repositories.js` 和 response retention 测试。

### DEC-002 — 旧历史只在事务完成后标记

- **决定**：迁移记录和 `legacyCurlHistoryV1` meta 在单个 IndexedDB 事务写入。
- **原因**：保护已有历史，不留下错误的迁移完成状态。
- **取舍**：损坏的旧内容留在旧 localStorage 中等待修复，不自动清除。
- **证据**：`src/shared/storage/migrate-legacy.js`、`tests/unit/migration.test.js`。

## 已知问题与后续工作

### 品牌浏览器升级尚未实测

- **影响**：自动化测试不能证明 Chrome/Edge 真实 profile 的升级数据读取行为。
- **当前处理**：实现按原扩展 localStorage 结构迁移；单测覆盖旧 `data.parameters`、对象形式 headers 和 JSON payload。
- **后续动作**：在保有旧版本数据的测试 profile 原地升级，确认迁移条数和重复启动不重复导入。

### 历史记录仍包含用户请求信息

- **影响**：未开启隐私模式时，URL、头和请求内容可能包含秘密。
- **当前处理**：本机存储、不云同步；提供隐私模式与用户主动清空；备份提醒数据敏感。
- **后续动作**：维护文档中继续明确数据保留和卸载行为，用户应自行删除敏感历史。

## 变更记录

### 2026-11-12 — 从 localStorage 历史升级为 IndexedDB

- **状态**：部分完成
- **变化**：历史限 100 条，分离短期响应，事务写入终态，增加搜索/删除/恢复/隐私开关及旧数据迁移。
- **原因**：为本机优先工作流提供稳定管理和升级兼容。
- **兼容性**：尽力迁移旧 `curlHistory`；保留 `popup/view/popup.html` 入口；恢复历史中的 multipart 需重选文件。
- **验证**：`npm test`、`npm run test:extension` 与 `npm run check` 通过；实际 profile 回归仍待执行。

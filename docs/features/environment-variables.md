# 环境变量

<!-- feature-id: environment-variables -->
<!-- feature-title: 环境变量 -->
<!-- feature-aliases: 请求环境变量, 全局与环境变量 -->
<!-- feature-status: active -->
<!-- feature-summary: 使用本机全局变量和所选环境变量替换请求中的 {{name}} 占位符。 -->
<!-- last-verified: 2026-11-12 -->
<!-- code-basis: HEAD 5dbac97825c2; worktree-digest sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->

## 快速上下文

环境变量供请求模型引用 `{{name}}`，全局变量可跨环境复用，所选环境对同名变量具有更高优先级。变量在请求发送前由 `resolveEnvironment` 复制并替换，不会改写编辑器中的原请求；替换仅一轮，缺少变量会阻止发送。

变量存储在扩展的 IndexedDB 本机数据库，不同步到云端。标记 `secret` 的值在环境编辑器中以密码字段显示，默认不导出到备份；本地 IndexedDB 值没有应用层加密。

## 目标与边界

### 目标

- 在请求中安全复用 host、token、路径等值，避免为不同目标修改同一份请求。
- 为每个请求选择一个环境；由选中环境覆盖同名全局变量。
- 明确提示未定义的变量，并避免递归展开造成不可预测结果。

### 范围内

- 管理全局变量与命名环境；每条变量包含名称、字符串值和可选 `secret` 标志。
- 在 URL、启用的查询/请求头、Basic/Bearer 凭据、实际正文和启用的表单字段中替换占位符。
- 请求发送前等待当前环境编辑保存，再读取 IndexedDB 中的最新值；未启用或不参与发送的行不触发缺失变量错误。
- 设置页创建、重命名、删除环境；切换当前环境并在选择器中应用到请求。
- 备份默认不导出 secret；用户明确勾选后可包含全局及环境 secret。

### 范围外

- Shell 环境变量、`$NAME` 语法、模板函数、转义占位符、递归变量、类型化变量或加密密钥库。
- 自动注入浏览器登录 Cookie、从网页读取变量或向外部服务同步。
- 变量版本历史、环境间继承、多环境同时合并或请求级临时秘密输入框。

### 不变量

- 名称采用 `[A-Za-z_][\w.-]*`；未匹配此语法的字符串不作为占位符。
- 请求级环境变量优先于全局同名值；全局变量中后出现的重复名覆盖前值。
- 替换基于原始请求副本，每个占位符只解析一次；变量值内部的 `{{...}}` 不再递归展开。
- 缺失名称去重后一次报告；发送不会把未替换占位符发给目标服务器。
- `secret` 仅控制界面遮蔽和备份筛选，不代表本机加密。

## 业务行为

- 请求编辑器选择环境后，`draft.environmentId` 记录选择；默认设置 `selectedEnvironmentId` 在新请求时作为选择来源。
- `resolveEnvironment` 合并全局变量和选中环境变量；后者覆盖全局同名值。
- 页面中的变量输入以短延迟自动保存；点击发送或增删变量时会先冲刷待保存更改，防止请求使用旧变量值。
- secret 值采用密码输入框；导出对话框默认不勾选“包含 secret 变量”。
- 当 URL 或启用/实际发送字段含未定义占位符时，执行被阻止并列出缺失名称；修正后用户可重新发送。

## 架构与代码地图

- `src/shared/environment.js` — `resolveEnvironment` 的优先级、占位符替换和缺失值收集。
- `src/shared/request-executor.js` — `runRequest` 执行前解析环境；缺失变量映射到请求准备错误。
- `src/shared/storage/repositories.js` — `getGlobalVariables`、`saveGlobalVariables`、环境 `getEnvironment`、`saveEnvironment`、`listEnvironments`、`deleteEnvironment`。
- `src/shared/storage/settings.js` — `selectedEnvironmentId` 默认值和本机设置持久化。
- `src/shared/storage/backup.js` — `buildBackup` 默认过滤 secret、`previewBackup` 校验备份、导入时保留变量配置并分配新 ID。
- `src/ui/app-controller.js` — `renderEnvironments`、`persistVariables`、发送前冲刷保存、错误提示与选中环境 UI。
- `tests/unit/environment.test.js` — 环境覆盖、单轮替换及缺失变量；`tests/extension/ui-workflows.spec.js` — 未知变量阻止发送和正确值请求。

## API、事件与任务

### `resolveEnvironment(draft, globals, environment)`

- 输入：规范请求 draft、可选全局 `{ name, value, secret? }[]` 和 `{ variables }` 环境。
- 输出：`{ draft, missing }`；`draft` 为 `structuredClone`，`missing` 为去重后的名称数组。
- 替换位置：URL、启用的查询/头、Basic/Bearer 认证、实际正文与启用的表单字段；disabled 行和 inactive body 不参与缺失检查。
- 错误：函数本身不抛缺失变量错误；调用方必须检查 `missing`。`runRequest` 对缺失项抛 `MISSING_ENVIRONMENT_VARIABLE`，UI 在网络请求前提示。
- 消费者：`src/ui/app-controller.js` 的预检与 `src/shared/request-executor.js` 的最终执行校验。

### `repositories.getGlobalVariables()` / `saveGlobalVariables(variables)`

- 输入：变量对象数组；每项可带 ID、名称、字符串值和 secret 标志。
- 输出：本机读写 Promise；环境通过对应 `saveEnvironment` 操作保存变量数组。
- 事务：全局变量放入 `meta.globalVariables`；环境作为 `environments` store 记录。
- 消费者：环境设置页、发送时的变量合并和备份导出。

## 数据模型与迁移

- `EnvironmentVariable = { id?, name, value, secret? }`；环境记录包含 `{ id, name, variables, updatedAt }`。
- 全局变量存于 IndexedDB `meta` store 的 `globalVariables` 项；环境存在 `environments` object store。
- `Settings.selectedEnvironmentId` 存在 `chrome.storage.local`；具体请求仍可把环境 ID 写入 draft。
- 数据库 `ctool-local-v2` 当前 version 1 直接创建这些 store；旧版原型没有同类变量模型，`curlHistory` 迁移不生成环境。
- JSON 备份包含 `globalVariables` 与每个 `environments[].variables`；导入预览先校验结构，合并时分配新变量/环境 ID 并重映射请求所引用的环境。

## 核心流程

1. 页面读取 globalVariables、环境对象和本地设置，渲染选择器与变量表。
2. 用户编辑值或 secret 标志；编辑器安排短延迟保存，明确操作也会等待已排队的写入。
3. 发送时同步当前请求表单，等待变量写入完成，再读取所选环境和全局变量。
4. `resolveEnvironment` 按全局→环境覆盖顺序生成执行副本并收集缺失名称。
5. 缺失项存在时返回内联错误；否则校验已解析 URL/头/认证并交给请求执行器。
6. 备份导出默认排除 secret；备份导入先预览，用户确认后以合并方式事务写入。

## 异常与边界条件

- 同名环境变量 — 环境值覆盖全局值；同一范围重复名称按数组中后写项生效。
- 变量缺失 — 发送前阻止并展示名称；请求编辑状态仍保留占位符供修复。
- 单轮替换后的结果仍含 `{{name}}` — 不继续解析，避免递归或循环展开。
- 用户快速编辑后立即发送 — 发送先冲刷排队保存；存储失败时界面显示错误并停止发送。
- 名称含空格或不符合占位符语法 — 不匹配占位符，不做模糊替换。
- 导出默认排除 secret — 用户如选择完整导出，下载 JSON 会含敏感值，须自行保管。

## 并发与幂等

- 编辑自动保存通过单一页面定时器和串行 Promise 排队，发送/删行/增行时清理 debounce 并等待最新提交。
- IndexedDB 更新变量和环境使用事务；请求执行读取一致的已存值副本。
- 全局变量重复保存按 meta key 覆盖；环境保存按环境 ID 更新，不创建隐式副本。
- 多个窗口同时编辑同一变量时最后完成的持久化写入胜出；不提供跨窗口编辑锁或冲突合并。

## 安全与权限

- 变量只写本机 IndexedDB，没有云同步。扩展读取自身 origin 的数据库，不读取浏览器 Cookie 或其他网站存储。
- `secret` 输入框遮蔽可见文字并控制 JSON 导出；它不加密 IndexedDB，也不加密用户选择完整导出的文件。
- 变量值可能进入请求 URL、头、认证、正文和历史记录；用户应把不可信导出视为含秘密数据。
- 变量渲染使用 input value 和文本内容，不把值拼入 HTML。发送采用扩展自有消息和本机目标模型。

## 配置与依赖

- 占位符格式固定为 `{{name}}`；环境默认优先级为所选环境高于 globalVariables。
- `privacyMode` 只抑制新草稿、历史和响应的自动持久化；用户显式管理的环境仍写入本机数据库。
- 依赖 `structuredClone`、IndexedDB、`chrome.storage.local` 和浏览器扩展内置请求执行器；无需 `.env` 文件或服务端秘密管理器。
- 新增变量或环境字段需同步备份 schema 校验和数据库数据转换；当前备份 schema 为 1。

## 可观测性与运维

- 缺失变量、IndexedDB 失败与配额错误通过界面内联消息显示，不记录变量值或请求正文到日志。
- 备份为用户主动下载；secret 默认排除，完整导出选择会影响备份敏感度。
- 浏览器 profile 清理或扩展卸载可能删除本机数据库；建议在切换环境/安装前导出需要保留的配置。

## 测试与验证

### 已执行

- `npm test` — 43 项通过；`tests/unit/environment.test.js` 验证环境覆盖、非递归替换、缺失名称及禁用字段不阻塞发送。
- `npm run test:extension` — 16 项通过；`tests/extension/ui-workflows.spec.js` 在不等待 debounce 的情况下立即发送最新环境值，并验证缺失变量阻止请求。
- `npm run check` — JSDoc 类型检查、ESLint、单元、扩展 E2E 与包内容检查全部通过。

### 未执行

- Chrome/Edge stable 已安装 profile 的人工变量 UI 回归 — 未执行；当前只在 Playwright 配套 Chromium 验证，稳定版品牌浏览器的安装和 UI 行为待单独检查。

## 关键决策

### DEC-001 — 单次替换且环境覆盖全局

- **决定**：先建全局变量表，再覆盖选中环境变量；只替换原始请求一轮。
- **原因**：令同一请求在多个目标环境间切换且避免变量循环。
- **取舍**：不支持变量值再引用另一个变量，也不支持模板函数。
- **证据**：`src/shared/environment.js` 与 `tests/unit/environment.test.js`。

### DEC-002 — secret 标签只负责遮蔽和导出过滤

- **决定**：secret 值用密码控件显示，默认排除备份；不宣称本机加密。
- **原因**：本插件的持久层是浏览器本机 IndexedDB。
- **取舍**：本机 profile 访问者仍可读取值；完整备份显式包含秘密后由用户保护。
- **证据**：`src/ui/app-controller.js`、`src/shared/storage/backup.js` 与隐私说明。

## 已知问题与后续工作

### 多窗口编辑不合并

- **影响**：两个扩展页面同时编辑同一环境时，后保存的整条记录会覆盖先保存的值。
- **当前处理**：单个页面的编辑保存串行化；数据库事务保证每次写入原子。
- **后续动作**：若需要真正多窗口协作，再引入版本号或乐观并发冲突提示。

### 本地秘密未加密

- **影响**：拥有本机浏览器 profile 访问权限的使用者可取得数据库和备份中的明文。
- **当前处理**：不云同步，secret UI 遮蔽并在默认导出中排除；隐私说明解释本地存储边界。
- **后续动作**：如需密码保护，另行定义密钥生命周期与恢复方案后再实施。

## 变更记录

### 2026-11-12 — 增加本机环境变量

- **状态**：部分完成
- **变化**：增加 global/environment 变量、一次替换、环境覆盖、缺失校验、secret 遮蔽与备份过滤；发送会冲刷待保存变量。
- **原因**：让请求能在开发、测试等环境间安全复用。
- **兼容性**：原有请求未设置 environmentId 时仅用全局变量；旧历史迁移不自动生成环境。
- **验证**：43 项单测、16 项扩展 E2E、`npm run check` 通过；实际品牌浏览器 UI 回归待执行。

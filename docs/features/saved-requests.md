# 已保存请求与收藏

<!-- feature-id: saved-requests -->
<!-- feature-title: 已保存请求与收藏 -->
<!-- feature-aliases: 收藏请求, 请求收藏, 已保存草稿 -->
<!-- feature-status: active -->
<!-- feature-summary: 自动保存当前草稿，并允许用户显式命名、编辑、载入和删除收藏请求。 -->
<!-- last-verified: 2026-11-12 -->
<!-- code-basis: HEAD 5dbac97825c2; worktree-digest sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->

## 快速上下文

保存请求提供两个本机复用入口：`drafts` store 自动暂存当前编辑请求，`favorites` store 保存用户显式命名的请求快照。Popup 和全页工作台共享 IndexedDB 和同一 controller；用户可打开草稿列表恢复当前编辑，或通过收藏列表命名、编辑、重命名、载入和删除请求。

数据不云同步。隐私模式停用新的自动草稿保存，但保留用户明确保存的收藏。multipart 文件内容和本机路径在保存前剥离，恢复后重新选择文件。

## 目标与边界

### 目标

- 自动保存当前请求编辑状态，避免关闭 Popup 或切换面板后丢失草稿。
- 允许对稳定请求建立命名收藏，供后续编辑或直接载入。
- 通过受校验的 JSON 备份迁移草稿、收藏、历史及环境变量。

### 范围内

- 180 ms debounce 保存当前请求到 `drafts/current`；打开草稿对话框查看和载入可用记录。
- 通过保存对话框给当前请求命名并显式创建收藏。
- 编辑收藏请求、单独重命名收藏、载入或删除收藏。
- 隐私模式下停止新自动草稿持久化，允许明确保存的收藏继续写入。
- 使用备份预览校验后合并导入，并生成新 ID；multipart 附件信息不含本地路径和 bytes。

### 范围外

- 多人共享、云端同步、版本历史、收藏文件夹或差异合并。
- 隐私模式清除既有草稿或收藏、按时间自动清理用户创建的收藏。
- 备份写入加密容器或自动上传远端。

### 不变量

- 默认草稿使用固定 ID `current`，代表此扩展 profile 的当前编辑请求，不创建无限自动版本。
- 收藏只有在用户点击保存并确认名称后创建；隐私模式不阻止显式收藏。
- 保存、历史或备份中的请求先运行 `stripFileAttachments`，不携带 `fileData` 和 `filePathHint`。
- 导入前必须通过 `previewBackup`；导入走原子事务，并为请求、收藏、环境生成新 ID。
- 默认备份不包含标记为 secret 的环境变量；请求中的 header/auth 内容仍可能含凭据。

## 业务行为

- 请求表单编辑时同步规范 draft，安排自动保存；隐私模式启用后，尚未触发的保存回调再次检查设置并退出。
- 草稿列表读取 IndexedDB `drafts`；从备份导入的多份草稿可逐项载入，当前编辑请求持续保存在 `current`。
- 收藏创建时要求非空名称，并保存 `stripFileAttachments(syncFromForm())` 的快照。
- 收藏的“编辑”载入请求并打开名称对话框；确认时更新收藏名与请求内容。单独“重命名”只更新名称。
- 删除收藏前通过浏览器确认；载入历史/收藏/草稿会将请求恢复到请求面板。
- 备份导入先展示 collection 数量和校验错误，确认后才合并到本地数据库。

## 架构与代码地图

- `src/shared/storage/database.js` — `drafts`、`favorites`、`environments`、`history` 等 IndexedDB object store。
- `src/shared/storage/repositories.js` — `saveDraft`、`getDraft`、`listDrafts`、`deleteDraft`、`saveFavorite`、`listFavorites`、`deleteFavorite`、`mergeBackup`。
- `src/shared/request-model.js` — `stripFileAttachments` 删除文件本地信息。
- `src/shared/storage/settings.js` — `shouldPersist(settings, "draft")` 隐私模式规则；收藏为显式写入。
- `src/shared/storage/backup.js` — schema version 1、10 MiB 校验、secret/文件过滤、预览和事务导入。
- `src/ui/app-controller.js` — `scheduleDraftSave`、草稿列表、收藏行、收藏编辑/重命名/删除和备份确认流程。
- `tests/unit/storage.test.js`、`tests/unit/backup.test.js` — repository CRUD、事务失败、ID remap 和附件过滤。
- `tests/extension/ui-workflows.spec.js` — 草稿恢复、收藏增改、隐私模式和备份导入后载入草稿。

## API、事件与任务

### `repositories.saveDraft(draft)` / `listDrafts()`

- 输入：规范请求对象；自动暂存以固定 ID `current` 写入。
- 输出：保存记录含 `updatedAt`；列表按记录时间降序返回。
- 错误：IndexedDB 配额或事务错误回到 UI 内联存储提示。
- 消费者：debounce 自动保存、重启后加载、草稿选择对话框和备份导入。

### `repositories.saveFavorite(favorite)` / `listFavorites()`

- 输入：`{ id, name, request }`；新建 ID 由页面生成，编辑沿用目标收藏 ID。
- 输出：保存记录带 `savedAt` 和 `updatedAt`；列表按名称排序。
- 错误：IndexedDB 写入失败时显示本机存储错误；用户需再次保存。
- 消费者：收藏面板、确认对话框、收藏恢复和备份导出。

### `previewBackup(source)` / `importBackup(preview, repositories)`

- 输入：JSON 文本或对象；导入必须先传成功预览。
- 输出：校验有效性、错误与各 collection 数量；导入返回新建数量。
- 错误：非 JSON、错误产品标记、未知版本、字段类型错误、单 collection 超 1,000 条或文件超过 10 MiB 都会拒绝导入。
- 消费者：设置页先预览，再由用户按“合并”确认；导入事务失败时现有数据库保持不变。

## 数据模型与迁移

- 草稿：当前编辑 `RequestDraft` 存在 `drafts`，默认记录 ID 为 `current`；备份导入的草稿具有新随机 ID。
- 收藏：`{ id, name, request, savedAt, updatedAt }`，请求保留方法、参数、头、认证、正文、重定向、timeout 和 environmentId。
- 文件字段的可复用 metadata 可以保留 fileName/fileType/isFile，但本地路径和字节不会持久化；恢复必须重新选文件。
- 备份根对象为 `{ product: "cTool", schemaVersion: 1, exportedAt, drafts, history, favorites, environments, globalVariables }`；响应 body 不导出。
- merge 事务为导入对象生成新 ID；environmentId 指向本次导入的环境映射，防止覆盖已有收藏/草稿；历史仍裁剪至 100 条。
- 旧版 `curlHistory` 迁移不自动创建收藏；它只属于 `curl-history` 档案中的历史流程。

## 核心流程

1. App 启动加载 `drafts/current`；若不存在则建立默认 RequestDraft。
2. 用户编辑时同步表单并触发保存定时器；隐私模式在调度和执行时均阻止自动持久化。
3. 用户显式保存收藏时输入名称，确认后以新 ID 或现有收藏 ID 保存请求快照。
4. 用户导入备份时，文件先过大小/schema/字段校验并显示预览。
5. 用户确认合并后，IndexedDB transaction 分配 ID、重映射环境并写入对象；失败回滚，不留下部分导入。
6. 用户从列表载入请求，controller 重建 `RequestDraft` 并渲染表单；文件需要再次选择后才能发送。

## 异常与边界条件

- 隐私模式打开时修改请求 — 自动保存跳过；显式收藏按钮仍可保存。
- 关闭弹窗时 180 ms 草稿 timer 尚未执行 — 当前未提供持久化刷新卸载保证；Popup 关闭后应以新打开页面加载最近一次已写入草稿。
- 附件恢复后没有新选择文件 — `prepareFetchRequest` 返回 `FILE_REQUIRED` 并阻止发送。
- 收藏名称为空 — 保存对话框保留打开并聚焦名称输入。
- 恶意 HTML 请求/备份文本 — 经 `textContent` 或表单 value 渲染，不作为 HTML 注入。
- 导入对象字段错或过大 — 在事务开始前拒绝；有效导入失败由 IndexedDB 事务整体回滚。

## 并发与幂等

- `drafts/current` 是单一自动保存槽；快速修改通过 debounce 合并写入，不创建逐键历史。
- 收藏写入通过主键 ID 更新；新收藏 UUID，编辑只覆盖相同 ID。
- 导入对象都生成新 ID，因此重复导入会形成副本；当前导入不是内容去重或幂等导入。
- IndexedDB 单事务合并所有 collection 及环境映射；多窗口更新同一草稿为最后完成者覆盖，没有跨窗口编辑锁。

## 安全与权限

- 草稿和收藏本机存储，不使用云端账户或 `chrome.storage.sync`；隐私说明记录权限和数据范围。
- 请求 header、auth 和 URL 可能含秘密；收藏与请求备份会保留这些字段，用户应视为敏感本机数据。
- 默认忽略 secret variable 值；勾选完整导出会将秘密写入用户下载的 JSON。
- 文件系统路径和选定文件字节不进入持久草稿、收藏、历史或导出。
- 备份导入只解析 JSON 数据，不执行代码；UI 使用 DOM 文本属性显示外部数据。

## 配置与依赖

- `privacyMode` 是 `chrome.storage.local` 设置；关闭时草稿自动保存，开启时仅停止新草稿与历史/响应持久化。
- `BACKUP_SCHEMA_VERSION = 1`；文件大小限制为 10 MiB，每个 collection 限 1,000 条。
- 依赖 IndexedDB、`structuredClone`、浏览器 Blob 下载与 File API；无需服务端或账号。
- 版本升级需评估 RequestDraft 和备份 schema；文件附件不迁移本机字节。

## 可观测性与运维

- 读写失败显示本地存储消息；没有收藏/草稿云同步或服务端恢复机制。
- 在卸载旧扩展或清理 profile 前，用户可导出 backup；删除收藏和导入合并是可见用户操作。
- `npm run package:check` 验证扩展白名单包，不包含 `tests/`、`node_modules` 和本地开发夹具。

## 测试与验证

### 已执行

- `npm test` — 当前 43 项单测通过；备份校验、transaction rollback、secret 默认筛选和本地文件过滤有覆盖。
- `npm run test:extension` — 16 项通过；验证草稿恢复、收藏编辑、隐私模式显式收藏和备份预览/合并后草稿恢复。
- `npm run check` — 类型检查、lint、43 项单测、16 项扩展 E2E 与包检查全部通过。

### 未执行

- Chrome/Edge stable 已安装扩展 profile 的真实备份/升级 UI 检查 — 未执行；自动化只用 Playwright 配套 Chromium，品牌浏览器实际安装流程需手动完成。

## 关键决策

### DEC-001 — 当前草稿与显式收藏分离

- **决定**：一个自动保存 current draft，并用用户显式收藏保存长期请求。
- **原因**：草稿是可变编辑状态，收藏是用户选择保留的命名对象。
- **取舍**：不保留自动草稿历史；显式收藏不受隐私模式自动保存限制。
- **证据**：`src/ui/app-controller.js`、`src/shared/storage/settings.js` 与 UI workflows。

### DEC-002 — 导入默认合并并生成新 ID

- **决定**：先校验和预览，确认后原子合并并重建所有对象 ID。
- **原因**：不覆盖当前请求/收藏且保留其环境引用。
- **取舍**：重复导入产生新副本，需要用户手动删除重复项。
- **证据**：`src/shared/storage/backup.js`、`repositories.mergeBackup` 和 `tests/unit/backup.test.js`。

## 已知问题与后续工作

### 自动草稿由短 debounce 写入

- **影响**：Popup 在 180 ms 写入窗口内突然关闭可能丢失最后一次草稿输入。
- **当前处理**：普通输入在短延迟后保存；退出/恢复不执行任何网络重发。
- **后续动作**：如要保证每个字符都刷新落盘，可改用更密集保存或后台持久化队列并增加关闭窗口测试。

### 备份重复导入不去重

- **影响**：同一文件反复合并会产生多份新 ID 的对象。
- **当前处理**：导入页面显示数量并明确作为“合并”操作。
- **后续动作**：若用户需要幂等恢复，再定义稳定内容键和冲突策略。

## 变更记录

### 2026-11-12 — 加入草稿、收藏与备份工作流

- **状态**：部分完成
- **变化**：自动保存当前草稿、显式收藏 CRUD、隐私模式例外、版本化备份预览与新 ID 合并。
- **原因**：为常用请求建立本机复用及迁移能力。
- **兼容性**：旧历史迁移到 history 而非 favorites；导入的文件字段需重新选择附件。
- **验证**：`npm test` 与 `npm run test:extension` 已通过；当前最新 check 结果见 Work Item。

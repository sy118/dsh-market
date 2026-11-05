# Design: 交付骨架

## Context

现有插件是一个单用户、文件驱动的 DSH Web 插件：`workbench.json` 保存全部结构化记录，Markdown 保存正文；宿主通过 `ctx.connection.fetch` 暴露同源接口，客户端用 `ctx.slots` 挂载一个面板。这个结构适合本地工作台，但没有项目组合、阶段合同、资料、任务和文档版本。

本设计只为增量 1 服务；动机与范围见 `proposal.md`，行为契约见 `specs/fde-workbench-{shell,records}/spec.md`。参考实现的职责划分见两个上游仓库，但本设计不复用其服务端基础设施。

## Goals / Non-Goals

**Goals:**

- 把 v1 的“项目 + 八阶段”升级为可审计的交付合同：固定工作项、固定产物、派生评审状态、人工决定、返回重评。
- 增加项目组合、项目首页、任务、资料库、文档版本和项目工作区导航，同时保留现有调研、机会、会议与 AI 能力。
- v1 数据无损迁移到 v2，迁移可重复执行，失败可回滚。
- 全部新行为可被宿主单测、客户端单测和 GUI 冒烟测试验证。

**Non-Goals:**

- 不做增量 2 的调研对象树/动态表单/方案设计，不做增量 3 的验证/试点/验收合同，不做增量 4 的项目多会话/Skills/实验室。
- 不做多用户、RBAC、MySQL/Redis、对象存储、病毒扫描、DOCX/Office 解析、PTY 预览代理。
- 不把阶段推进、证据通过或验收委托给 Agent；Agent 只产生候选内容。

## Decisions

### D1. 数据布局：索引 + 每项目 `.fde` 目录

保留 `workbench.json` 作为跨项目的轻量索引，项目级数据写入 `projects/<id>/`：

```text
<root>/
  workbench.json                    # schemaVersion 2、项目索引、机会、会议、调研索引
  projects/<id>/
    project.md                      # 业务背景/目标
    stages/<n>.md                   # 阶段备注（沿用 v1 路径）
    .fde/
      stages/<stage>.json           # 工作项状态、阻塞、决定、返回审计
      tasks.json                    # 项目任务与依赖
      sources.json                  # 资料元数据与版本
      documents.json                # 文档元数据与版本指针
    fde-deliverables/0N-*/          # 固定阶段产物
    sources/<sourceId>/<version>/   # 资料原件
    documents/<docId>/vN.md         # 文档版本正文
```

理由：单文件在项目、任务、资料增长后会变成高频冲突点；每项目目录也符合 agent 直接读写工作区文件的习惯。备选是继续单 `workbench.json`（拒绝：冲突与体积）或 SQLite（拒绝：引入二进制存储、agent 不可读、发布包更重）。

`workbench.json` 保留全局 `revision` 与项目摘要（名称、企业、负责人、起止日期、状态、当前阶段、交付时间）。项目级文件不单独维护 revision；一次 mutation 仍按全局 revision 做 CAS，由宿主串行写入。Agent 直接改文件时，界面通过重新读取发现，不保证与 UI 并发写入的合并。

### D2. 阶段定义集中在一个共享模块

在 `src/shared/stages.js` 定义 8 个阶段的 id、标题、问题、4 个工作项、3 份必需产物（第一阶段另有一个可选产物）和固定相对路径。宿主与客户端共用同一份定义，避免“界面说有、宿主不认”。

阶段产物路径固定，客户端只提交 `stage` + `artifactId`，宿主从定义解析路径；不接受任意路径。产物正文是 Markdown，单文件上限沿用 `limits.fileBytes`（默认 512 KiB）。

| 阶段 | 4 个工作项 | 3 份必需产物 |
| --- | --- | --- |
| 1 发现高价值问题 | 收集原始材料；还原真实工作；核对问题价值与基线；形成阶段结论 | `fde-deliverables/01-discovery/discovery-report.md`、`confirmation-checklist.md`、`problem-baseline.md`（可选 `engagement-reframe.md`） |
| 2 定义结果、范围与责任 | 建立当前基线；明确成功标准；划定范围与非目标；确认责任人与节奏 | `02-definition/outcome-contract.md`、`value-case.md`、`delivery-plan.md` |
| 3 调查现场条件 | 检查数据条件；梳理系统与接口；核对权限与安全；确认现场责任人 | `03-investigation/data-readiness.md`、`system-access-map.md`、`governance-review.md` |
| 4 设计方案与纵向切片 | 选择实现方式；明确系统边界；验证最小端到端流程；记录方案取舍 | `04-design/mechanism-selection.md`、`solution-design.md`、`vertical-slice-record.md` |
| 5 运行 PoC 与 Eval | 制定验证计划；准备测试案例；运行 PoC/Eval；形成验证结论 | `05-evaluation/evaluation-plan.md`、`evaluation-report.md`、`evaluation-baseline.md` |
| 6 集成、可靠性与受控试点 | 完成企业集成；补齐可靠性；确认试点准备；运行受控试点 | `06-pilot/pilot-scope.md`、`pilot-runbook.md`、`pilot-report.md` |
| 7 生产、采用与验收交接 | 审查生产就绪；受控进入生产；推动采用与验收；完成责任交接 | `07-production/production-review.md`、`customer-acceptance.md`、`handover-record.md` |
| 8 持续改进与沉淀 | 汇总生产证据；选择改进事项；验证并受控发布；沉淀可复用能力 | `08-improvement/field-learning-register.md`、`improvement-record.md`、`controlled-release-record.md` |

产物标题与路径采用业务语义命名，正文模板由我们自己编写；不复制参考仓库的 Skill 正文、案例或文档内容。

### D3. 阶段状态与评审阻断项由宿主派生

每个阶段的 `status` 不落盘，读取时按以下顺序计算：

1. 存在未解决的 `high` 或 `critical` 阻塞 → `blocked`。
2. 4 个工作项全部完成、3 份必需产物均为 `present` → `review-ready`。
3. 其他 → `working`。

`reviewBlockers` 返回具体原因：缺失产物（含固定路径）、未完成工作项、未解决阻塞、产物读取错误。用户不能直接设置 `review-ready`；Agent 创建文件只会改变产物的 `present/missing`，不会改变阶段。

产物 `present` 的判定是“文件存在、是普通文件、位于项目目录内、内容去空白后非空”。只检查结构与可读性，不判断业务质量。

### D4. 四类决定与返回重评

决定记录包含 `id`、`outcome`（`go` / `revise` / `narrow` / `stop`）、`rationale`、`decidedBy`、`decidedAt`、`fromStage`、`toStage`、`evidenceDigest`、`revision`。

- **Go**：仅 `review-ready` 可用；推进一格；第八阶段 Go 把项目置为 `completed` 并写 `deliveredAt`。
- **Revise / Narrow**：留在本阶段；记录理由，不改变任何产物或证据。
- **Stop**：项目置为 `stopped`；后续 Go/返回被拒绝，记录只读。
- **返回**：仅 active 项目、当前阶段 > 1；只能退一格；必须填原因；追加 `returns` 记录并把 `reconfirmThrough` 设为原阶段；产物、证据、决定全部保留。Go 推进到超过 `reconfirmThrough` 时清除该标记，否则保持“需重新确认”。

`evidenceDigest` 是当前阶段 3 份必需产物内容的 SHA-256 聚合（按产物 id 排序）。产物变化后旧决定的摘要不再匹配，UI 显示“决定基于旧版本”，但不阻止新决定；这保留审计而不制造锁死。

### D5. 资料库：本地文件 + 元数据索引

资料上传走 `POST /source`，请求体为 JSON `{ name, mime, dataBase64 }`。为容纳 25 MiB 文件，单独提供 `limits.sourceBytes`（默认 25 MiB）和 `limits.sourceRequestBytes`（默认 40 MiB）；其他请求仍用 1 MiB。

- 文件写入 `projects/<id>/sources/<sourceId>/<version>/<sanitized-name>`，元数据写 `.fde/sources.json`。
- 元数据含 `id`、`name`、`mime`、`bytes`、`sha256`、`version`、`path`、`createdAt`、`replacedAt`。
- 同名替换生成新版本，旧版本保留；删除前扫描阶段证据与产物的 `sourceId` 引用，有引用返回 409。
- 预览只对 `text/*`、`application/json`、`text/markdown`、`text/csv` 返回前 256 KiB；其他类型返回元数据与下载地址。
- 路径必须经 `resolveInside` + realpath 校验，拒绝符号链接逃逸。

不引入 ClamAV/OSS；大小、哈希、路径与类型检查是本地等价的安全边界。

### D6. 任务与依赖

任务存 `.fde/tasks.json`，字段：`id`、`title`、`status`（`todo`/`in_progress`/`blocked`/`done`/`cancelled`）、`priority`、`owner`、`startDate`、`dueDate`、`progress`、`dependencyIds`、`blockedReason`、`createdAt`、`updatedAt`。

校验：依赖必须在同项目、不能自依赖、DFS 检测环；置为 `done` 前所有依赖必须 `done`；`blocked` 要求非空原因。任务中心由客户端从已加载项目聚合，宿主不再提供单独列表接口，避免两套分页语义。

甘特图在增量 1 只做只读时间条与依赖连线；拖拽改期留给后续增量。任务编辑以列表/看板为主。

### D7. 文档版本

文档元数据存 `.fde/documents.json`，正文存 `projects/<id>/documents/<docId>/vN.md`；无项目关联的文档保留在根 `documents/<docId>/`（兼容旧全局文档）。

- 每次保存正文生成 `vN+1`，不覆盖旧文件；`documents.json` 记录 `currentVersion` 与版本列表（版本号、文件、createdAt、source）。
- 状态：`draft` → `review` → `approved` → `archived`；`archived` 只读。
- 恢复旧版本不删除历史，而是写入一个内容相同的新版本，`source: 'restore'`。
- 阶段证据可以引用文档 id；删除被引用文档返回 409。

### D8. 状态接口仍返回完整快照

增量 1 保留 `/state` 返回完整项目数据的形状，客户端 store 与 mutation 逻辑改动最小；新增字段随项目一起返回。为避免无限增长，配置 `limits.projects`、每项目 `tasks`/`sources`/`documents` 上限，并在超限时返回明确错误。

备选是按项目懒加载 `/project`；这会重写 store、mutation 和大量测试，增量 1 不做。若后续项目数超过 200 或状态超过 `limits.stateBytes`，再拆分接口。

### D9. UI：全局视图 + 项目工作区

全局侧栏保留“总览、项目、调研、文档、机会、会议”，用于跨项目检索；项目工作区提供“概览、阶段、任务、调研、文档、资料、活动”七个标签。两侧读取同一份项目事实，不用客户端本地状态复制结论。

- 项目中心：卡片/列表、状态与阶段筛选、搜索、交付周期、待人工决定、下一动作；空态给创建入口。
- 项目首页：业务背景、企业/负责人/周期、成功标准、风险、近期证据、阶段路径、下一动作。
- 阶段工作台：4 个工作项、3 份产物（缺失/存在/错误）、证据、阻塞、评审阻断项、决定栏、返回入口；历史与未来阶段只读。
- 任务：列表/看板 + 只读甘特；资料：上传、预览、版本与引用；文档：编辑器 + 版本时间线。
- 现有调研、机会、会议组件保留；项目标签内的调研/文档按项目过滤，机会/会议保持全局并可关联项目。

不引入新的 UI 依赖；甘特与版本时间线用 CSS/SVG，图标继续用内联 SVG。

### D10. 迁移与回滚

启动读取 `workbench.json`：

1. `schemaVersion === 2`：正常加载。
2. `schemaVersion === 1`：复制原文件到 `workbench.v1.backup.json`（若已存在则不覆盖），迁移后写 v2；迁移期间持写锁。
3. `schemaVersion > 2`：只读打开，提示升级插件。

迁移内容：

- 项目补充 `startDate`、`endDate`（空字符串表示未排期）、`status`（`deliveredAt` 非空则 `completed`，否则 `active`）。
- 每阶段写入 `.fde/stages/<stage>.json`：保留原有 3 个工作项与完成状态，追加第 4 个固定工作项（未完成）；保留证据、阻塞、决定；旧决定标记 `outcome: 'legacy'` 仅用于展示，不参与新门禁。
- 现有文档补 `versions: [{ version: 1, file: 旧正文路径 }]` 与 `currentVersion: 1`；不重写正文。
- 调研、机会、会议保持原结构。
- 迁移失败时不写 v2，保留备份并返回可读错误；修复后重试。

回滚：保留 v1 备份；卸载/降级插件时 v2 文件不自动回写 v1。回滚步骤写入 README：停插件、恢复 `workbench.json`、把项目目录移到备份位置。

### D11. 参考实现的许可证边界

gxfde 仓库是 MIT，可参考实现并保留声明；FF 仓库根目录没有统一许可证，Skills、实验室素材与文档另有授权。本变更只采用“八阶段/固定产物/人工决定/证据链”的产品结构与通用业务概念，所有代码、文案、模板、案例均重新编写，不复制 FF 的源码或素材。

### D12. 助手创建项目走“结构化提案 + 人工确认”

助手不再把用户问题直接交给自由文本任务，而是调用新增的 `assistant.command`：

- 宿主 prompt 要求模型返回 `{reply, action, project}`；`action` 只允许 `none` 或 `project.create`。
- 宿主解析器只接受白名单字段，校验名称非空与起止日期顺序；缺名称时降级为 `none`，不生成可执行卡。
- 客户端不展示原始 JSON 流，只显示解析后的 `reply`；当 `action === 'project.create'` 时渲染确认卡，确认后才调用 `project.create`，成功后打开项目首页。
- 助手头部和空态另提供「新建项目」按钮，复用同一个 `ProjectForm`；该路径不依赖模型，因此 AI 不可用时仍能创建项目。

这样既保留“既有记录只读”的边界，又给用户一个明确的、可审计的项目创建入口。

## Risks / Trade-offs

- **全局 revision 无法捕获 agent 直接改项目文件** → 快照读取以文件为准，界面在重新聚焦时刷新；并发 UI 写入可能覆盖外部改动，README 明确此限制，后续可加 per-project revision。
- **完整快照随项目增长变慢** → 配置上限、限制每项目任务/资料/文档数量；超过阈值再拆分 `/project` 接口。
- **v2 目录结构让备份变复杂** → 迁移前备份 `workbench.json`，README 给出整目录备份与回滚步骤；不删除旧文件。
- **25 MiB base64 上传占用内存** → 单独限制与超时；失败不落盘；后续可换分片上传。
- **固定 3 份产物对某些项目过重** → 产物是“最低证据”，允许可选产物与 Revise/Narrow；不把文件数量当业务质量。
- **只读甘特不能拖拽** → 增量 1 以任务列表编辑日期，甘特只做可视化；交互留给后续。
- **旧决定语义变化** → 迁移标记 `legacy`，只展示不参与门禁，避免旧项目被错误卡住。

## Migration Plan

1. 发布前在临时 profile 用 v1 数据副本运行迁移测试，比较项目数、阶段备注、证据、决定、文档正文。
2. 升级插件后首次打开：备份 → 迁移 → 校验；失败则保持 v1 并显示错误。
3. 验证项目中心、阶段合同、任务、资料、文档版本均可读写。
4. 回滚：停用插件，恢复 `workbench.json` 与项目目录备份；v2 新增目录保留但不被 v1 读取。

## Open Questions

无。增量 1 的实现边界已由 specs 与上述决策确定；调研对象树、方案设计、验证/收口与 DSH 原生能力留待后续变更。

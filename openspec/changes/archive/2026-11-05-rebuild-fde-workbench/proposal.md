# Proposal

## Why

仓库里已有的 `fde-delivery-workbench/` 是一个 3245 行的手写单文件客户端插件：数据只存在浏览器 `localStorage`，所谓“AI”是本地关键词扫描与人工打分，宿主的 DSH 模型完全没被用上；它也不在 `plugins/` 与 `catalog.json` 里，同事无法从市场安装。用户要求“正儿八经地把所有能力集成一个工作台，底层 AI 用当前的 DSH”，因此需要一次结构性重建，而不是继续在单文件上打补丁。

## What Changes

- **重建为市场插件**：新增 `plugins/fde-workbench/`（包名 `@acme-community/fde-workbench`，分类 `productivity`），登记进 `catalog.json`，可在 Discover 中安装；移除旧的 `fde-delivery-workbench/` 根目录包。
- **宿主半从零实现**：在配置的数据根目录（默认 `$DSH_HOME/fde-workbench`）维护工作台文件；通过 `ctx.connection.fetch` 在已认证的 `/api/fde-workbench/*` 上提供状态、变更、文件读写、AI 流式分析与“交给 DSH 会话”接口。
- **客户端半重建**：左侧栏入口 + 主区域单页工作台，内部按 总览 / 项目 / 调研 / 文档 / 机会 / 会议 组织，并带一个跟随当前上下文的 AI 助手停靠区；源码拆分为模块，由 Rollup 构建出 `client.js`。
- **能力整合**：在保留八阶段交付、阶段证据、阻塞、阶段决定、AI 机会评估、会议纪要的基础上，新增调研记录、交付文档、项目级 AI 助手；调研与文档可关联到项目与阶段。
- **AI 真正接入 DSH**：评估、机会提取、调研归纳、文档起草、阶段复盘、助手问答全部走 `ctx.llm`（默认取 `ctx.agentDefaultModel` 的路由），流式回传；结构化结果先以“建议”呈现，人工确认后才写回。复杂任务一键创建 DSH 会话并把项目/阶段上下文交给 agent，数据目录附 `AGENTS.md` 说明读写规则。
- **数据迁移**：首次打开时把旧插件 `dsh.fde-delivery-workbench.v1`（schema v2）的项目、机会、会议一次性导入工作台文件，保留旧键不删除；新数据不再落 `localStorage`。
- **测试与构建**：宿主纯逻辑与数据层用 `node:test` 覆盖；客户端用不渲染的冒烟测试校验槽位注册、字典、类名与评分契约；`client.js` 由 `build.mjs` 生成并随包提交。

## Capabilities

### New Capabilities

- `fde-workbench-shell`: 插件包形态、市场安装、左侧栏入口与主区域面板、生命周期与多语言、数据根目录配置、宿主 API 的访问边界与降级提示。
- `fde-workbench-records`: 工作台数据模型与工作区文件存储（原子写、校验、损坏恢复）、旧数据迁移、交付项目与八阶段/证据/决定、调研、交付文档、AI 机会、会议纪要。
- `fde-workbench-ai`: 基于 DSH 模型的评估、提取、归纳、起草与助手问答；流式输出与结构化建议；人工确认后写回；把上下文交给 DSH 会话；模型不可用与超时的降级。

### Modified Capabilities

<!-- 项目此前没有任何 capability spec，本次全部为新增。 -->

## Impact

- **新增**：`plugins/fde-workbench/`（host、client 源码、构建脚本、测试、locale、icon、README）、`catalog.json` 条目、可能的根 `scripts/` 构建辅助。
- **移除**：`fde-delivery-workbench/` 旧包目录与其单文件 `client.js`；其 `localStorage` 键保留为迁移来源。
- **依赖**：客户端构建引入 Rollup 作为插件内 devDependency（发布时剥离）；宿主半只使用 DSH 已组合的服务（`llm`、`agentDefaultModel`、`sessionController`、`workspaceRegistry`、`connection`、`logger`），不改 DSH 本体。
- **运行时**：新增一个数据根目录与 `AGENTS.md`；默认在 DSH 中注册名为“交付工作台”的 Workspace 以承载转交会话；不新增任何未认证的 HTTP 路由。
- **兼容性**：旧浏览器的 localStorage 数据只读迁移，不做反向写回；未安装 DSH 模型凭据时，AI 功能禁用但工作台 CRUD 仍可用。

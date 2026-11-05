# Design

## Context

本仓库是公司内部的 DSH 插件市场：`plugins/<slug>/` 存放可发布插件，`catalog.json` + `scripts/build-static-index.mjs` 生成静态索引，`index/` 与 Verdaccio 是服务端路线。仓库现有插件都不构建：`demo-board` 是占位界面，`market-publisher` 只有宿主工具。

旧 `fde-delivery-workbench/` 是手写的单文件客户端 bundle（3245 行，`window.__ModuleLoader__.load` 形态），宿主半为空，数据存 `localStorage`，AI 是关键词与人工打分。它验证了槽位、字典、样式与评分规则，但无法支撑“AI 用当前 DSH”的要求，也不在市场里。

DSH 侧与本设计相关的既有约束（均已核对源码）：

- 客户端 bundle 固定读 `exports["./client"]`，产物必须是 `window.__ModuleLoader__.load({ id, factory })` 形式；`dsh.client` 只认 `platform` / `inject` / `external` / `immediately`，没有 `entry`。
- 客户端可注入 `ctx.slots`、`ctx.locale`、`ctx.layout`、`ctx.connection`；`ctx.store` 不是服务，持久化依赖 `createSnapshotStore` 或自定义实现。
- 浏览器到宿主的业务通道有两条：Typert Remote（需要构建期生成 descriptor，第三方仓库不具备）与 `ctx.connection`。宿主的 `ctx.connection.fetch.register` 可以在已认证的 `/api` 通道上注册精确 Fetch 路由，只有 owner Peer 可达，支持 `GET/HEAD/POST` 与流式响应。
- 宿主已有 `ctx.llm.stream`、`ctx.agentDefaultModel.currentSelection()`、`ctx.sessionController.create/prompt`、`ctx.workspaceRegistry.create`、`ctx.logger` 等服务，插件通过 Cordis 注入使用，无需修改 DSH。

参考仓库 `gxfde/fde-workbench` 与 `fufankeji/FF-FDE-Delivery-Workbench` 在当前网络下不可访问；本设计采用旧 README 已记录的概念（项目/调研/交付文档组织、八阶段路径、阶段证据、由 FDE 确认阶段决定），实现全部原创，不复制其源码。

## Goals / Non-Goals

**Goals**

- 一个可安装、可升级、可下架的市场插件，侧栏入口 + 单页工作台覆盖项目、调研、文档、机会、会议与 AI 助手。
- 数据成为可版本化、可被 DSH agent 直接读写的工作区文件，而不是浏览器孤岛。
- AI 真正走 DSH 模型；结构化结果可校验、可回滚、必须人工确认。
- 复杂任务能一键进入 DSH 会话，并在同一数据目录里继续。
- 旧浏览器数据无损迁移；没有模型凭据时 CRUD 仍可用。

**Non-Goals**

- 不做多人实时协作、权限模型、云端同步或冲突合并；同一时刻假定一个活跃标签页。
- 不实现自己的模型网关、密钥管理或计费；全部复用 DSH 的提供方与凭据。
- 不自动推进阶段、不自动采纳机会；AI 不直接写库。
- 不做 Office/PDF 导出、知识库检索、向量索引。
- 不修改 DSH 本体，也不依赖 monorepo 内的构建工具链。

## Decisions

### D1 包位置与命名

新包放在 `plugins/fde-workbench/`，包名 `@acme-community/fde-workbench`，`dshMarket.category` 与 catalog 分类都用 `productivity`。旧目录在验收通过后删除。

- 备选：保留根目录 `fde-delivery-workbench/`。放弃，因为市场索引只扫 `plugins/` 下由 catalog 指名的路径，且根目录包名 `@local/*` 不是市场作用域。
- 备选：沿用旧名 `fde-delivery-workbench`。放弃，新包能力已超出“交付”，统一叫 `fde-workbench` 更准确。

### D2 宿主半拥有数据与 AI，客户端半只做界面

宿主半负责目录、文件、校验、迁移、模型调用、会话转交；客户端半只负责渲染、交互与调用 `/api/fde-workbench/*`。

- 备选：继续全客户端 + localStorage。放弃：AI 无法读取，换机器丢失，agent 无法协作。
- 备选：宿主只做 AI，数据仍在前端。放弃：两套状态源，外部修改无法同步。

### D3 工作区文件：JSON 索引 + Markdown 正文

数据根目录默认 `$DSH_HOME/fde-workbench`，可由插件配置覆盖。`workbench.json` 保存全部结构化记录与版本号；长文本单独存 Markdown，由记录里的 `file` 字段引用。

```
<root>/
  AGENTS.md                  # 给 agent 的目录与编辑规则（宿主维护）
  workbench.json             # schemaVersion、revision、projects/opportunities/meetings/research/docs
  projects/<projectId>/
    project.md
    research/<researchId>.md
    docs/<docId>.md
  meetings/<meetingId>.md
```

- 为什么不是纯 Markdown：八阶段、证据状态、评分、阻塞严重度是结构化数据，表格解析脆弱。
- 为什么不是纯 JSON：纪要、调研、文档是长文本，放进 JSON 会让 diff、AI 编辑和人工排查都变差。
- 备选：`ctx.storageDomain`。放弃：用户明确选择“工作区文件，AI 可读写”，且 storage 对 agent 不可见。
- 备选：每个项目一个 JSON。放弃：跨项目查询（总览、机会库）需要扫描合并。

### D4 客户端与宿主的通道：认证的精确 Fetch 路由

宿主用 `ctx.connection.fetch.register` 注册以下路由（全部在 `/api/fde-workbench/` 下，仅 owner 可达）：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/fde-workbench/state` | 返回完整状态、`revision`、数据根目录、AI 可用性与模型名、迁移状态 |
| POST | `/api/fde-workbench/mutate` | 单条变更操作，带 `baseRevision`，返回新状态或 409 冲突 |
| GET | `/api/fde-workbench/file?path=` | 读取 Markdown 正文（含大小与哈希） |
| POST | `/api/fde-workbench/file?path=` | 写入 Markdown 正文（`{ content, baseHash? }`） |
| POST | `/api/fde-workbench/ai` | SSE 流式 AI 调用（`text/event-stream`） |
| POST | `/api/fde-workbench/handoff` | 创建/复用工作台 Workspace 与会话，返回 `sessionId` |
| POST | `/api/fde-workbench/legacy-import` | 一次性导入旧 localStorage 数据 |

- `requestBody`：状态、变更、文件、AI、转交都用 `'buffered'`，仅 AI 的响应是流；请求体上限由 DSH 的 `/api` 通道统一限制（约 300 MiB），插件另设更小的业务上限。
- 为什么不用 Typert Remote：第三方包需要生成 `./typert` 与 `./remote` 产物，运行时不会发现新增 Remote；对本插件是不可维护的构建负担。
- 为什么不用裸 `ctx.webServer` 路由：没有认证，必须自己重做 Host/Origin 与令牌校验；`connection.fetch` 已包含这些检查并且只允许 owner。
- 为什么不用 `connection.rpc.handle` 逻辑通道：一元调用够用，但无法方便地流式返回 token；为 AI 单独开 SSE 又需要第二套通道。统一 Fetch 更简单。
- 方法只有 `GET/HEAD/POST`，所以写操作一律 POST，不设计 PUT/DELETE 路由。

### D5 AI：直调 `ctx.llm` 做有界分析，整段任务转交会话

- 直调：机会评估、会议提取、调研归纳、文档起草、阶段复盘、助手问答。特点是有明确输入、结果可校验、几秒内完成。
- 转交：需要读多个文件、执行工具、持续多轮的任务。宿主创建会话并发送带文件指针的首条消息，后续由 DSH agent 完成。
- 模型路由：插件配置 `ai.provider` / `ai.model` 优先；否则 `ctx.agentDefaultModel.currentSelection()`；两者都没有则 AI 禁用。
- 备选：所有 AI 都走会话。放弃：每次评分都要建会话，污染侧栏、延迟高。
- 备选：所有 AI 都直调。放弃：跨文件分析、写回文件、多轮追问需要 agent 的工具与循环。

### D6 AI 输出是建议，不是写入

所有 AI 结果先在发起区域呈现，用户确认后才通过 `mutate` 落库。评估结果与现有评分并列显示；提取候选先进入草稿列表；草稿正文只写进编辑器。

- 备选：AI 直接更新记录。放弃：评分与阶段决定是 FDE 的判断，不能让模型静默修改；也避免提示注入导致数据被改。
- 评分确定性：应用 AI 建议后，分数仍由固定权重公式重新计算；公式与合规闸门保留在宿主纯函数里，可单测。

### D7 转交会话与 `AGENTS.md`

`handoff` 的执行顺序：

1. 确保数据根目录存在，必要时重写 `AGENTS.md`。
2. `ctx.workspaceRegistry.create(root, '交付工作台')` 创建或复用 Workspace（目录已存在时返回同一个）。
3. `ctx.sessionController.create({ workspaceId })` 创建空白会话。
4. `ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue', content: [{ type: 'text', text }] })` 发送上下文。
5. 返回 `sessionId`；客户端调用 `ctx.uiWorkspace.openSession(sessionId)` 并 `ctx.layout.selectPanel(null)` 回到会话。

- 首条消息包含：角色说明、项目/阶段/机会的范围、数据根目录、需要先读的文件清单、写入规则、以及“阶段决定必须由人确认”。
- `AGENTS.md` 是给 agent 的持久契约：目录结构、字段含义、JSON 结构与枚举、允许的编辑方式、禁止事项。数据版本变化时重写并在界面提示一次。
- 备选：注册 `workbench_*` 工具给 agent。暂缓：文件 + AGENTS.md 已能被现有 fs 工具处理，工具会增加每个会话的提示词成本；如果实际使用中出现误改，再在后续变更中加工具。
- 备选：用 `origin:'subagent'` 隐藏会话。放弃：语义错误，且用户需要能回到会话继续追问。

### D8 客户端：单棵 React 树 + 外部 store + 令牌化样式

- 入口 `src/client/index.js` 注册 `main` 与 `sidebar.panellist`（id/key 均为 `fde-workbench`，order 30），注册 locale 字典，并在释放时把面板交回会话。
- 页面 `WorkbenchApp` 内部用 `section` + 选中 id 导航：总览、项目、调研、文档、机会、会议；右侧 `AssistantDock` 跟随当前上下文。
- 状态用一个约 150 行的外部 store（`subscribe` / `getSnapshot` / `useSyncExternalStore`），不引入状态库；服务端状态以 `revision` 为准，变更采用乐观更新 + 失败回滚 + 409 时整体重载。
- 编辑器使用本地草稿 + `dirty` 标记，切换与外部刷新前提示；长文本保存走 `/file` 接口。
- 样式集中在 `styles.css`，构建时内联为字符串；类前缀 `fdw-`；颜色只用 `--dsw-alias-*` 语义变量，不写死颜色，不使用主题选择器。
- 备选：使用 `@deepseek-ai/dsh-client-ui-primitives`。放弃：会增加外部依赖与版本耦合，现有手写控件已够用。
- 备选：React Router / TanStack Query。放弃：面板只有一个入口，不需要路由；数据量小，手写请求足够。

### D9 构建：Rollup + 自定义 `__ModuleLoader__` 包装

`plugins/fde-workbench/build.mjs` 用 Rollup 的 JS API：

- 输入 `src/client/index.js`，`output.format = 'cjs'`、`exports = 'default'`。
- `external`：`react`、`react-dom` 以及任何 `@deepseek-ai/*`（实际源码只依赖 `react`，其余通过注入的 ctx 使用）。
- 自定义小插件把 `.css` 转成 `export default "<css 文本>"`，构建时内联。
- 产物用固定 banner/footer 包成 `window.__ModuleLoader__.load({ id, factory })`；factory 内提供 `require`、`module`、`exports`，返回 `module.exports`。
- 构建后自检：包含注册调用、没有残留 `import`/`export`、体积低于 2 MB、`id` 正确。
- 生成的 `client.js` 提交进仓库；`rollup` 只作为插件内 `devDependencies`，发布时被 CLI 剥离。

- 备选：继续手写单文件。放弃：3245 行不可维护，正是本次要解决的问题。
- 备选：esbuild。在当前沙箱里它通过 `spawn` 启动二进制，被 `EPERM` 拒绝；Rollup 是纯 JS，已实测可打包。
- 备选：复用 DSH 的 `tsdown.client.ts`。放弃：不是发布包，第三方无法引用；且它绑定 monorepo 的打包约定。
- 备选：手写模块拆分 + 运行时 chunk。放弃：chunk 注册与相对 URL 规则是内部约定，版本漂移风险高。

### D10 数据模型与版本

`workbench.json` 顶层：

```json
{
  "schemaVersion": 1,
  "revision": 42,
  "updatedAt": "2026-11-04T10:00:00.000Z",
  "migration": { "legacyImportedAt": null, "legacySchema": null },
  "projects": [],
  "opportunities": [],
  "meetings": [],
  "research": [],
  "docs": []
}
```

- `project`: `id, name, customer, owner, targetDate, createdAt, currentStage(0–7), deliveredAt, stages[8], file`。
- `stage`: `work[{id,text,done}]`, `artifacts[{id,name,kind,status,file?}]`, `blockers[{id,text,severity,resolved}]`, `decisions[{id,at,decision,kind:'advance'|'revise'}]`, `noteFile?`。
- `opportunity`: `id,title,description,proposer,domain,taskType,source{type,meetingId?},ratings{data,rules,review,value,adoption},compliance,status,ai?{model,at,rationale,conditions[],suggested} ,file`。
- `meeting`: `id,title,date,attendees[],file,createdAt,updatedAt`。
- `research`: `id,title,projectId?,stage?,status,question,conclusion,file,createdAt,updatedAt`。
- `doc`: `id,title,template,projectId?,stage?,status,file,createdAt,updatedAt`。
- 枚举：`domain` 11 项、`taskType` 8 项、`oppStatus` 6 项、`compliance` 3 项、`docStatus` 3 项、`researchStatus` 4 项；越界回落到首个默认值并记录警告。
- ID：`<prefix>-<8 位 base32>`，创建时生成，不接受客户端指定。
- `revision` 每次成功写入 +1；`mutate` 携带 `baseRevision`，不匹配返回 409 与当前状态。

### D11 迁移

1. 客户端挂载后读 `localStorage['dsh.fde-delivery-workbench.v1']`；不存在或宿主 `migration.legacyImportedAt` 已设置则跳过。
2. 解析并校验 `schemaVersion === 2`；把对象 POST 到 `legacy-import`。
3. 宿主映射：项目直接转成新项目（阶段数组补齐到 8），机会保留评分与来源，会议原文写入 `meetings/<id>.md`，项目备注写入 `projects/<id>/project.md`。
4. 迁移完成写 `migration.legacyImportedAt`，客户端设置 `localStorage['dsh.fde-workbench.migrated'] = '<ISO>'`。
5. 旧键不删除；再次打开不重复导入；迁移后的记录可被正常编辑。

- 失败处理：旧数据无法解析时跳过并提示，不写任何内容；部分记录字段缺失时用默认值补齐并计数报告。

### D12 安全与限额

- 路由只在 `/api` 通道，owner-only；不新增匿名入口。
- 路径：`path.resolve` 后必须位于根目录内，拒绝 `..`、绝对路径与逃逸的符号链接；只允许 `.md`。
- 大小：`workbench.json` ≤ 8 MB，单个 Markdown ≤ 512 KB，单次请求体 ≤ 1 MB（AI 上下文 ≤ 200 KB）。
- 记录数：项目 ≤ 200、机会 ≤ 2000、会议 ≤ 1000、调研/文档各 ≤ 2000；超出返回明确错误。
- 隐私：AI 请求只发送用户当前操作所选记录的裁剪内容；提示词与响应不写会话日志、不写 localStorage；README 明确“运行 AI 会把所选内容发送给部署配置的模型提供方”。

## Risks / Trade-offs

- **模型输出不稳定或返回非法 JSON** → 宽容解析（代码块 / 前后缀）+ 逐字段校验；解析失败保留原文并标记 `ai/unstructured`；评分公式始终由本地重算。
- **AI 费用与延迟** → 只在明确点击后调用；单次输出上限、请求体上限、60 秒超时；同一面板并发请求拒绝；界面显示模型名。
- **agent 直接改文件导致损坏** → 读时校验、写入前备份、损坏时从 `.bak` 恢复并提示；`AGENTS.md` 写清规则；后续可加工具收紧。
- **多标签页并发** → `revision` 冲突返回 409，客户端重载并提示“数据已在别处更新”；不做自动合并。
- **DSH 版本漂移（0.2.x alpha）** → 服务访问集中在一个 `capabilities.js` 适配层，按 `ctx.get` 特性检测；缺失时禁用对应功能而不是崩溃。
- **Windows 路径与大小写** → 用 `path.relative` 判断包含关系，统一 `\` 与 `/`；写文件用绝对路径，记录里只存 POSIX 相对路径。
- **市场安装克隆整仓** → 插件 `files` 白名单只含运行必需文件；不提交 `node_modules`；产物控制在 2 MB 内。
- **会话出现在侧栏造成干扰** → 默认把工作台目录登记为命名 Workspace，会话归组；Workspace 不可用时回退 `cwd` 并在界面说明。
- **界面文案漂移** → 冒烟测试扫描所有静态 `t()` 键，缺失即失败；CI 不依赖浏览器。
- **数据目录被用户移动** → 配置项显式覆盖；启动自检发现目录不存在时重建空结构并提示，不静默指向别处。

## Migration Plan

1. 新建 `plugins/fde-workbench/`，保留旧目录不动；先完成宿主数据层与迁移，再完成客户端。
2. 本地用 `plugin_manager` 安装新包，验证侧栏入口、CRUD、AI、转交与旧数据迁移。
3. 在 `catalog.json` 登记并运行 `node scripts/build-static-index.mjs` 校验索引。
4. 验收通过后删除 `fde-delivery-workbench/`，更新根 README 的插件列表（若有）与插件 README。
5. 回滚：旧包在验收前始终保留；数据侧无需回滚（新目录独立、旧 localStorage 键未删）。若新包不可用，重新安装旧包即可继续使用原数据。

## Open Questions

- 是否额外给 agent 注册 `workbench_*` 工具：等文件 + `AGENTS.md` 的实际误改率数据再决定，不影响当前 spec 与任务拆分。
- 是否支持多个数据根（多个“工作台”）：当前单根已满足；多根需要新的设置界面与迁移，留待后续变更。
- 是否提供导出为 Office/PDF：与插件体积和依赖相关，留待后续。

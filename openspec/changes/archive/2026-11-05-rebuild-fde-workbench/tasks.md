# Tasks

## 1. 脚手架与包清单

- [x] 1.1 创建 `plugins/fde-workbench/` 骨架：`package.json`、`cordis.patch.yml`、宿主入口 `index.js`、`locale/zh.json`、`locale/en.json`、`icon.svg`、`README.md`；验证 `node -e "JSON.parse(fs.readFileSync('plugins/fde-workbench/package.json'))"` 通过且 `cordis.patch.yml` 的 `id`/`name` 与包名一致。
- [x] 1.2 在 `package.json` 中声明 `dsh.bundle.patch`、`exports`（`.`、`./client`、`./locale/*.json`、`./icon`）、`engines.dsh`、`dshMarket.category = productivity` 与 `files` 白名单（只含 `index.js`、宿主 ESM 源码、`client.js`、`cordis.patch.yml`、`locale`、`icon.svg`、`README.md`，排除 `src/client`、`build.mjs`、`tests`、`node_modules`）；验证 `npm pack --dry-run` 只列出运行必需文件。
- [x] 1.3 添加 `rollup` 到插件 `devDependencies` 并安装到本地 `plugins/fde-workbench/node_modules`（`--ignore-scripts`），确认根 `.gitignore` 的 `node_modules/` 规则覆盖该目录；验证 `node -e "import('rollup')"` 成功且 `git status` 不显示被忽略的依赖目录。
- [x] 1.4 实现 `build.mjs`：Rollup CJS 打包、CSS 文本插件、`__ModuleLoader__.load` 包装、产物自检（id、无残留 import/export、体积上限）；验证先放一个占位 `src/client/index.js` 后 `node build.mjs` 生成 `client.js` 且包含注册调用。
- [x] 1.5 实现宿主配置模块 `src/host/config.js`（数据根目录默认值与覆盖、各类大小/数量上限、AI 超时与模型覆盖）并用 `node --test` 覆盖默认值与非法配置回落。

## 2. 宿主数据层

- [x] 2.1 实现 `src/host/paths.js`：根目录创建、POSIX 相对路径规范化、`path.resolve` + `path.relative` 包含校验、拒绝 `..`/绝对路径/非 `.md`；用临时目录测试通过、越界与符号链接逃逸均被拒绝。
- [x] 2.2 实现 `src/host/schema.js`：结构默认值、枚举回落、ID 生成、记录上限、`schemaVersion` 读取；用 `node --test` 覆盖正常记录、越界枚举、缺字段、未知版本。
- [x] 2.3 实现 `src/host/store.js`：读取/规范化、临时文件 + rename 原子写、`.bak` 轮转、`revision` 自增、写入串行队列、409 冲突信号；用临时目录测试损坏 JSON 从备份恢复、并发写串行、版本冲突。
- [x] 2.4 实现 `src/host/files.js`：Markdown 读写、内容哈希、单文件与总大小限制、路径登录；测试读写往返、超限 413、路径越界 400。
- [x] 2.5 实现 `src/host/state.js`：从 store 组装给客户端的完整状态（含 `revision`、根目录、AI 能力、迁移标记）与变更操作分派（项目/阶段/工作项/证据/阻塞/备注/决定/机会/会议/调研/文档）；用 `node --test` 覆盖每个操作的成功与非法输入。

## 3. 旧数据迁移

- [x] 3.1 实现 `src/host/migrate.js`：把旧 v2 结构映射为新项目/机会/会议与 Markdown 正文，生成迁移计数；用固定 v2 fixture 测试 2 项目/6 机会/2 会议的字段映射。
- [x] 3.2 覆盖迁移幂等与异常：已迁移时跳过、旧数据损坏时返回原因且不写入、字段缺失时补默认值并计数；用 `node --test` 覆盖三种情况。

## 4. 宿主 HTTP 接口

- [x] 4.1 实现 `src/host/routes.js` 的路由注册与请求处理骨架：只注册在 `/api/fde-workbench/` 下、仅 `GET/HEAD/POST`、JSON 错误结构、请求体上限；用假的 `connection.fetch` 记录注册并断言路径/方法。
- [x] 4.2 实现 `GET /state` 与 `POST /mutate`：返回状态、按 `baseRevision` 校验、409 附带当前状态；用假 store 测试成功、冲突与非法操作。
- [x] 4.3 实现 `GET /file` 与 `POST /file`：读取正文与哈希、按 `baseHash` 防止覆盖外部修改、越界与超限错误；用临时目录测试。
- [x] 4.4 实现 `POST /legacy-import`：调用迁移器、返回计数与迁移标记、重复导入直接返回已迁移；用假请求测试。
- [x] 4.5 在宿主入口 `index.js` 接线：`inject` 必需服务、可选服务特性检测、启动自检、路由释放与 `ctx.logger` 记录；用假 ctx 测试插件能加载、释放后路由被移除。

## 5. AI 能力

- [x] 5.1 实现 `src/host/ai/capabilities.js`：读取插件配置或 `ctx.agentDefaultModel.currentSelection()`、检测 `ctx.llm` 与提供方目录、输出 `{ available, provider, model, reason }`；用假服务测试有默认模型、无 LLM、无凭据三种结果。
- [x] 5.2 实现六个任务的上下文构建与裁剪（机会评估、会议提取、调研归纳、文档起草、阶段复盘、助手问答），保证请求体不超过上限并只包含所选记录；用固定记录测试裁剪后仍保留关键字段与文件指针。
- [x] 5.3 实现提示词模板与结构化输出解析/校验：代码块提取、`opportunity.assess` 分数 1–5、`meeting.extract` 候选上限与去重、`doc.draft` 保留标题结构；用 `node --test` 覆盖合法、越界、夹带说明文字、空结果四类输入。
- [x] 5.4 实现 `POST /ai` 的 SSE 流：`start`/`delta`/`result`/`error`/`done` 事件、客户端断开与 `AbortSignal` 中止、超时、同一连接并发限制；用假 `llm.stream` 测试增量顺序、取消与超时。
- [x] 5.5 实现 AI 建议的应用规则：评估结果应用后按固定权重重算分数、合规闸门仍生效、会议候选只在确认后创建机会、草稿只返回文本不落库；用 `node --test` 断言未确认时 store 不变。

## 6. 会话转交

- [x] 6.1 实现 `src/host/agents-md.js`：按 schema 版本生成 `AGENTS.md`（目录地图、字段与枚举、编辑规则、人工确认约束），版本变化时重写；测试生成内容包含所有枚举与版本标记，重复调用不重复追加。
- [x] 6.2 实现 `POST /handoff`：确保目录与 `AGENTS.md`、复用或创建 Workspace、创建会话、发送首条消息、返回 `sessionId`；用假 `workspaceRegistry`/`sessionController` 测试成功、服务缺失时降级与错误返回。
- [x] 6.3 实现按范围（项目/阶段/机会/会议/调研/文档）生成首条消息：包含数据根目录、文件清单、任务与写入规则；用固定记录测试每种范围都包含正确路径且不超过长度上限。

## 7. 客户端基础

- [x] 7.1 建立 `src/client/i18n/en.js` 与 `zh.js`：覆盖导航、空态、表单、状态、错误、AI、转交等全部静态文案，键集合一致；用脚本测试两种语言键集合相同且无空值。
- [x] 7.2 实现 `src/client/api.js`：`getState`/`mutate`/`readFile`/`writeFile`/`aiStream`/`handoff`/`legacyImport`，统一错误码、AbortSignal 与 SSE 解析；用假 `fetch` 测试 JSON 错误、409、流式增量与取消。
- [x] 7.3 实现 `src/client/store.js`：外部 store + `useSyncExternalStore`、乐观更新、失败回滚、409 整体重载、按范围选择器；用 `node --test` 测试订阅、回滚与重载。
- [x] 7.4 实现 `src/client/index.js` 插件注册：`main` 与 `sidebar.panellist`（id/key `fde-workbench`、order 30）、locale 注册、释放时交回会话；用冒烟测试校验注册、id/key 与清理逻辑。
- [x] 7.5 编写 `src/client/styles.css`：布局、卡片、阶段路径、表单、AI 停靠区、响应式断点，颜色只用 `--dsw-alias-*`；冒烟测试校验所有 `fdw-` 类名都能在样式表中找到且没有硬编码十六进制颜色。
- [x] 7.6 实现共享控件 `src/client/ui/common.js`：按钮、字段、选择器、确认对话框、状态徽章、空态与加载态，统一键盘焦点与 `aria-*`；冒烟测试校验每个控件都有可访问名称且确认对话框需要二次调用才执行。
- [x] 7.7 实现错误边界与全局提示：捕获渲染异常显示可恢复面板，API 错误统一显示错误码与重试；用假组件抛错测试边界不拖垮整个 DSH 外壳。

## 8. 客户端界面

- [x] 8.1 实现应用外壳 `WorkbenchApp`：左侧分区导航、页头（根目录、刷新、AI 状态、在 DSH 中继续）、内容区与助手停靠区、加载/空态/错误态；构建后冒烟测试校验分区键与文案键存在。
- [x] 8.2 实现总览：项目/进行中/已交付/未解决阻塞指标、八阶段分布、近期活动与下一步建议；用纯选择器测试空数据与多项目输入的统计结果。
- [x] 8.3 实现项目列表与表单：新建（名称必填）、编辑、二次确认删除；验证表单校验与删除后关联调研/文档的清理调用。
- [x] 8.4 实现项目详情与八阶段路径：阶段状态、点击历史阶段只读、当前阶段高亮；用选择器测试阶段状态推导。
- [x] 8.5 实现阶段工作台：工作项勾选/增删、证据增删与状态循环、阻塞增删与解决、备注编辑；验证每个动作发出正确的 mutate 操作且历史阶段被拒绝。
- [x] 8.6 实现阶段决定：仅当前阶段可写、继续需二次确认、第八阶段继续后显示已交付、已交付后只允许修订；验证确认与取消两条路径。
- [x] 8.7 实现调研：列表（按项目/阶段/状态筛选）、详情、Markdown 正文编辑与保存、关联项目与阶段；验证筛选结果与保存后的重新加载。
- [x] 8.8 实现文档：模板选择、从模板创建、列表与详情、正文编辑、状态流转；验证模板骨架与状态更新。
- [x] 8.9 实现机会库：搜索与筛选、按分数排序、详情就地编辑、五维打分与合规选择、分数与结论展示；用评分纯函数测试权重、门槛与最弱维度。
- [x] 8.10 实现机会 AI 评估界面：触发流式评估、建议与当前值并列、逐字段应用/忽略、越界字段提示；用假流测试“未确认不写库”。
- [x] 8.11 实现会议：列表与详情、原文编辑、AI 提取候选列表（全选/勾选/删除）、确认入库、来源跳转、删除会议保留机会；用假流测试候选不自动入库。
- [x] 8.12 实现调研归纳、文档起草与阶段复盘的 AI 草稿入口：结果进入编辑器、保留模板结构、未保存不落库。
- [x] 8.13 实现助手停靠区：上下文跟随当前项目/阶段、流式回答、停止、清空、只读提示；验证切换分区后上下文与消息重置规则。
- [x] 8.14 实现转交交互：调用 handoff、用 `ctx.uiWorkspace.openSession` 打开会话、回到会话面板、失败时展示可复制提示词；用假 `uiWorkspace` 测试成功与失败。
- [x] 8.15 实现编辑器脏状态与外部刷新：离开前提示、窗口聚焦重新拉取、检测到外部修改时选择保留本地或载入外部；用假 store 测试两条分支。

## 9. 市场打包

- [x] 9.1 完成 `package.json` 的展示字段：`author`、`license`、`description`、`keywords`、`dshMarket.category`、`locale/*.json` 的 `meta.title/description`；验证 `node -e` 读取字段非空且与 README 标题一致。
- [x] 9.2 优化 `icon.svg`（64×64 viewBox、`role="img"`、`aria-label`）并验证小于 32 KiB。
- [x] 9.3 在 `catalog.json` 增加条目（`path`、`category: productivity`、中英文标题与描述）；运行 `node scripts/build-static-index.mjs --repo https://github.com/<owner>/dsh-market --out public` 后验证 `public/index.json` 包含该包与 commit/路径。
- [x] 9.4 编写插件 `README.md`：安装、首次使用、六类记录、AI 与隐私、转交会话、数据目录与备份、已知限制；验证文中命令可按原样执行。
- [x] 9.5 在 `plugins/fde-workbench/README.md` 记录构建与测试命令（`npm install`、`node build.mjs`、`node --test`），并验证从干净 clone 按文档能生成 `client.js`。

## 10. 集成与验收

- [x] 10.1 运行完整检查：`node tests/run.mjs`（106 项，替代在沙箱中会被 `spawn EPERM` 拒绝的 `node --test`）、`node build.mjs`、客户端冒烟测试、`node scripts/build-static-index.mjs --repo https://github.com/sy118/dsh-market --out public`，全部通过且 `client.js` 为 232,979 字节（小于 2 MB）。
- [x] 10.2 在临时隔离 profile 的 GUI（3099 端口）中验证：侧栏出现「交付工作台」；打开面板；创建项目「应付账款对账」；添加证据、阻塞并保存阶段备注；记录决定后二次确认并推进到第 2 阶段；旧版 `localStorage` 快照在首次打开时导入（1 项目 / 1 机会 / 1 会议，生成 `workbench.json` 与 Markdown，旧键保留）；AI 徽章与降级提示符合预期。
- [x] 10.3 在已安装状态下验证降级与转交：临时 profile 的 GUI 中点击“用 AI 评估/提取候选”，在无凭据时显示“未配置模型凭据”并把 AI 徽章切为“AI 已关闭”、按钮禁用；点击“在 DSH 中继续”创建了命名 Workspace 与会话并打开（会话首条消息含数据目录与规则），agent 因缺少 `DEEPSEEK_API_KEY` 失败属于模型凭据问题而非插件问题。成功结果的 AI 评估未实跑。
- [x] 10.4 从根目录移除 `fde-delivery-workbench/`（归档到忽略目录 `.dev/legacy-fde-delivery-workbench/` 以便回滚），并用 `plugin_manager remove_bundle` 卸载旧包；`grep` 后仅剩迁移键 `dsh.fde-delivery-workbench.v1` 与规划文档中的历史说明，catalog、脚本、README 无旧包引用。
- [x] 10.5 汇总验证表：每项 spec 场景对应的测试或手工验证位置，未实跑项与原因写入插件 README 的“验证情况”（见 `plugins/fde-workbench/README.md` 末尾表格）。

## Workflow follow-up

- 在审查通过后归档该变更（`/openspec-archive-change`）。
- 归档后检查 `openspec/specs/` 下的三个能力 spec 是否生成，并补全 Purpose。

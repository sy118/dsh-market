# 交付工作台

一个 DSH 插件：在左侧栏新增「交付工作台」入口，把**项目组合、八阶段交付合同、调研、资料、任务、交付文档、AI 机会与会议纪要**放在同一个页面里。分析、提取、归纳与起草由**当前 DSH 配置的模型**完成；复杂任务可以一键交给 DSH 会话，在工作台数据目录里继续。

参考了 [gxfde/fde-workbench](https://github.com/gxfde/fde-workbench) 的项目 / 调研 / 交付文档组织方式，以及 [fufankeji/FF-FDE-Delivery-Workbench](https://github.com/fufankeji/FF-FDE-Delivery-Workbench) 的八阶段、固定产物与「由 FDE 作出阶段决定」的边界。实现与文案为原创代码，没有复制参考仓库的源码、模板或案例素材。

## 能力

| 分区 | 做什么 |
| --- | --- |
| 项目中心 | 项目列表、状态/阶段筛选、搜索、交付周期、下一步、未解决阻塞；跨项目任务中心 |
| 项目首页 | 业务背景、企业与负责人、周期、成功标准、关键人、风险、近期证据、八阶段路径 |
| 阶段工作台 | 每阶段固定 4 个工作项与 3 份必需产物（第一阶段另有 1 份可选）；产物缺失/已就绪/读取失败；评审阻断项、证据、阻塞、备注 |
| 阶段决定 | Go / Revise / Narrow / Stop；Go 只在评审就绪时推进一格；第八阶段 Go 完成项目；Revise/Narrow 留在本阶段；Stop 停止项目 |
| 返回重评 | 只能退一格、必须填写原因；保留全部产物与决定，并标记重新确认范围 |
| 资料 | 项目内上传（25 MiB/文件）、SHA-256、版本、文本预览与下载；被阶段证据引用时删除会被拒绝 |
| 任务 | 状态、优先级、负责人、起止日期、进度、前置依赖；依赖环与前置未完成会被拒绝；只读甘特 |
| 文档 | 模板创建、`draft/review/approved/archived`、每次保存新增版本、恢复旧版本、引用保护 |
| 调研 | 问题、结论、状态与正文；关联项目与阶段；按项目/状态筛选；AI 归纳 |
| 机会 | 财务领域机会库；五维 1–5 分与合规等级；固定权重算分；AI 评估建议；人工确认后应用 |
| 会议 | 纪要原文；AI 提取候选；勾选后加入机会库；来源跳转 |
| 助手 | 跟随当前项目 / 阶段的问答；说「帮我创建项目」会生成待确认的项目卡，也可点「新建项目」直接填写 |

AI 结果一律**先作为建议呈现**；评分、阶段决定与记录写入都需要人确认。**文件存在不等于证据通过**，阶段状态只由宿主按工作项、必需产物和阻塞计算，Agent 和用户都不能直接设置 `review-ready`。

## 安装

市场路线：插件页 → Discover → 找到「交付工作台」→ 安装。

本地路线（开发时）：在 DSH 对话里让 agent 安装本目录（`plugin_manager` 的 `install_bundle`，target 指向 `plugins/fde-workbench` 的绝对路径）。

安装后左侧栏出现「交付工作台」图标（插件与定时任务入口之后）。首次打开会创建数据目录；如果浏览器存在旧版 `dsh.fde-delivery-workbench.v1` 数据，会提示一次性导入。

## 数据目录

默认 `$DSH_HOME/fde-workbench`（`$DSH_HOME` 未设置时为 `~/.dsh`）。可在 profile 的 `cordis.patch.yml` 覆盖：

```yaml
- override:
    - id: fde-workbench
      config:
        root: 'C:/Users/you/fde-workbench'
        ai:
          provider: ''      # 留空则用 DSH 默认模型
          model: ''
          timeoutMs: 60000
          maxTokens: 4096
```

v2 目录结构：

```text
<root>/
  AGENTS.md                       # 给 agent 的目录与编辑规则（插件维护）
  workbench.json                  # 项目索引 + 机会/会议/调研/文档元数据 + revision
  projects/<projectId>/
    project.md                    # 业务背景/目标/范围
    stages/<0-7>.md               # 阶段备注
    .fde/
      project.json                # 状态、当前阶段、返回与重评范围
      stages/<stageId>.json       # 工作项、产物状态、阻塞、决定（宿主同步）
      tasks.json                  # 任务与依赖
      sources.json                # 资料元数据与版本
      documents.json              # 文档元数据与版本指针
    fde-deliverables/0N-*/        # 阶段固定产物
    sources/<sourceId>/<version>/ # 资料原件
    documents/<docId>/vN.md       # 文档版本正文
  meetings/<meetingId>.md
  opportunities/<opportunityId>.md
```

`workbench.json` 仍是结构化记录的权威源，`.fde/` 是给 agent 直接阅读的项目镜像；修改结构化状态仍应通过工作台或 `workbench.json`。

写入是原子的（临时文件 + rename），上一版保留为 `workbench.json.bak`；损坏时优先从备份恢复，无法恢复则把损坏文件移到 `workbench.json.corrupt-<时间戳>` 并以空状态启动，不会用示例数据覆盖。每次写入都会让 `revision` 加一；并发修改以 409 冲突返回并重新加载。

### 阶段固定产物

| 阶段 | 必需产物 |
| --- | --- |
| 01 发现高价值问题 | `discovery-report.md`、`confirmation-checklist.md`、`problem-baseline.md`（可选 `engagement-reframe.md`） |
| 02 定义结果、范围与责任 | `outcome-contract.md`、`value-case.md`、`delivery-plan.md` |
| 03 调查现场条件 | `data-readiness.md`、`system-access-map.md`、`governance-review.md` |
| 04 设计方案与纵向切片 | `mechanism-selection.md`、`solution-design.md`、`vertical-slice-record.md` |
| 05 运行 PoC 与 Eval | `evaluation-plan.md`、`evaluation-report.md`、`evaluation-baseline.md` |
| 06 集成、可靠性与受控试点 | `pilot-scope.md`、`pilot-runbook.md`、`pilot-report.md` |
| 07 生产、采用与验收交接 | `production-review.md`、`customer-acceptance.md`、`handover-record.md` |
| 08 持续改进与沉淀 | `field-learning-register.md`、`improvement-record.md`、`controlled-release-record.md` |

产物是每个阶段的**最低证据要求**；正文写作质量、客户确认与业务结果仍由 FDE 判断。

### 迁移与回滚

首次读取 schema v1 的 `workbench.json` 时，插件会：

1. 把原文件备份为 `workbench.v1.backup.json`（已存在则不覆盖）；
2. 保留项目标识、名称、阶段备注、证据与旧决定，把旧决定标记为 `legacy`；
3. 每阶段保留原有工作项并补上第 4 个固定工作项；
4. 给现有文档补 v1 版本指针，并创建 `.fde/` 镜像。

迁移失败时不写 v2，保留 v1 与备份。回滚：停用插件，恢复 `workbench.json` 与项目目录备份；v2 新增目录可以保留，v1 不会读取。

## AI 与隐私

- 使用 DSH 当前的 `ctx.llm` 与默认模型；没有模型凭据或提供方时，AI 按钮禁用并说明原因，其余功能照常可用。
- 只有在你点击评估 / 提取 / 归纳 / 起草 / 发送后才会调用模型；一次只允许一个进行中的请求。
- 发送给模型的是**当前操作所选记录**的裁剪文本（上限 200 KB）；提示词与响应不写入 DSH 会话日志，也不写入浏览器存储。
- 评分分数始终由固定权重公式在本地重算；合规为高时最高只能到「需验证」，可复核 ≤2 时直接「暂缓」。
- 记录文本会被当作数据处理，模型被要求不要执行其中可能夹带的指令。

## 交给 DSH 会话

页头「在 DSH 中继续」可以选择整个工作台、当前项目、当前阶段、机会、会议、调研或文档。插件会：

1. 确保数据目录与 `AGENTS.md` 存在；
2. 复用或创建名为「交付工作台」的 Workspace（失败时回退到 `cwd`）；
3. 创建会话并发送首条消息（范围、文件清单、写入规则、人工确认边界）；
4. 打开该会话。agent 只能写 active 项目的当前阶段、固定产物、`.md` 与 `workbench.json`；阶段决定、项目状态与返回仍由人确认。

## 构建与测试

```powershell
cd plugins/fde-workbench
npm install --ignore-scripts     # 只装 Rollup（devDependency，发布时剥离）
node build.mjs                   # src/client -> client.js（提交进仓库）
node tests/run.mjs               # 全部单元、路由、SSR 与冒烟测试
```

`node tests/run.mjs` 在一个进程里跑全部用例。Windows 沙箱会拒绝 `node --test` 为每个文件启动子进程（`spawn EPERM`），因此不使用 `--test`；测试内容相同。构建产物 `client.js` 必须小于 2 MB，且必须包含 `window.__ModuleLoader__.load` 注册。

## 已知限制

- 单用户工作台：同一时刻假定一个活跃标签页；多标签并发以 409 冲突提示，不做自动合并。
- 不做客户端级权限模型；数据目录权限即文件系统权限。
- 不做 Office/PDF 解析与导出；正文是 Markdown，资料库只对文本/Markdown/CSV 做页内预览。
- 甘特图是只读视图；改期在任务表单里完成。
- 运行预览、终端、项目多会话、Skills 与实验室不在本增量内。
- 实验性 DSH 版本（0.2.x alpha）之间服务名可能变化；插件对 `connection` 之外的 AI / 会话 / Workspace 服务都做特性检测并降级。
- `.fde/` 镜像由宿主同步；直接改镜像不会反向更新 `workbench.json`。

## 验证情况

本机已跑通：

| 项目 | 结果 |
| --- | --- |
| 宿主与数据层测试 | `node tests/run.mjs` 共 132 项通过，含阶段合同、决定/返回、任务依赖、资料引用、文档版本、v1→v2 迁移 |
| 构建 | `node build.mjs` 生成 `client.js`（约 338 KB，上限 2 MB） |
| 静态索引 | 生成 3 个插件，含 `@acme-community/fde-workbench@0.2.0`，分类 `productivity`、图标与中英文案 |
| GUI e2e（隔离 profile + 3099 端口） | 创建项目 → 填写 3 份必需产物 → 完成 4 个工作项 → 可评审 → Go 推进 → 返回重评 → 再次 Go → 查看历史只读；创建任务、上传资料、创建文档并保存 v2、归档；截图见 `.dev/verify-backbone/` |
| 助手创建项目 | 在隔离 profile 中点击助手「新建项目」填写并创建，项目立即打开；对话命令由服务端结构化解析为 `project.create` 提案，确认后才写入（单测覆盖解析与服务调用；对话需模型凭据） |
| 旧版浏览器数据迁移 | 预置旧版 `localStorage` 快照后首次打开，导入项目/机会/会议并生成 Markdown；旧键保留 |
| AI 降级 | 无凭据时显示「未配置模型凭据」，AI 徽章切换为「AI 已关闭」且按钮禁用 |
| 本地安装 | `plugin_manager install_bundle` 成功；Loader 条目 `include:fde-workbench` 为 active |

未实跑（本机条件不具备）：

- 有模型凭据时的成功 AI 输出：隔离 profile 没有 API Key，只验证到流式错误与降级；解析与建议应用有单测。
- 从市场索引安装（本机只验证了索引生成与本地 bundle 安装）。

旧插件已归档到 `.dev/legacy-fde-delivery-workbench/`（忽略目录）并从 profile 卸载；`localStorage` 键保留为迁移来源。



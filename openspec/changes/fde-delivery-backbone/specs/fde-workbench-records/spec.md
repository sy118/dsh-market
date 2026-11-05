# Spec Delta: fde-workbench-records

## MODIFIED Requirements

### Requirement: 阶段工作项、证据、阻塞与备注

每个阶段 SHALL 固定包含由阶段定义声明的 4 个工作项和一份阶段备注；用户 SHALL 能更新工作项状态、登记与解决阻塞、添加证据并推进证据状态；固定工作项 MUST NOT 被新增或删除；历史与未开始阶段 MUST 拒绝写入；证据 MAY 引用项目资料库中的来源。

#### Scenario: 完成工作项

- **WHEN** 用户勾选当前阶段的一个固定工作项
- **THEN** 该工作项标记为完成并立即持久化
- **AND** 阶段评审就绪状态按新的完成度重新计算

#### Scenario: 固定工作项不可增删

- **WHEN** 客户端请求新增或删除某阶段的工作项
- **THEN** 宿主返回 400，阶段的工作项集合保持不变

#### Scenario: 证据状态流转

- **WHEN** 用户点击一条证据
- **THEN** 状态按“草稿 → 待验证 → 已验证 → 草稿”循环，并立即持久化

#### Scenario: 登记阻塞

- **WHEN** 用户输入描述并选择严重度
- **THEN** 该阻塞出现在阶段卡片与总览的未解决统计中，标记解决后统计减少

#### Scenario: 向历史阶段写入

- **WHEN** 请求修改非当前阶段的工作项或备注
- **THEN** 宿主拒绝并返回“仅当前阶段可编辑”的错误码，界面显示该原因

#### Scenario: 证据引用来源

- **WHEN** 用户为一条证据选择资料库中的文件
- **THEN** 证据保存该来源标识，并在阶段与资料库之间显示双向跳转

### Requirement: 阶段决定与推进

当前阶段 SHALL 允许记录 Go、Revise、Narrow、Stop 四类决定；Go 仅在阶段评审就绪时前进一个阶段；Revise 与 Narrow 保持当前阶段；Stop 结束项目；每次决定 MUST 保存决定人、理由、证据摘要与 revision；MUST NOT 由 Agent、文件存在或构建结果自动推进。

#### Scenario: Go 需要评审就绪

- **WHEN** 阶段仍有缺失的必需产物、未完成的工作项或未解决的高严重度阻塞
- **THEN** 点击 Go 被拒绝，界面列出具体阻断项，阶段与决定记录不变

#### Scenario: Go 推进一格

- **WHEN** 评审就绪且用户确认 Go
- **THEN** 决定带时间戳、决定人与证据摘要保存，当前阶段前进一格
- **AND** 第八阶段 Go 后项目状态变为 completed 并写入完成时间

#### Scenario: 继续到下一阶段

- **WHEN** 阶段评审就绪，用户确认 Go
- **THEN** 决定带时间戳与证据摘要保存，当前阶段加一，导航与总览同步更新

#### Scenario: 取消继续

- **WHEN** 用户在 Go 的二次确认中取消
- **THEN** 不保存决定、不改变阶段

#### Scenario: 交付后的修订

- **WHEN** 已交付项目的负责人记录 Revise 或 Narrow
- **THEN** 修订被追加到历史，项目保持 completed 状态，阶段不重新打开

#### Scenario: Revise 与 Narrow 留在本阶段

- **WHEN** 用户选择 Revise 或 Narrow 并填写理由
- **THEN** 决定被保存，当前阶段不变，用户可以继续修改工作项、产物与证据

#### Scenario: Stop 结束项目

- **WHEN** 用户选择 Stop 并填写理由
- **THEN** 项目状态变为 stopped，后续阶段推进与返回被拒绝，历史记录保持可读

#### Scenario: 不自动推进

- **WHEN** Agent 创建了全部产物、工作项被勾完或构建成功
- **THEN** 阶段仍停留在当前阶段，等待用户显式作出 Go、Revise、Narrow 或 Stop

### Requirement: 交付文档

工作台 SHALL 支持从内置模板创建交付文档，文档包含模板类型、状态（draft / review / approved / archived）、关联项目与阶段及 Markdown 正文；每次保存正文 SHALL 形成新版本并保留历史；用户 SHALL 能查看版本、恢复旧版本并归档文档。

#### Scenario: 从模板创建

- **WHEN** 用户选择“交付说明”模板并创建文档
- **THEN** 文档以 draft 状态和 v1 正文生成，可立即编辑

#### Scenario: 保存形成版本

- **WHEN** 用户在已有文档上修改正文并保存
- **THEN** 生成新的版本文档，旧版本仍可查看与恢复

#### Scenario: 批准文档

- **WHEN** 用户把文档状态改为 approved
- **THEN** 状态与时间写入记录，文档在阶段证据区显示为已批准

#### Scenario: 恢复旧版本

- **WHEN** 用户选择历史版本并恢复
- **THEN** 当前正文回到该版本内容，并新增一条恢复版本，历史不被改写

#### Scenario: 归档后只读

- **WHEN** 文档状态改为 archived
- **THEN** 正文与版本仍可查看，但保存、恢复与状态变更被拒绝

## ADDED Requirements

### Requirement: 项目元数据与状态

每个项目 SHALL 保存企业、负责人、计划开始日期、计划结束日期、业务背景与状态（active / paused / completed / stopped）；状态变更 MUST 由用户显式操作；计划结束日期早于开始日期 MUST 被拒绝；最后阶段 Go 时 SHALL 自动写入完成时间与 completed 状态。

#### Scenario: 创建带元数据的项目

- **WHEN** 用户填写企业、负责人和计划起止日期并创建项目
- **THEN** 项目保存这些字段，并在项目中心显示交付周期

#### Scenario: 非法日期

- **WHEN** 计划结束日期早于计划开始日期
- **THEN** 创建或编辑被拒绝并返回字段错误，已有项目记录不变

#### Scenario: 暂停与恢复

- **WHEN** 用户将 active 项目暂停，之后再恢复
- **THEN** 状态依次变为 paused 与 active，阶段、产物与证据不受影响

### Requirement: 阶段固定产物

每个阶段 SHALL 声明 3 份必需产物，第一阶段另有 1 份可选产物；产物 MUST 位于项目目录的固定相对路径；宿主 SHALL 按文件是否存在且内容非空报告 present、missing 或 error；用户 SHALL 能在界面创建和编辑产物正文，MUST NOT 通过任意路径写入。

#### Scenario: 创建产物

- **WHEN** 用户打开一份缺失的必需产物并保存非空正文
- **THEN** 该产物状态变为 present，阶段评审条件重新计算

#### Scenario: 空文件不算产物

- **WHEN** 产物文件存在但只包含空白字符
- **THEN** 状态仍为 missing，并显示“内容为空”的原因

#### Scenario: 仅固定路径

- **WHEN** 客户端请求把产物写入阶段定义之外的路径
- **THEN** 宿主返回 400，项目目录不发生写入

#### Scenario: 可选产物不阻断

- **WHEN** 第一阶段的 3 份必需产物已就绪、可选产物缺失
- **THEN** 阶段仍可评审，可选产物显示为未提供

### Requirement: 阶段评审就绪

宿主 SHALL 根据 4 个工作项是否全部完成、3 份必需产物是否 present、以及是否存在未解决的 high 或 critical 阻塞，确定性地计算阶段状态为 working、blocked 或 review-ready；阶段状态 MUST NOT 由用户直接设置，Agent 建议 MUST NOT 改变它。

#### Scenario: 满足评审条件

- **WHEN** 4 个工作项完成、3 份必需产物存在且无高严重度未解决阻塞
- **THEN** 阶段状态为 review-ready，Go 可用

#### Scenario: 高严重度阻塞

- **WHEN** 存在一个未解决的 high 阻塞，其他条件均满足
- **THEN** 阶段状态为 blocked，界面列出该阻塞与责任人，Go 不可用

#### Scenario: 产物缺失

- **WHEN** 工作项完成但缺少一份必需产物
- **THEN** 阶段状态为 working，界面列出缺失产物与固定路径

### Requirement: 阶段返回与重评范围

用户 SHALL 能把项目从当前阶段退回上一阶段，MUST 填写非空原因；返回 MUST 保留全部产物、证据与决定，追加返回记录，并把从目标阶段到原阶段的范围标记为需重新确认；第一阶段的返回与跨多阶段返回 MUST 被拒绝。

#### Scenario: 返回上一阶段

- **WHEN** 用户在第 4 阶段填写原因并确认返回
- **THEN** 当前阶段变为第 3 阶段，返回记录保存原因、时间和 revision
- **AND** 第 3 至第 4 阶段显示“需重新确认”

#### Scenario: 缺少原因

- **WHEN** 用户未填写原因就提交返回
- **THEN** 请求被拒绝，阶段不变

#### Scenario: 保留历史材料

- **WHEN** 返回完成后查看原阶段
- **THEN** 原有的工作项、产物、证据与决定仍可读取，未被删除或覆盖

#### Scenario: 重新确认后继续

- **WHEN** 用户在重评范围内的阶段再次满足评审条件并 Go
- **THEN** 项目回到原阶段，重评范围相应缩小；未重新确认的阶段仍标记为待确认

### Requirement: 项目资料与来源引用

每个项目 SHALL 提供资料库，保存文件名、MIME、大小、SHA-256、版本、相对路径与上传时间；单个文件 MUST 不超过 25 MiB；文本、Markdown 与 CSV SHALL 可预览，其他类型 SHALL 只返回元数据与下载；资料 MUST 留在项目目录内，被引用的资料 MUST NOT 被直接删除。

#### Scenario: 上传与登记

- **WHEN** 用户上传一个 2 MiB 的 PDF
- **THEN** 资料库保存文件与元数据，列表显示名称、大小、哈希与上传时间
- **AND** 预览区说明该类型只支持下载

#### Scenario: 超过大小限制

- **WHEN** 用户上传超过 25 MiB 的文件
- **THEN** 宿主返回 413，资料库与文件系统不发生变化

#### Scenario: 删除被引用资料

- **WHEN** 用户删除一份已被证据引用的资料
- **THEN** 宿主返回 409 并列出引用位置，资料保持可用

#### Scenario: 越界路径

- **WHEN** 客户端请求读取或写入资料目录之外的路径
- **THEN** 宿主返回 400，且不读取或写入目标文件

### Requirement: 项目任务与依赖

每个项目 SHALL 支持任务，包含标题、状态（todo / in_progress / blocked / done / cancelled）、优先级、负责人、起止日期、进度与前置依赖；依赖 MUST 指向同项目的其他任务且 MUST NOT 形成环；存在未完成前置依赖的任务 MUST NOT 被标记为完成；任务中心 SHALL 汇总所有项目的未完成任务。

#### Scenario: 创建任务与依赖

- **WHEN** 用户创建任务 B 并把任务 A 设为前置依赖
- **THEN** 任务 B 保存依赖，列表或甘特图显示 A 到 B 的关系

#### Scenario: 拒绝依赖环

- **WHEN** 用户把 B 设为 A 的前置依赖，而 B 已经依赖 A
- **THEN** 请求被拒绝并指出形成环的任务，依赖关系不变

#### Scenario: 前置未完成

- **WHEN** 任务 A 尚未完成，用户尝试把任务 B 标记为 done
- **THEN** 请求被拒绝，B 保持原状态并列出未完成的前置任务

#### Scenario: 跨项目任务中心

- **WHEN** 用户打开任务中心
- **THEN** 列表汇总所有项目的未完成任务，并显示所属项目、负责人与截止日期

### Requirement: 项目数据目录与 v1 迁移

工作台 SHALL 在数据根目录下为每个项目维护独立的项目目录，包含 `.fde/stages/`、`fde-deliverables/`、`sources/` 与 `documents/`；读取到 schema v1 数据时 SHALL 先备份原文件，再迁移为 v2，保留项目标识、名称、阶段备注、证据、决定与关联记录；迁移 MUST 幂等。

#### Scenario: v1 升级到 v2

- **WHEN** 插件读取到 schemaVersion 1 的 `workbench.json`
- **THEN** 原文件被备份，项目迁移为 v2 目录结构，项目标识、名称与阶段备注保持不变
- **AND** 每个阶段保留原有 3 个工作项，并补上第 4 个固定工作项

#### Scenario: 重复迁移

- **WHEN** 迁移完成后再次读取数据
- **THEN** 不重复迁移、不覆盖迁移后新增的产物或决定，备份文件保持原样

#### Scenario: 未来版本只读

- **WHEN** 数据的 schemaVersion 高于插件支持的版本
- **THEN** 插件以只读模式打开并提示升级插件，MUST NOT 按当前结构改写文件

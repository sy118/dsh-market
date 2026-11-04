# 发布助手（market-publisher）

公司插件市场的第一个插件：它不安界面，只给 agent 装三个工具。装完之后，同事对着 DSH 说一句
「把我的看板发到市场」，agent 就知道该问什么、该跑什么。

| 工具 | 作用 |
|---|---|
| `market_status` | 看发布环境：市场仓库在哪、npm 私库是什么、本机有哪些 Creator 生成的插件 |
| `market_preview` | 预演：会改成什么包名、几个文件、多大、扫描有没有告警（**无副作用**） |
| `market_publish` | 真发布：规范化 → 提交市场仓库 →（配了私库时）`npm publish` → 重建索引 → 推送 |

## 安装

```bash
dsh plugin --profile web add @acme-community/market-publisher
```

装完在 profile 的 `cordis.patch.yml` 里给它填配置（**关键：repoPath 不填它什么也干不了**）：

```yaml
- override:
    - id: '@acme-community/market-publisher:tools'
      config:
        repoPath: 'C:/Users/you/dsh-market'   # 市场仓库的本地 clone
        registry: ''                          # 共用 npm 私库，留空则发 git 源
        author: '张三'
```

改完重启 profile（或等 HMR 重载）。

## 典型对话

```
你：  把我的看板发到市场
Bot：（market_status）找到 1 个：@dsh-local/view-7f3a… ，
     市场仓库 C:/Users/you/dsh-market，私库未配置。
     要按 oncall-board /「值班看板」/ team 发布吗？
你：  行
Bot：（market_preview）改名、8 个文件、1.6 KiB、无敏感串告警。
你：  发
Bot：（market_publish）已发布。索引约 60 秒后刷新。
```

## 为什么不做成按钮

DSH 插件要出界面必须提供已构建的 `./client` 入口（React + 打包链）；而这个插件要干的事
本来就发生在对话里——作者刚跟 agent 一起把插件做出来，顺势说一句就发布，比切页面更自然。
零依赖、零构建，装到任何 profile 里都能跑。

## 前提

- 本机有 `node`（DSH 自带运行时就够）与 `git`；
- 市场仓库已 clone，且 `git push` 能通（SSH key 或 token 二选一）；
- 私库地址配了的话，`npm login --registry <私库>` 过一次。

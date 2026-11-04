# 公司 DSH 插件市场（P0）

同事在**自己的 DSH** 里用 AI 生成"个人工作台"插件，一条命令发布；其他人打开插件页的 **Discover** 就能搜到、装上。

```
创作（DSH 已内置）           发布（本仓库）                     安装（DSH 已内置）
对话 → 卡片 → Creator  ──►  dsh-market publish  ──►  Verdaccio ──►  market-index ──► Discover
生成并装进我的 profile        规范化/扫描/打包/上传      存 tarball       生成 index.json     点安装
```

也可以不走服务器：`catalog.json` + `plugins/` 经 GitHub Actions 生成静态索引，插件直接用 Git commit 安装。

| 组件 | 目录 | 作用 |
|---|---|---|
| 索引服务 | `index/` | 扫 registry，生成并托管 `index.json`（DSH 的 format 1），约 200 行，无框架 |
| 静态索引 | `catalog.json`、`plugins/`、`scripts/build-static-index.mjs` | 从仓库内容生成索引，发布到 GitHub Pages，不需要服务器 |
| 发布 CLI | `cli/` | `login` / `publish` / `list` / `created` / `config` |
| 部署 | `compose.yaml`、`registry/config.yaml` | Verdaccio + index，两个容器一个卷 |
| CI | `.github/workflows/` | `ci` 跑冒烟测试，`pages` 发布静态索引 |
| 冒烟测试 | `scripts/smoke.mjs` | 不开 Docker 也能跑通"规范化 → 打包 → 建索引 → 起服务" |

---

## 1. 部署

两条路，先选一条：

| | **方式 A：索引放 GitHub Pages** | **方式 B：索引 + registry 放服务器** |
|---|---|---|
| 需要服务器 | 不需要 | 一台内网机器 + Docker |
| 插件来源 | 本仓库的 Git commit | 私有 npm 源（Verdaccio） |
| 适合 | 先看效果、插件少、仓库可公开 | 正式使用、插件多、包要私有 |
| 安装速度 | 每次 clone 仓库（小仓库无感） | 下载预构建 tarball，秒级 |
| 发布方式 | 改 `catalog.json` + 提 PR/推送 | `dsh-market publish` |

### 方式 A：索引放 GitHub Pages（零服务器）

索引是**静态文件**，放在 Pages 上就有一个稳定 URL，任何装了 DSH 的机器都能加。插件用 `source.type: "git"` 指回本仓库的某个 commit，安装时不需要任何 registry。

**1）推到 GitHub**（本机已 `git init` 并提交好，只差 remote）：

```sh
cd dsh-market
git remote add origin https://github.com/<owner>/dsh-market.git
git push -u origin main
```

或者在网页上新建空仓库后执行上面两行；`<owner>` 换成你的账号或组织。

**2）打开 Pages**：仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。

**3）等一次 Actions**：`pages` 工作流跑完，索引就在

```
https://<owner>.github.io/dsh-market/index.json
```

打开这个地址旁边的页面 `https://<owner>.github.io/dsh-market/` 能看到目录页（插件列表 + 怎么加索引的说明）。

**4）加进 DSH**：插件页 → 发现 → 管理索引源… → 粘贴上面的 `index.json` 地址。

往目录里加插件：

1. 把插件包放进 `plugins/<name>/`（用 `dsh-market publish --dry-run` 生成的就是这个形态）；
2. 在 `catalog.json` 的 `plugins` 里加一条，`path` 指向它；
3. 推送。工作流会把新 commit 钉进索引里的每个版本。

> Git 源的安装方式是 `git+https://github.com/<owner>/dsh-market.git#<commit>&path:/plugins/<name>`，所以仓库必须是**匿名可读**的。内网私有仓库不适合这条路——用方式 B。

### 方式 B：索引 + registry 部署到你的服务器

前置：一台内网机器，装了 Docker 与 Compose；两个能配给同事访问的域名（或 IP:端口）。

```sh
cp .env.example .env
# 编辑 .env：MARKET_URL 与 NPM_REGISTRY_URL 必须是同事机器能访问到的地址
docker compose up -d --build
```

验证：

```sh
curl http://127.0.0.1:8080/healthz      # {"ok":true,"plugins":0,...}
curl http://127.0.0.1:4873/-/ping       # Verdaccio 存活
```

第一条插件发布后，`curl http://127.0.0.1:8080/index.json` 就能看到 format 1 索引。

**把两个地址发给大家：**

- 索引地址：`${MARKET_URL}/index.json` → 插件页 → Discover → Index sources
- registry 地址：`${NPM_REGISTRY_URL}` → 写进 CLI 的 `login --registry`

### 反代与网络

- 两个服务都**不要**放在 SSO 后面：DSH 抓索引是匿名 GET，安装也是匿名读。
- `index.json` 必须直出、不重定向、1 秒内返回；DSH 的抓取超时是 15 秒。
- 只需要内网/VPN 可达；公网不要暴露。
- 有内部 CA 的话，在反代上终止 TLS，然后把 `.env` 里的两个地址改成 `https://`。

---

## 2. 作者：从"能跑"到"上架"

### 2.1 先在 DSH 里做出来

1. 插件页 → Experimental plugins → 打开 **Personalized recommendations**；
2. 在对话里描述你要的工作台，回答完点卡片 **Create**，选位置（右侧栏 / 会话页签 / 全局页）；
3. 生成后直接生效；不满意继续说，Creator 会改。

产物在 `$DSH_HOME/profiles/<profile>/created-plugins/<uuid>/`，包名是宿主的保留前缀 `@dsh-local/view-<uuid>`。

### 2.2 再发布

```sh
# 直接用仓库里的 CLI（也可以 npm link ./cli 装成全局命令）
node cli/bin/dsh-market.mjs login --registry http://127.0.0.1:4873/

node cli/bin/dsh-market.mjs publish \
  --name oncall-board \
  --title "值班看板" \
  --description "聚合本周值班、告警和待办" \
  --category team
```

不加目录参数时，CLI 自动挑 `created-plugins` 里最新的那个。建议先加 `--dry-run`：它会规范化、扫描、打包，打印将要上传的文件清单，但不发布。

打包需要 `pnpm` 或 `npm`：CLI 自动挑可用的那个（DSH 用户一般两个都有）。

```
Source      ~/.dsh/profiles/web/created-plugins/7f3a1c2e-…
Package     @acme-community/oncall-board@1.0.0
Registry    http://127.0.0.1:4873/
Category    团队协作
Engines     dsh >=0.2.0 <0.3.0

Renamed @dsh-local/view-7f3a1c2e-… → @acme-community/oncall-board in 2 file(s).
Files: 8, source 2.6 KiB
Tarball: … 1.6 KiB, 8 entries
```

发布成功后约 60 秒出现在目录里（索引轮询间隔）。

### 2.3 发布时自动做了什么

| 步骤 | 说明 |
|---|---|
| 改名 | `@dsh-local/view-<uuid>` → `@acme-community/<slug>`；`cordis.patch.yml` 的 row id 与 `name` 同步重写（旧名含 UUID，替换不会误伤） |
| 补声明 | 注入 `engines.dsh`、`author`、`files` 白名单 |
| 补展示 | 生成 `locale/zh.json`、`locale/en.json` 的 `meta.title/description`；没有图标就放默认图标；没有 README 就生成一份 |
| 剥离 | 删除 `scripts`、`devDependencies`、`private`（避免安装时跑脚本） |
| 扫描 | 私钥、`sk-`/`ghp_`/`AKIA`/Slack/Bearer 令牌：**拦截**；邮箱、手机号、内网域名、本机路径：**警告** |
| 限流 | tarball ≤ 5 MiB、文件数 ≤ 300 |

### 2.4 版本

- 同一版本已存在会被拒绝：改 `--version 1.0.1` 再发。
- 想换名字重发：直接改 `--name`，算新包。
- DSH 没有原地升级：别人要更新，是"卸载 → 装新版本"。

> `engines.dsh` 默认写 `>=0.2.0 <0.3.0`。DSH 用 `includePrerelease` 求值，`>=0.2.2` 会**拒绝** `0.2.2-alpha.x` 这类预发布版本——测试版宿主上会显示不兼容。

---

## 3. 同事：怎么装

1. 插件页 → Experimental plugins → 打开 **Custom plugin indexes**；
2. **Plugins → Discover → Index sources** 粘贴 `https://market.acme.internal/index.json`；
3. 在卡片上点安装。

一次配置，之后持续可用。卡片会显示"未审核"标签——插件是以**使用者本人**的权限运行的，发现不对就用第 4 节的下架流程。

> Desktop 和 `dsh web` 的 profile 是分开的：命令行装的插件只出现在 `profiles/web`。全员用 Desktop 时，走应用内插件管理器安装。

---

## 4. 运维

### 下架

编辑 `config/blocklist.json`（目录挂载进 index 容器），加入包名：

```json
{ "blocked": ["@acme-community/bad-plugin"] }
```

60 秒内索引重建，新安装看不到它。DSH 侧索引缓存默认 10 分钟，最迟 10 分钟对所有人生效；已装的用户需要通知卸载（DSH 没有强制卸载通道）。

### 账号

默认允许自助注册（`registry/config.yaml` 的 `max_users`）。上线稳定后建议关掉：

```yaml
max_users: -1
```

再用 `htpasswd` 建账号：

```sh
docker compose exec registry htpasswd -B /verdaccio/storage/htpasswd 张三
```

### 备份

全部状态在 `registry-data` 卷里（tarball + 账号文件）。`docker run --rm -v dsh-market_registry-data:/data ...` 打包即可；索引随时可以从卷重建，不需要单独备份。

### 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 索引 503 | 首次构建还没完成 | 看 `docker compose logs index`；空目录是正常空索引 |
| 某插件不出现 | 缺 `engines.dsh`、镜像太大、校验失败 | `logs index` 里会打印 `skipped <name>: <原因>` |
| 发布报 401/ENEEDAUTH | token 过期或没写进 `.npmrc` | 重新 `login` |
| 发布报版本冲突 | 同版本已存在 | `--version` 升一个 patch |
| 安装时 404 | 索引里 `REGISTRY_URL` 和实际访问地址不一致 | 改 `.env` 的 `NPM_REGISTRY_URL` 后重启 index |
| 同事看不到更新 | 索引缓存 10 分钟 | 等，或在 Discover 里刷新 |

---

## 5. 本地开发与测试

```sh
cd index && npm install --legacy-peer-deps   # 只为索引服务装校验器依赖

node scripts/smoke.mjs                        # 服务端链路
node scripts/build-static-index.mjs           # 生成 public/index.json（GitHub Pages 用）
node scripts/make-demo-plugin.mjs             # 重新生成 plugins/demo-board
```

静态索引在本地也能生成，只要给出仓库地址：

```sh
MARKET_REPO_URL=https://github.com/<owner>/dsh-market \
MARKET_URL=https://<owner>.github.io/dsh-market \
GITHUB_SHA=$(git rev-parse HEAD) \
node scripts/build-static-index.mjs
```

冒烟测试会：规范化 `examples/demo-plugin` → 扫描 → `pnpm pack` → 造一份假的 Verdaccio 存储 → 用官方 `parseMarketIndex` 校验生成的索引 → 起服务并用 HTTP 读回（含 304）→ 验证 blocklist。通过时打印 `SMOKE PASS`。

直接跑索引服务：

```sh
REGISTRY_STORAGE=./.dev/storage SCOPE=@acme-community \
PUBLIC_BASE_URL=http://127.0.0.1:8080 REGISTRY_URL=http://127.0.0.1:4873/ \
node index/src/server.mjs
```

---

## 6. 验证情况（本次交付）

已在本机实际跑通（Node 24.21 / pnpm 11.28 / Verdaccio 5.33）：

| 环节 | 结果 |
|---|---|
| 索引服务 + 冒烟测试 | `SMOKE PASS`：规范化 → 扫描 → 打包 → 假存储 → 官方 `parseMarketIndex` 校验 → HTTP 读回（含 304）→ blocklist |
| 静态索引（方式 A） | `node scripts/build-static-index.mjs` 生成 `public/index.json` 并通过同一校验器；产物含 git 源、commit 锁定、图标内联、目录页 |
| 登录 | `dsh-market login` 对真实 Verdaccio 换取 token，写入 npmrc |
| 发布 | `dsh-market publish` 真实发布到 Verdaccio，产物落盘为 `<storage>/@acme-community/demo-board/{package.json,demo-board-1.0.0.tgz}` |
| 索引 | 索引服务读真实存储，`/index.json` 200，标题/图标/作者/`engines.dsh`/`publishTimestamp` 均正确 |
| 安装 | 空 npmrc（无 token）下 `pnpm add @acme-community/demo-board@1.0.0 --registry …` 成功——匿名读可用 |

**未实跑**：`docker compose up`（本机没有 Docker）、GitHub Actions / Pages 工作流（没有 GitHub 凭据，仓库尚未推送）、以及 Git 源的实际安装（本机沙箱禁止 pnpm 调起 git）。两个服务已在宿主机上跑通；静态索引已用同一校验器验证；工作流只调用已在本地验证过的两条命令。

推送后第一次安装 Git 源插件时，请留意 pnpm 是否能 clone 到仓库——这是唯一一条本机无法替你验证的链路。如果它报 `ENOPKG`/`EPERM` 之类，先用 `git clone` 确认仓库匿名可读，再确认 `source.path` 指向的目录里有 `package.json` 和 `dsh.bundle.patch`。

---

## 7. 已知限制（P0 有意为之）

- **没有详情页**：私有源的包读不到 README（DSH 只从公共 CDN 取 npm 包的文档），卡片只有标题/描述/图标。P1 把源码归档进 Gitea 后，用 `repository` 补上。
- **没有源码归档**：包在作者机器上打包，Git 里没有历史。P1 加"发布即提 PR/推分支"。
- **没有人工评审**：这是你选定的模式。补偿手段是自动扫描、未审核标签、blocklist 下架。
- **不覆盖第三方依赖**：插件的 `dependencies` 由 Verdaccio 的 uplink 代理 npmjs（或内网镜像）解析。
- **索引是静态快照**：轮询 60 秒，DSH 侧再缓存 10 分钟。

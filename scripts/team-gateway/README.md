# Team Gateway — 运营团队多用户部署（方案 A）

一个零依赖 Node 网关 + 每运营人一个 DSH 实例：登录一次，数据天然按人隔离，不改 DSH 内核。

## 架构

```
浏览器 ──登录──> team gateway (:3090) ──按会话路由──> 运营A的 DSH (:3091) ──> A 的 amazon_ops (:8011, 独立 DB)
                                      └─────────────> 运营B的 DSH (:3092) ──> B 的 amazon_ops (:8012, 独立 DB)
```

- 每个运营实例有独立的 `DSH_HOME`（会话日志、凭据）和独立的数据目录（memory.json / scheduler-jobs.json，由启动器渲染的专属 overlay 指定）。
- 网关持有 HMAC 签名的会话 cookie（HttpOnly），HTTP 与 WebSocket 一并转发。
- 上游实例只监听 127.0.0.1，外部只能走网关。
- 定级：**局域网可信团队**用的门禁（单哈希口令 + HMAC cookie），不是互联网级防火墙。

## 三步部署

```sh
# 1. 初始化团队：生成 team.json（网关 :3090 + 每人 DSH 端口 + ops 端口 + 加盐口令哈希）
node scripts/team-gateway/init-team.mjs 'yunying-a:密码A' 'yunying-b:密码B'

# 2. 启动每个运营的两件套（每开一个终端跑一条；首次自动建 home、灌 mock 数据）
node scripts/team-gateway/start-ops.mjs yunying-a       # A 的 amazon_ops :8011（独立 SQLite）
node scripts/team-gateway/start-operator.mjs yunying-a  # A 的 DSH :3091（默认预设=运营A）
node scripts/team-gateway/start-ops.mjs yunying-b       # B 的 amazon_ops :8012
node scripts/team-gateway/start-operator.mjs yunying-b  # B 的 DSH :3092
# 3. 启动网关
node scripts/team-gateway/gateway.mjs
```

## 隔离模型（三层）

| 层 | 机制 | 验证 |
|---|---|---|
| 身份 | 网关登录 → 路由到本人 DSH 实例；实例默认预设绑定本人（新会话自动挂，无需选择） | A 登录新会话预设芯片自动显示"运营A" |
| 记忆/调度 | 每实例独立 home + 数据路径（memory.json / scheduler-jobs.json 在各自 data 目录） | 实测 A/B 记忆互不可见 |
| 业务数据 | 每人一套 amazon_ops（独立端口 + 独立 SQLite + 独立 mock 集），bridge 按人路由 baseUrl | 实测改 B 店 GMV，A 查询纹丝不动 |
| 越界读 | 运营 overlay 禁用 tool-fs/fs-search/str-replace/bash/pwsh——没有任意文件读写工具 | 实测 A 命令读 B 的 memory.json 被拒 |
| 密钥 | team.json（口令哈希/HMAC 密钥）与每人 API key 全部在工作区外（`.dsh-team/`，可用 `DSH_TEAM_HOME` 指定） | 仓库内无密钥文件 |

团队入口 `http://127.0.0.1:3090`，运营人用分配的账号密码登录，即进入各自独立的工作台。

## 前置条件

- 每个实例依赖的共享服务（如 amazon_ops :8001）全局起一份。
- 首次启动需要 `users/credentials.yaml`（`init-team` 会从 fork 的 `.env` 自动生成 DEEPSEEK_API_KEY 模板，每个用户 home 首次创建时复制一份）。
- 端口分配从 3091 起；网关固定 3090（team.json 可改）。

## 文件说明

| 文件 | 作用 |
|---|---|
| `init-team.mjs` | 一次性初始化 team.json（密钥/端口/opsPort/口令哈希）+ 共享凭据模板 |
| `start-ops.mjs` | 启动单个运营的 amazon_ops（独立端口 + 独立 SQLite + 自动灌 mock） |
| `start-operator.mjs` | 启动单个运营实例（建 home、渲染专属 overlay 含 ops 路由、绑定默认预设、spawn dsh web） |
| `gateway.mjs` | 登录网关（会话 cookie 路由 + HTTP/WS 反代 + 身份横幅注入） |
| `team-paths.mjs` | 团队状态路径模块（`.dsh-team/` 在工作区外，`DSH_TEAM_HOME` 可改） |
| `team.cordis.template.yml` | 六插件 overlay 模板（`{{DATA_DIR}}`/`{{OPS_URL}}`/`{{OPS_TOKEN}}` 按用户替换 + 编码工具禁用行） |

运行时状态（team.json、每人 home/data/overlay、ops SQLite）全部在**工作区外**的 `.dsh-team/`，仓库内零密钥。

## 会话级身份（方案 B 机制：agent preset）

除了"一人一实例"（方案 A），平台还支持**单实例多身份**：`start-operator` 会把该运营的**会话预设**安装到其 `DSH_HOME/.agent-presets/<name>`。运营在 Web UI 会话头的预设选择器（默认"标准模式"）选自己名字，该会话即获得：

- **专属长期记忆**：preset 层的 `memory` 行遮蔽全局同名工具，读写指向该运营自己的 `memory.json`（实测：A 与 B 各写一条"隔离测试"，落盘互不可见，共享文件零污染）。
- **专属权限角色**：preset 层的 `rbac` 行遮蔽全局角色（实测：运营B=operator 会话中 `cron_create` 被拒、`memory_write` 放行；运营A=admin 全开）。

预设模板在 `presets/<name>/agent.cordis.yml`（`{{DATA_DIR}}` 按用户渲染）；新运营复制一个目录即可，无专属模板时回退 `presets/_default`。scheduler 保持全局（定时巡检是团队共享资产），会话日志本来就按会话隔离。

方案 A 与 B 可叠加：一人一实例 + 实例内再按会话预设细分角色。

## 已知边界

- 团队入口在服务器本机/局域网；对外暴露请自加 TLS（如 nginx 终结）。
- 口令重置 = 重新跑 `init-team.mjs`（会更换网关密钥，所有人重新登录）。
- 每用户 rbac 角色当前都是 admin；按人收紧角色在 overlay 模板里改 `role` 字段。

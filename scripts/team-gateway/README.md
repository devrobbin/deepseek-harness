# Team Gateway — 运营团队多用户部署（方案 A）

一个零依赖 Node 网关 + 每运营人一个 DSH 实例：登录一次，数据天然按人隔离，不改 DSH 内核。

## 架构

```
浏览器 ──登录──> team gateway (:3090) ──按会话路由──> 运营A的 DSH (:3091, home A)
                                      └─────────────> 运营B的 DSH (:3092, home B)
```

- 每个运营实例有独立的 `DSH_HOME`（会话日志、凭据）和独立的数据目录（memory.json / scheduler-jobs.json，由启动器渲染的专属 overlay 指定）。
- 网关持有 HMAC 签名的会话 cookie（HttpOnly），HTTP 与 WebSocket 一并转发。
- 上游实例只监听 127.0.0.1，外部只能走网关。
- 定级：**局域网可信团队**用的门禁（单哈希口令 + HMAC cookie），不是互联网级防火墙。

## 三步部署

```sh
# 1. 初始化团队：生成 team.json（网关 :3090 + 每人一个端口 + 加盐口令哈希）
node scripts/team-gateway/init-team.mjs 'yunying-a:密码A' 'yunying-b:密码B'

# 2. 启动每个运营实例（每开一个终端跑一条；首次会自动建 home 和专属配置）
node scripts/team-gateway/start-operator.mjs yunying-a
node scripts/team-gateway/start-operator.mjs yunying-b

# 3. 启动网关
node scripts/team-gateway/gateway.mjs
```

团队入口 `http://127.0.0.1:3090`，运营人用分配的账号密码登录，即进入各自独立的工作台。

## 前置条件

- 每个实例依赖的共享服务（如 amazon_ops :8001）全局起一份。
- 首次启动需要 `users/credentials.yaml`（`init-team` 会从 fork 的 `.env` 自动生成 DEEPSEEK_API_KEY 模板，每个用户 home 首次创建时复制一份）。
- 端口分配从 3091 起；网关固定 3090（team.json 可改）。

## 文件说明

| 文件 | 作用 |
|---|---|
| `init-team.mjs` | 一次性初始化 team.json（密钥/端口/口令哈希）+ 共享凭据模板 |
| `start-operator.mjs` | 启动单个运营实例（建 home、渲染专属 overlay、spawn dsh web） |
| `gateway.mjs` | 登录网关（会话 cookie 路由 + HTTP/WS 反代） |
| `team.cordis.template.yml` | 六插件 overlay 模板（`{{DATA_DIR}}` 按用户替换） |
| `team.json` | **gitignored** — 团队配置（含密钥与口令哈希） |
| `users/` | **gitignored** — 每用户的 home / 数据 / overlay |

## 已知边界

- 团队入口在服务器本机/局域网；对外暴露请自加 TLS（如 nginx 终结）。
- 口令重置 = 重新跑 `init-team.mjs`（会更换网关密钥，所有人重新登录）。
- 每用户 rbac 角色当前都是 admin；按人收紧角色在 overlay 模板里改 `role` 字段。

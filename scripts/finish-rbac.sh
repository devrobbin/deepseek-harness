#!/usr/bin/env bash
# rbac 插件收尾一键脚本：安装 → 质量门禁 → 构建 → viewer 验证 → 提交推送
# 用法：bash scripts/finish-rbac.sh
set -euo pipefail
cd "D:/AI-Dev-WorkSpace/DeepSeekHarness"

echo "=== [1/6] pnpm install（注册 rbac workspace）==="
pnpm install

echo "=== [2/6] typecheck rbac ==="
npx tsc -b packages/extensions/rbac

echo "=== [3/6] lint rbac ==="
npx oxlint packages/extensions/rbac/src

echo "=== [4/6] 全量构建 ==="
pnpm run build

echo "=== [5/6] viewer 角色 headless 验证 ==="
# 生成验证专用配置：去掉尚未就绪的 deerflow 块、rbac 角色改为 viewer
awk '/^    - id: deerflow/{exit} {print}' scratch-plugin/cordis.yml \
  | sed 's/role: admin/role: viewer/' > scratch-plugin/.cordis-verify.yml

timeout 150 pnpm dsh --profile headless \
  --patch ./scratch-plugin/.cordis-verify.yml \
  "先用 rbac_whoami 查询当前角色，然后依次尝试：1) 用 cron_create 创建名为test的任务；2) 用 memory_read 读取主题'店铺配置'。报告每一步是被允许还是被拒绝及原因。"

rm -f scratch-plugin/.cordis-verify.yml

echo "=== [6/6] 提交并推送 ==="
git add packages/extensions/rbac/ tsconfig.host.json scratch-plugin/cordis.yml scratch-plugin/cordis-viewer.yml pnpm-lock.yaml
git commit -m "feat(rbac): add role-based tool access control plugin

Enforce admin/operator/viewer tool policies at tools/pre-execute:
- admin: all tools minus the explicit deny list
- operator: denied schedule management, shell/terminal, file mutation,
  arbitrary code, and dynamic plugin mounting
- viewer: read-only allowlist
- rbac_whoami tool reports the active role and checks specific tools" || echo "(无变更或已提交)"
git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=60 push origin master

echo "=== 全部完成 ==="

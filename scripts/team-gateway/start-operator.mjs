/**
 * start-operator — launch one operator's DSH web instance (方案 A).
 *
 * Usage:
 *   node scripts/team-gateway/start-operator.mjs <operator-name>
 *
 * Reads scripts/team-gateway/team.json for the operator's port, then:
 *   1. creates the operator's isolated DSH_HOME (users/<name>/home),
 *   2. writes their credentials.yaml (copied from users/credentials.yaml if
 *      present, else the team-shared one at users/<name>/home is left empty),
 *   3. renders scripts/team-gateway/team.cordis.template.yml into a per-user
 *      overlay with {{DATA_DIR}} pointing at users/<name>/data,
 *   4. spawns `dsh web --port <port> --patch <overlay>` with DSH_HOME set.
 *
 * The gateway (gateway.mjs) must already be running to route to this port.
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { teamJsonPath, operatorDir, usersDir } from './team-paths.mjs'
import { randomUUID } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const name = process.argv[2]
if (!name) {
  console.error('用法: node scripts/team-gateway/start-operator.mjs <运营账号名>')
  process.exit(1)
}

const team = JSON.parse(readFileSync(teamJsonPath, 'utf8'))
const user = team.users.find((u) => u.name === name)
if (user === undefined) {
  console.error(`team.json 里没有账号 "${name}"。已有: ${team.users.map((u) => u.name).join(', ')}`)
  process.exit(1)
}

const opDir = operatorDir(name)
const home = join(opDir, 'home')
const dataDir = join(opDir, 'data')
const overlayPath = join(opDir, 'cordis.overlay.yml')
mkdirSync(home, { recursive: true })
mkdirSync(dataDir, { recursive: true })

// Credentials: one-time copy from the team-shared template when absent.
const homeCredentials = join(home, '.credentials.yaml')
const sharedCredentials = join(usersDir, 'credentials.yaml')
if (!existsSync(homeCredentials) && existsSync(sharedCredentials)) {
  copyFileSync(sharedCredentials, homeCredentials)
  console.log(`[start-operator] 已为 ${name} 复制凭据模板`)
}

// Per-user overlay: shared plugin config with user-scoped data paths and
// the operator's own amazon_ops endpoint (one ops instance per operator).
const template = readFileSync(join(here, 'team.cordis.template.yml'), 'utf8')
const opsUrl = `http://127.0.0.1:${user.opsPort ?? 8001}`
const overlay = template
  .replaceAll('{{DATA_DIR}}', dataDir.replaceAll('\\', '/'))
  .replaceAll('{{OPS_URL}}', opsUrl)
  .replaceAll('{{OPS_TOKEN}}', user.opsToken ?? 'demo-token')
writeFileSync(overlayPath, overlay)

// Bind the operator's own preset as this instance's default (settings.yaml):
// one instance per operator, so the default is per-person by construction —
// a new session mounts the logged-in operator's preset with no manual pick.
const settingsPath = join(home, 'settings.yaml')
let settings = ''
if (existsSync(settingsPath)) {
  settings = readFileSync(settingsPath, 'utf8')
}
if (!/^agent-presets:/m.test(settings)) {
  if (settings.length > 0 && !settings.endsWith('\n')) settings += '\n'
  settings += `agent-presets:\n  default: ${name}\n`
  writeFileSync(settingsPath, settings)
  console.log(`[start-operator] ${name}: 默认预设已绑定为 ${name}`)
}

// Install the operator's session preset ($DSH_HOME/.agent-presets/<name>):
// per-user memory data + rbac role, shadowing the global rows for sessions
// that pick this preset in the web UI. Falls back to presets/_default for
// operators without a dedicated template.
const presetSrc = existsSync(join(here, 'presets', name))
  ? join(here, 'presets', name)
  : join(here, 'presets', '_default')
const presetDst = join(home, '.agent-presets', name)
if (existsSync(presetSrc)) {
  mkdirSync(presetDst, { recursive: true })
  const agentSrc = readFileSync(join(presetSrc, 'agent.cordis.yml'), 'utf8')
  writeFileSync(join(presetDst, 'agent.cordis.yml'), agentSrc.replaceAll('{{DATA_DIR}}', dataDir.replaceAll('\\', '/')))
  const metaSrc = join(presetSrc, 'preset.yml')
  if (existsSync(metaSrc)) {
    const meta = readFileSync(metaSrc, 'utf8').replaceAll('{{NAME}}', name)
    writeFileSync(join(presetDst, 'preset.yml'), meta)
  }
  console.log(`[start-operator] ${name}: 已安装会话预设（UI 预设选择器选"${name}"即启用个人记忆与角色）`)
}

// Pre-seed the repo workspace so the operator's first browser visit lands on
// a ready picker: workspaces otherwise register only when the first session
// is created, but creating one requires picking a workspace first.
const storagesDir = join(home, 'storages')
const workspaceFile = join(storagesDir, 'workspace.json')
if (!existsSync(workspaceFile)) {
  const workspaceId = randomUUID()
  const now = new Date().toISOString()
  mkdirSync(storagesDir, { recursive: true })
  writeFileSync(workspaceFile, JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [] },
    tables: {
      workspaces: {
        [workspaceId]: {
          path: repoRoot,
          title: 'DeepSeekHarness',
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  }, null, 2) + '\n')
  console.log(`[start-operator] ${name}: 已预置工作区 ${repoRoot}`)
}

console.log(`[start-operator] ${name}: home=${home}`)
console.log(`[start-operator] ${name}: overlay=${overlayPath}`)
console.log(`[start-operator] ${name}: 启动 dsh web :${user.port} ...`)

const child = spawn('pnpm', [
  'dsh', 'web',
  // --patch must precede --port: the CLI's positional option parsing rejects
  // --patch once --port <num> has shifted into its value mode.
  '--patch', overlayPath,
  '--port', String(user.port),
], {
  cwd: repoRoot,
  env: { ...process.env, DSH_HOME: home },
  stdio: 'inherit',
  shell: true,
})
child.on('exit', (code) => process.exit(code ?? 0))

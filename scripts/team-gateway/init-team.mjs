/**
 * init-team — generate the team deployment config in one step (方案 A).
 *
 * Usage:
 *   node scripts/team-gateway/init-team.mjs 'name1:password1' 'name2:password2' ...
 *
 * Writes scripts/team-gateway/team.json with:
 *   - a random gateway secret,
 *   - one port per operator (3091, 3092, ...),
 *   - salted SHA-256 password hashes (salt stored alongside).
 * Also writes users/credentials.yaml (the shared credential template copied
 * from every new operator home) when the fork's .env has DEEPSEEK_API_KEY.
 */

import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pairs = process.argv.slice(2)
if (pairs.length === 0) {
  console.error('用法: node scripts/team-gateway/init-team.mjs \'账号:密码\' [更多...]')
  process.exit(1)
}

const salt = randomBytes(8).toString('hex')
const users = pairs.map((pair, i) => {
  const idx = pair.indexOf(':')
  if (idx <= 0) throw new Error(`参数 "${pair}" 不是 账号:密码 形式`)
  const name = pair.slice(0, idx)
  const password = pair.slice(idx + 1)
  return {
    name,
    port: 3091 + i,
    passwordHash: createHash('sha256').update(salt + password).digest('hex'),
  }
})

const team = {
  gatewayPort: 3090,
  salt,
  secret: randomBytes(32).toString('hex'),
  users,
}
writeFileSync(join(here, 'team.json'), JSON.stringify(team, null, 2) + '\n')

// Shared credential template: prefer the fork's .env key so operators can run models.
const envPath = join(here, '..', '..', '.env')
const usersDir = join(here, 'users')
mkdirSync(usersDir, { recursive: true })
const credPath = join(usersDir, 'credentials.yaml')
if (!existsSync(credPath) && existsSync(envPath)) {
  const env = readFileSync(envPath, 'utf8')
  const key = /^DEEPSEEK_API_KEY=(.*)$/m.exec(env)?.[1]?.trim()
  if (key) {
    writeFileSync(credPath, `DEEPSEEK_API_KEY: ${key}\n`)
    console.log(`[init-team] 已写入共享凭据模板 users/credentials.yaml（来自 fork .env）`)
  }
}

console.log(`[init-team] team.json 已生成：网关 :${team.gatewayPort}，账号 ${users.map((u) => `${u.name}→:${u.port}`).join(', ')}`)
console.log('[init-team] 团队入口将是 http://127.0.0.1:3090 ，账号密码即命令行传入值')

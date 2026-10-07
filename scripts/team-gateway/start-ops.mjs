/**
 * start-ops — launch one operator's amazon_ops service (data isolation).
 *
 * Usage:
 *   node scripts/team-gateway/start-ops.mjs <operator-name>
 *
 * Each operator gets their OWN amazon_ops instance: its port (from
 * team.json opsPort), its SQLite file (under the operator's data dir),
 * and its own mock dataset — so ops_overview/orders/inventory answers
 * are per-operator by construction, not just per-operator memory.
 *
 * Requires the deer-flow-fork backend checkout with .venv-lite and
 * amazon_ops_standalone.py (paths via team.json "opsBackend", default
 * D:/ZhiCloud-WorkSpace/deer-flow-fork/backend).
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { teamJsonPath, operatorDir } from './team-paths.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const name = process.argv[2]
if (!name) {
  console.error('用法: node scripts/team-gateway/start-ops.mjs <运营账号名>')
  process.exit(1)
}

const team = JSON.parse(readFileSync(teamJsonPath, 'utf8'))
const user = team.users.find((u) => u.name === name)
if (user === undefined) {
  console.error(`team.json 里没有账号 "${name}"`)
  process.exit(1)
}
if (user.opsPort === undefined) {
  console.error(`账号 ${name} 未配置 opsPort（一人一套 amazon_ops）`)
  process.exit(1)
}

const backend = team.opsBackend ?? 'D:/ZhiCloud-WorkSpace/deer-flow-fork/backend'
const python = join(backend, '.venv-lite', 'Scripts', 'python.exe')
if (!existsSync(python)) {
  console.error(`找不到 venv python: ${python}`)
  process.exit(1)
}

const dataDir = join(operatorDir(name), 'data')
mkdirSync(dataDir, { recursive: true })
const dbPath = join(dataDir, 'amazon_ops.db').replaceAll('\\', '/')
const env = {
  ...process.env,
  AMAZON_OPS_MOCK_ENABLED: '1',
  AMAZON_OPS_DRY_RUN: team.dryRun === false ? '0' : '1',
  AMAZON_OPS_DB_PATH: dbPath,
  AMAZON_OPS_API_TOKEN: user.opsToken ?? 'demo-token',
}

// Seed the operator's own mock dataset once (empty DB → generate 30d data).
const seed = `
import asyncio, os, sys
sys.path.insert(0, ${JSON.stringify(backend.replaceAll('\\', '/'))})
os.environ['AMAZON_OPS_MOCK_ENABLED'] = '1'
os.environ['AMAZON_OPS_DB_PATH'] = ${JSON.stringify(dbPath)}
from amazon_ops.db import init_db, get_connection

async def main():
    await init_db()
    async with get_connection() as conn:
        cur = await conn.execute('SELECT COUNT(*) AS n FROM amazon_campaign')
        row = await cur.fetchone()
    if row['n'] > 0:
        print('数据集已存在，跳过灌数')
        return
    from amazon_ops.mock_data import generate_mock_data
    counts = await generate_mock_data(days=30)
    print('mock 数据已生成:', counts.get('campaigns'), '个活动')

asyncio.run(main())
`
const seedFile = join(dataDir, '_seed_ops_data.py')
writeFileSync(seedFile, seed)
const seedRun = spawn(python, [seedFile], { env, stdio: 'inherit', shell: false })
seedRun.on('exit', (code) => {
  if (code !== 0) {
    console.error('灌数失败，仍尝试启动服务')
  }
  console.log(`[start-ops] ${name}: 启动 amazon_ops :${user.opsPort} (db=${dbPath})`)
  const child = spawn(python, [
    '-m', 'uvicorn', 'amazon_ops_standalone:app',
    '--host', '127.0.0.1', '--port', String(user.opsPort),
  ], {
    cwd: backend,
    env,
    stdio: 'inherit',
    shell: false,
  })
  child.on('exit', (c) => process.exit(c ?? 0))
})

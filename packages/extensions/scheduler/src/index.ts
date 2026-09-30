/**
 * @module @deepseek-ai/dsh-scheduler
 *
 * Global cron scheduler plugin. Persists 5-field cron jobs in a JSON file
 * (survives restarts) and injects the job prompt into a live agent when the
 * schedule fires. Unlike the session-scoped `dsh-schedule`, jobs here are
 * process-global and driven by a wall-clock scan loop.
 *
 * Delivery model: on fire, the scheduler finds a live root agent (or the
 * configured `targetAgentId`) and calls `agent.inject()` — the prompt lands
 * in the next admitted model request. If no live agent exists, the fire is
 * recorded as `missed` (agent.inject never wakes an idle agent).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseCron, cronMatches, type CronFields } from './cron.ts'

export const name = 'scheduler'
export const inject = ['tools', 'agents']

export interface Config {
  /** Path to the JSON file persisting cron jobs (absolute or relative to cwd). */
  dataPath: string
  /** Scan granularity in seconds; default 60. */
  scanIntervalSeconds: number
}

export const Config: Schema<Config> = Schema.object({
  dataPath: Schema.string().default('.dsh-scheduler-jobs.json'),
  scanIntervalSeconds: Schema.number().default(60),
})

interface CronJob {
  id: string
  name: string
  cron: string
  prompt: string
  targetAgentId?: string
  createdAt: string
  lastFiredAt?: string
  lastResult?: string
}

interface Store {
  jobs: CronJob[]
}

function defaultStore(): Store {
  return { jobs: [] }
}

let nextId = 1
function allocateId(): string {
  return `cron-${Date.now().toString(36)}-${(nextId++).toString(36)}`
}

class JobStore {
  constructor(private readonly path: string) {}

  async load(): Promise<Store> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw) as Store
      if (!Array.isArray(parsed.jobs)) return defaultStore()
      return parsed
    } catch {
      return defaultStore()
    }
  }

  async save(store: Store): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(store, null, 2), 'utf8')
  }
}

/** Find the live agent to deliver a fired job to. */
function pickTarget(
  ctx: Context,
  targetAgentId: string | undefined,
): { id: string; inject: (msg: UserMessage) => void } | null {
  const roots = ctx.agents.roots()
  const candidates = targetAgentId
    ? roots.filter(a => a.id === targetAgentId)
    : roots
  const target = candidates[0]
  if (!target) return null
  return { id: target.id, inject: (msg) => { target.inject(msg) } }
}

export function apply(ctx: Context, config: Config) {
  const store = new JobStore(config.dataPath)
  const cache = new Map<string, CronFields>()
  let timer: NodeJS.Timeout | undefined
  let stopped = false

  const loadJobs = async (): Promise<CronJob[]> => {
    const s = await store.load()
    return s.jobs
  }

  const persistJobs = async (jobs: CronJob[]): Promise<void> => {
    await store.save({ jobs })
  }

  const fireJob = async (job: CronJob): Promise<void> => {
    const target = pickTarget(ctx, job.targetAgentId)
    const now = new Date().toISOString()
    if (!target) {
      job.lastFiredAt = now
      job.lastResult = 'missed: no live agent'
      const jobs = await loadJobs()
      const idx = jobs.findIndex(j => j.id === job.id)
      if (idx >= 0) jobs[idx] = job
      await persistJobs(jobs)
      return
    }
    target.inject(createUserMessage({
      content: [
        { type: 'text', text: `[scheduled job "${job.name}"] ${job.prompt}` },
      ],
      source: { kind: 'plugin', plugin: 'scheduler' },
    }))
    job.lastFiredAt = now
    job.lastResult = `injected into ${target.id}`
    const jobs = await loadJobs()
    const idx = jobs.findIndex(j => j.id === job.id)
    if (idx >= 0) jobs[idx] = job
    await persistJobs(jobs)
  }

  /** One scan tick: fire every job whose cron matches the current minute. */
  const scanTick = async (now: Date): Promise<void> => {
    if (stopped) return
    const jobs = await loadJobs()
    for (const job of jobs) {
      let fields = cache.get(job.id)
      if (!fields) {
        try {
          fields = parseCron(job.cron)
          cache.set(job.id, fields)
        } catch (err) {
          job.lastResult = `invalid cron: ${err instanceof Error ? err.message : String(err)}`
          continue
        }
      }
      if (cronMatches(fields, now)) {
        await fireJob(job)
      }
    }
  }

  const startLoop = (): void => {
    const tick = (): void => {
      void scanTick(new Date()).catch(() => {})
      timer = setTimeout(tick, config.scanIntervalSeconds * 1000)
      timer.unref()
    }
    tick()
  }

  // Human/mode-facing tools
  ctx.tools.register(defineTool({
    name: 'cron_create',
    description: '创建一个全局定时任务：到点时把任务提示注入给正在运行的 Agent。cron 为 5 字段表达式（分 时 日 月 周，0=周日），例如 "0 9 * * 1-5" 表示工作日 9 点。',
    parameters: {
      name: { type: 'string', required: true, description: '任务名称' },
      cron: { type: 'string', required: true, description: '5 字段 cron 表达式' },
      prompt: { type: 'string', required: true, description: '到点时注入给 Agent 的任务提示' },
      targetAgentId: { type: 'string', description: '目标 Agent id；缺省投递给第一个 root agent' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          cron: { type: 'string' },
          createdAt: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `定时任务已创建：${value.name}（id: ${value.id}，cron: ${value.cron}）`,
      }],
    },
    async execute(args) {
      // validate cron early so bad expressions fail the tool call
      parseCron(args.cron)
      const job: CronJob = {
        id: allocateId(),
        name: args.name,
        cron: args.cron,
        prompt: args.prompt,
        createdAt: new Date().toISOString(),
        ...(args.targetAgentId ? { targetAgentId: args.targetAgentId } : {}),
      }
      const jobs = await loadJobs()
      jobs.push(job)
      await persistJobs(jobs)
      cache.set(job.id, parseCron(job.cron))
      return {
        id: job.id,
        name: job.name,
        cron: job.cron,
        createdAt: job.createdAt,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cron_list',
    description: '列出所有全局定时任务（含下次触发所需信息、最近触发时间与结果）。',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          description: '一个定时任务',
        },
      },
      render: (_args, value) => {
        const jobs = value as unknown as Array<{
          id?: unknown
          name?: unknown
          cron?: unknown
          createdAt?: unknown
          lastFiredAt?: unknown
          lastResult?: unknown
        }>
        const lines = jobs.map((j, i) => {
          const id = typeof j.id === 'string' ? j.id : '?'
          const name = typeof j.name === 'string' ? j.name : '?'
          const cron = typeof j.cron === 'string' ? j.cron : '?'
          const head = `${i + 1}. 「${name}」 id=${id} cron="${cron}"`
          const fired = typeof j.lastFiredAt === 'string' ? `上次触发 ${j.lastFiredAt}` : '尚未触发'
          const result = typeof j.lastResult === 'string' ? `（${j.lastResult}）` : ''
          return `${head}\n   ${fired}${result}`
        })
        return [{
          type: 'text',
          text: `共 ${jobs.length} 个定时任务${jobs.length > 0 ? `：\n${lines.join('\n')}` : '。'}\n删除任务需要上面列出的确切 id。`,
        }]
      },
    },
    async execute() {
      const jobs = await loadJobs()
      return jobs.map(j => ({
        id: j.id,
        name: j.name,
        cron: j.cron,
        prompt: j.prompt,
        createdAt: j.createdAt,
        ...(j.lastFiredAt ? { lastFiredAt: j.lastFiredAt } : {}),
        ...(j.lastResult ? { lastResult: j.lastResult } : {}),
        ...(j.targetAgentId ? { targetAgentId: j.targetAgentId } : {}),
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cron_delete',
    description: '删除一个全局定时任务。',
    parameters: {
      id: { type: 'string', required: true, description: '任务 id（cron_create 返回）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          deleted: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.deleted ? `已删除定时任务 ${value.id}` : `未找到定时任务 ${value.id}`,
      }],
    },
    async execute(args) {
      const jobs = await loadJobs()
      const before = jobs.length
      const remaining = jobs.filter(j => j.id !== args.id)
      await persistJobs(remaining)
      cache.delete(args.id)
      return { id: args.id, deleted: remaining.length < before }
    },
  }))

  // Scan loop lifecycle: stop on plugin unload
  ctx.effect(() => {
    startLoop()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  })
}

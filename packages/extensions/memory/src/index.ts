/**
 * @module @deepseek-ai/dsh-memory
 *
 * Cross-session long-term memory plugin. Persists topic-organized memory
 * entries to a JSON file so knowledge survives process and session churn:
 * write facts under a topic, read a topic back, search across all entries,
 * and list available topics.
 *
 * This is the DSH counterpart of DeerFlow's memory layer: a simple durable
 * store the model can consult and update across conversations, without a
 * vector database (plain substring search on top of the persisted store).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'memory'
export const inject = ['tools']

export interface Config {
  /** Path to the JSON file persisting memory (absolute or relative to cwd). */
  dataPath: string
}

export const Config: Schema<Config> = Schema.object({
  dataPath: Schema.string().default('.dsh-memory.json'),
})

interface MemoryEntry {
  content: string
  createdAt: string
}

interface MemoryTopic {
  topic: string
  entries: MemoryEntry[]
}

interface MemoryStore {
  topics: MemoryTopic[]
}

function defaultStore(): MemoryStore {
  return { topics: [] }
}

async function loadStore(path: string): Promise<MemoryStore> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as MemoryStore
    if (!Array.isArray(parsed.topics)) return defaultStore()
    return parsed
  } catch {
    return defaultStore()
  }
}

async function saveStore(path: string, store: MemoryStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(store, null, 2), 'utf8')
}

function findTopic(store: MemoryStore, topic: string): MemoryTopic | undefined {
  return store.topics.find(t => t.topic === topic)
}

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: 'memory_write',
    description: '写入一条长期记忆：按主题组织，跨会话持久化。适合记录店铺配置、运营决策、竞品情报、历史经验等需要长期记住的事实。同名主题会追加新条目。',
    parameters: {
      topic: { type: 'string', required: true, description: '记忆主题，如 "店铺配置"、"竞品情报"、"定价策略"' },
      content: { type: 'string', required: true, description: '要记住的内容' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: { type: 'string' },
          entryCount: { type: 'number' },
          createdAt: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已写入主题 "${value.topic}" 的长期记忆（该主题现有 ${value.entryCount} 条记录）。`,
      }],
    },
    async execute(args) {
      const store = await loadStore(config.dataPath)
      let topic = findTopic(store, args.topic)
      if (!topic) {
        topic = { topic: args.topic, entries: [] }
        store.topics.push(topic)
      }
      topic.entries.push({
        content: args.content,
        createdAt: new Date().toISOString(),
      })
      await saveStore(config.dataPath, store)
      return {
        topic: args.topic,
        entryCount: topic.entries.length,
        createdAt: new Date().toISOString(),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_read',
    description: '读取某个主题的全部长期记忆条目（按时间正序）。主题不存在时返回空数组。',
    parameters: {
      topic: { type: 'string', required: true, description: '记忆主题' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          description: '一条记忆：content + createdAt',
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `主题共 ${(value as unknown[]).length} 条记忆。`,
      }],
    },
    async execute(args) {
      const store = await loadStore(config.dataPath)
      const topic = findTopic(store, args.topic)
      if (!topic) return []
      return topic.entries.map(e => ({
        content: e.content,
        createdAt: e.createdAt,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: '在所有主题的长期记忆中全文搜索关键词，返回匹配的主题和条目。用于跨主题回忆相关历史信息。',
    parameters: {
      query: { type: 'string', required: true, description: '搜索关键词' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          description: '匹配结果：topic + content + createdAt',
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `找到 ${(value as unknown[]).length} 条匹配记忆。`,
      }],
    },
    async execute(args) {
      const store = await loadStore(config.dataPath)
      const needle = args.query.toLowerCase()
      const results: Array<{ topic: string; content: string; createdAt: string }> = []
      for (const topic of store.topics) {
        for (const entry of topic.entries) {
          if (entry.content.toLowerCase().includes(needle)) {
            results.push({
              topic: topic.topic,
              content: entry.content,
              createdAt: entry.createdAt,
            })
          }
        }
      }
      return results
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_list',
    description: '列出所有长期记忆主题及其条目数量，便于了解当前已记住哪些领域的知识。',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          description: '一个主题：topic + entryCount',
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `共 ${(value as unknown[]).length} 个记忆主题。`,
      }],
    },
    async execute() {
      const store = await loadStore(config.dataPath)
      return store.topics.map(t => ({
        topic: t.topic,
        entryCount: t.entries.length,
      }))
    },
  }))
}

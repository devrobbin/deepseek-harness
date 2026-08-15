/**
 * @module @deepseek-ai/dsh-amazon-ops-bridge
 *
 * Bridge plugin that exposes the amazon_ops (Amazon e-commerce operations)
 * REST API as model-facing tools on `ctx.tools`.
 *
 * The amazon_ops service runs independently (FastAPI on :8001 by default);
 * this plugin translates tool calls into HTTP requests against its
 * `/api/amazon/*` endpoints and returns the canonical JSON values.
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'amazon-ops-bridge'
export const inject = ['tools']

export interface Config {
  /** Base URL of the amazon_ops service (e.g. http://127.0.0.1:8001) */
  baseUrl: string
  /** Serve canned responses instead of calling the service (for testing) */
  mock: boolean
}

export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:8001'),
  mock: Schema.boolean().default(false),
})

/** Shape of a campaign diagnosis row returned by /ads/quantitative */
interface CampaignDiagnosis {
  campaign_id?: unknown
  campaign_name?: unknown
  observed_acos?: unknown
  waste_type?: unknown
  verdict?: unknown
  avoidable_spend?: unknown
}

async function getJson(baseUrl: string, path: string, timeoutMs = 30_000): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`amazon_ops ${res.status} on ${path}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: 'ads_acos_quantitative',
    description: '获取亚马逊广告 ACOS 定量诊断报告：返回目标 ACOS、盈亏平衡 ACOS、各广告活动诊断（浪费类型、可避免花费、竞价建议）和投放位诊断。',
    parameters: {
      days: {
        type: 'number',
        description: '统计窗口天数，1-90，默认 30',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          days: { type: 'number' },
          thresholds: {
            type: 'object',
            additionalProperties: true,
            description: '目标/盈亏平衡 ACOS、CPA、转化率等阈值',
          },
          campaigns: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              description: '广告活动级诊断：浪费类型、可避免花费、竞价建议',
            },
          },
          placements: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              description: '投放位级诊断',
            },
          },
        },
      },
      render: (_args, value) => {
        const t = value.thresholds ?? {}
        const campaigns = (value.campaigns ?? []) as CampaignDiagnosis[]
        const wasted = campaigns.filter(c => asNumber(c.avoidable_spend) != null).length
        const totalWaste = campaigns.reduce(
          (sum, c) => sum + (asNumber(c.avoidable_spend) ?? 0),
          0,
        )
        const breakeven = asNumber(t.breakeven_acos)
        const target = asNumber(t.target_acos)
        const pct = breakeven != null ? (breakeven * 100).toFixed(1) : 'N/A'
        const tgt = target != null ? (target * 100).toFixed(1) : 'N/A'
        return [{
          type: 'text',
          text: `近 ${value.days} 天 ACOS 定量诊断：盈亏平衡 ${pct}%，目标 ${tgt}%；${campaigns.length} 个广告活动中 ${wasted} 个存在可避免花费，合计 $${totalWaste.toFixed(2)}。`,
        }]
      },
    },
    async execute(args) {
      if (config.mock) {
        const result: JsonValue = {
          days: args.days ?? 30,
          thresholds: { target_acos: 0.25, breakeven_acos: 0.30 },
          campaigns: [
            {
              campaign_id: 'MOCK-001',
              campaign_name: 'SP-自动-核心词',
              observed_acos: 0.38,
              waste_type: 'CONVERTING_OVER_TARGET',
              verdict: 'OPTIMIZE',
              avoidable_spend: 126.5,
              bid_draft: { current_bid: 1.2, suggested_bid: 0.95, step_guardrail_pct: 20 },
            },
          ],
          placements: [],
        }
        return result
      }
      const days = args.days ?? 30
      const data = await getJson(config.baseUrl, `/api/amazon/ads/quantitative?days=${days}`)
      // HTTP JSON 是动态结构；schema 只约束最小形状，此处断言到推断类型
      return data as {
        days?: number
        thresholds?: Record<string, JsonValue>
        campaigns?: Record<string, JsonValue>[]
        placements?: Record<string, JsonValue>[]
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'hello',
    description: '向一个人问好。用于验证插件工具链路。',
    parameters: {
      name: { type: 'string', required: true, description: '名字' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      return Promise.resolve(`Hello, ${args.name}!`)
    },
  }))
}

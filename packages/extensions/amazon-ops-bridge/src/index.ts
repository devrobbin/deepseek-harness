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

async function getJson(baseUrl: string, path: string, timeoutMs = 30_000): Promise<Record<string, JsonValue>> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`amazon_ops ${res.status} on ${path}: ${body.slice(0, 300)}`)
  }
  return await res.json() as Record<string, JsonValue>
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/** 数值字段安全读取（缺失/非数回退 0），用于 render 摘要。 */
function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

/** 字符串字段安全读取（缺失回退 '?'），用于 render 摘要。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '?'
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
    name: 'ops_overview',
    description: '获取店铺运营总览：今日订单、近30天GMV、待处理订单、库存总量、在途入库量、低库存SKU数。适合日报开头或快速体检。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        description: '运营总览指标：today_orders、gmv_30d、pending_orders、total_inventory_units、inbound_units、low_stock_count',
      },
      render: (_args, value) => {
        const v = value as Record<string, unknown>
        return [{
          type: 'text',
          text: `运营总览：今日订单 ${num(v.today_orders)} 单，近30天 GMV $${num(v.gmv_30d).toFixed(2)}，待处理 ${num(v.pending_orders)} 单；库存 ${num(v.total_inventory_units)} 件（在途 ${num(v.inbound_units)}），低库存 SKU ${num(v.low_stock_count)} 个。`,
        }]
      },
    },
    async execute() {
      return await getJson(config.baseUrl, '/api/amazon/ops/overview')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ops_orders',
    description: '查询订单列表（分页）：返回订单号、站点、日期、状态、金额、ASIN/SKU，并附各状态订单统计。可按站点和状态过滤。',
    parameters: {
      marketplace: { type: 'string', description: '站点过滤，如 US；缺省 all' },
      status: { type: 'string', description: '状态过滤：Pending|Shipped|Delivered|Canceled|Refunded|Returned；缺省 all' },
      page: { type: 'number', description: '页码，默认 1' },
      page_size: { type: 'number', description: '每页条数，1-100，默认 20' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'orders[]、total、page、page_size、stats（状态统计与今日汇总）',
      },
      render: (_args, value) => {
        const v = value as Record<string, unknown>
        const orders = (v.orders ?? []) as Record<string, unknown>[]
        const preview = orders.slice(0, 5).map((o, i) =>
          `${i + 1}. ${str(o.order_id)} ${str(o.status)} $${num(o.total_amount)} ${str(o.asin)}`).join('\n')
        return [{
          type: 'text',
          text: `订单共 ${num(v.total)} 笔（本页 ${orders.length} 笔）。${orders.length > 0 ? `\n${preview}` : ''}`,
        }]
      },
    },
    async execute(args) {
      const qs = new URLSearchParams()
      if (args.marketplace) qs.set('marketplace', args.marketplace)
      if (args.status) qs.set('status', args.status)
      if (args.page) qs.set('page', String(args.page))
      if (args.page_size) qs.set('page_size', String(args.page_size))
      const q = qs.toString()
      return await getJson(config.baseUrl, `/api/amazon/ops/orders${q ? `?${q}` : ''}`)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ops_inventory',
    description: '查询库存视图：每个 ASIN 的名称、品类、价格、FBA 可售/在途/预留量与日均销量，用于缺货与滞销判断。',
    parameters: {
      marketplace: { type: 'string', description: '站点过滤，如 US；缺省 all' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'inventory[]：asin、name、category、price、fba_available、fba_inbound、fba_reserved、daily_sales_avg',
      },
      render: (_args, value) => {
        const v = value as Record<string, unknown>
        const items = (v.inventory ?? []) as Record<string, unknown>[]
        const rows = items.map((i) => {
          const avail = num(i.fba_available)
          const daily = num(i.daily_sales_avg)
          const days = daily > 0 ? avail / daily : Infinity
          const flag = days < 14 ? ' ⚠️可售<14天' : avail <= 20 ? ' ⚠️低库存' : ''
          return `${str(i.asin)} ${str(i.name)}｜可售 ${avail} 件，日均 ${daily}，可售 ${days === Infinity ? '∞' : days.toFixed(1)} 天${flag}`
        })
        return [{
          type: 'text',
          text: `库存 SKU ${items.length} 个：\n${rows.join('\n')}`,
        }]
      },
    },
    async execute(args) {
      const q = args.marketplace ? `?marketplace=${encodeURIComponent(args.marketplace)}` : ''
      return await getJson(config.baseUrl, `/api/amazon/ops/inventory${q}`)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ops_replenishment',
    description: '查询补货计划：每个 ASIN 的前置天数、未来 30/60/90 天销量预测与库存快照，用于备货决策。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'plans[]：asin、marketplace、snapshot_date、lead_days、daily_sales_avg、forecast_30d/60d/90d',
      },
      render: (_args, value) => {
        const v = value as Record<string, unknown>
        const plans = (v.plans ?? []) as Record<string, unknown>[]
        const rows = plans.map(p =>
          `${str(p.asin)}｜前置 ${num(p.lead_days)} 天，未来30天预测 ${num(p.forecast_30d)} 件，60天 ${num(p.forecast_60d)} 件，90天 ${num(p.forecast_90d)} 件`)
        return [{
          type: 'text',
          text: `补货计划覆盖 ${plans.length} 个 ASIN：\n${rows.join('\n')}`,
        }]
      },
    },
    async execute() {
      return await getJson(config.baseUrl, '/api/amazon/replenishment')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'listings_stats',
    description: '查询 Listing 质量统计：总数、各状态分布、各站点分布、平均质量分与高分数量，用于 Listing 体检。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'total、by_status、by_marketplace、avg_quality、high_quality',
      },
      render: (_args, value) => {
        const v = value as Record<string, unknown>
        return [{
          type: 'text',
          text: `Listing 共 ${num(v.total)} 条，平均质量分 ${num(v.avg_quality)}，高分 ${num(v.high_quality)} 条。`,
        }]
      },
    },
    async execute() {
      return await getJson(config.baseUrl, '/api/amazon/listings/stats')
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

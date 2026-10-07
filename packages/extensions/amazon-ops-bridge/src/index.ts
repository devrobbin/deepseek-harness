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
  /** Bearer token for state-changing amazon_ops endpoints (standalone deployments gate writes with it) */
  apiToken: string
}

export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:8001'),
  mock: Schema.boolean().default(false),
  apiToken: Schema.string().default('demo-token'),
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

/** POST JSON 到 amazon_ops（带 Bearer 认证；写端点由独立部署的 token 门禁把关）。 */
async function postJson(
  baseUrl: string,
  apiToken: string,
  path: string,
  body?: Record<string, JsonValue>,
): Promise<Record<string, JsonValue>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`amazon_ops ${res.status} on ${path}: ${text.slice(0, 300)}`)
  }
  return await res.json() as Record<string, JsonValue>
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
    name: 'approvals_list',
    description: '列出运营建议（审批队列）：每条含 id、类型（调价/暂停/零订单处理）、严重度、目标活动、当前状态（draft→pending→approved→pending_confirmation→applied→rolled_back / rejected→failed）与说明。需要人工批准或拒绝时用 approvals_act。',
    parameters: {
      status: { type: 'string', description: '状态过滤：draft|pending|approved|pending_confirmation|applied|rolled_back|rejected|failed；缺省全部' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          description: '一条运营建议：id、type、severity、campaign_id、message、params、status、created_at',
        },
      },
      render: (_args, value) => {
        const items = value as Record<string, unknown>[]
        const rows = items.map(r =>
          `#${num(r.id)} [${str(r.status)}] ${str(r.type)}（${str(r.severity)}）｜${str(r.message).slice(0, 90)}`)
        return [{
          type: 'text',
          text: `共 ${items.length} 条建议：\n${rows.join('\n')}`,
        }]
      },
    },
    async execute(args) {
      const q = args.status ? `?status=${encodeURIComponent(args.status)}` : ''
      const data = await getJson(config.baseUrl, `/api/amazon/recommendations${q}`)
      return (data.recommendations ?? []) as Record<string, JsonValue>[]
    },
  }))

  ctx.tools.register(defineTool({
    name: 'approvals_generate',
    description: '从最近的 ACOS 定量诊断生成一批可审批的运营建议（如下调超支活动竞价、暂停零订单活动）。生成后进入 pending 状态等待人工批准，不会直接改动广告。',
    parameters: {
      days: { type: 'number', description: '诊断窗口天数，默认 30' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'days、created、recommendation_ids、drafted',
      },
      render: (_args, value) => {
        const v = value as Record<string, unknown>
        const ids = (v.recommendation_ids ?? []) as unknown[]
        return [{
          type: 'text',
          text: `已生成 ${num(v.created)} 条待审批建议（id: ${ids.join(', ')}），状态 pending，等待人工批准。`,
        }]
      },
    },
    async execute(args) {
      return await postJson(config.baseUrl, config.apiToken,
        `/api/amazon/ads/quantitative/recommend?days=${args.days ?? 30}`)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'approvals_act',
    description: '对一条运营建议执行审批动作。状态机：approve（批准；低风险直接执行 applied，调价类转 pending_confirmation 等二次确认）→ confirm（二次确认后执行）→ rollback（回滚窗口内恢复原状）；reject（拒绝，附理由）。资金敏感操作，执行前必须向用户复述将改什么并获得确认。',
    parameters: {
      rec_id: { type: 'number', required: true, description: '建议 id（approvals_list 返回）' },
      action: {
        type: 'string',
        required: true,
        enum: ['approve', 'reject', 'confirm', 'rollback'],
        description: 'approve=批准；confirm=二次确认执行（仅调价类）；rollback=回滚；reject=拒绝',
      },
      reason: { type: 'string', description: '拒绝理由（reject 时建议填写）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'ok、status',
      },
      render: (_args, value) => {
        const v = value as Record<string, unknown>
        const ok = v.ok === true
        return [{
          type: 'text',
          text: ok
            ? `操作成功，建议状态 → ${str(v.status) || '已处理'}。`
            : `操作未生效（${str(v.status) || '状态不满足'}）。检查建议当前状态后重试。`,
        }]
      },
    },
    async execute(args) {
      const body = args.reason ? { reason: args.reason } : undefined
      return await postJson(config.baseUrl, config.apiToken,
        `/api/amazon/recommendations/${args.rec_id}/${args.action}`, body)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'reviews_overview',
    description: '查询口碑（评论）概览：评论总数、各状态/分类/紧急度分布、平均评分，以及近 N 天的按日趋势与分类汇总。用于差评激增监测与口碑体检。',
    parameters: {
      days: { type: 'number', description: '趋势窗口天数，7-90，默认 30' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stats: {
            type: 'object',
            additionalProperties: true,
            description: '总数、状态/分类/紧急度分布、平均评分',
          },
          trend: {
            type: 'object',
            additionalProperties: true,
            description: '按日趋势与分类/紧急度汇总',
          },
        },
      },
      render: (args, value) => {
        const stats = (value.stats ?? {}) as Record<string, unknown>
        const trend = (value.trend ?? {}) as Record<string, unknown>
        const byDate = (trend.by_date ?? []) as unknown[]
        const avg = num(stats.avg_rating)
        return [{
          type: 'text',
          text: `口碑概览：评论共 ${num(stats.total)} 条，平均评分 ${avg.toFixed(1)}；趋势窗口 ${args.days ?? 30} 天（by_date ${byDate.length} 天数据，分类/紧急度汇总见 JSON）。`,
        }]
      },
    },
    async execute(args) {
      const days = args.days ?? 30
      const [stats, trend] = await Promise.all([
        getJson(config.baseUrl, '/api/amazon/reviews/stats'),
        getJson(config.baseUrl, `/api/amazon/reviews/trend?days=${days}`),
      ])
      return { stats, trend }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'competitors_snapshot',
    description: '查询竞品监控快照：竞品列表（价格/排名/评论数等追踪指标）、统计汇总与竞品告警。用于竞品价格与动态监测。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'competitors[]、stats、alerts',
      },
      render: (_args, value) => {
        const v = value as Record<string, unknown>
        const comps = (v.competitors ?? []) as Record<string, unknown>[]
        const alerts = (v.alerts ?? []) as Record<string, unknown>[]
        return [{
          type: 'text',
          text: `竞品 ${num(v.total)} 个，告警 ${alerts.length} 条。${comps.length > 0 ? `追踪中：${comps.slice(0, 5).map(c => str(c.name ?? c.competitor_id ?? c.asin)).join('、')}${comps.length > 5 ? ' 等' : ''}。` : ''}`,
        }]
      },
    },
    async execute() {
      const [list, stats, alerts] = await Promise.all([
        getJson(config.baseUrl, '/api/amazon/competitors'),
        getJson(config.baseUrl, '/api/amazon/competitors/stats'),
        getJson(config.baseUrl, '/api/amazon/competitors/alerts'),
      ])
      return { ...list, stats, alerts }
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

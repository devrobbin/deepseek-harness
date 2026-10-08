/**
 * Operations cockpit view: a conversation tab (next to 对话/轨迹) that gives
 * the logged-in operator a store dashboard without typing — KPI cards, ACOS
 * diagnosis table, stock-out risks, and a clickable approval queue.
 *
 * All data flows through the team gateway's same-origin proxies:
 * GET /__tg/ops/api/amazon/* (Bearer injected server-side; the browser never
 * sees tokens) and GET /__tg/whoami (admin flag gates the action buttons).
 */

import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the conversation.view seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './OpsDashboardView.module.css'

/** View seat props: runtime share + the cockpit dictionaries. */
export type OpsDashboardProps = PropsRuntime<'conversation.view'> & PropsLocale<'opsDashboard'>

const OPS = '/__tg/ops/api/amazon'

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '?'
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return await res.json() as Record<string, unknown>
}

function daysOf(item: Record<string, unknown>): number {
  const daily = num(item.daily_sales_avg)
  if (daily <= 0) return Number.POSITIVE_INFINITY
  return num(item.fba_available) / daily
}

function actionsFor(status: unknown): ActionKey[] {
  if (status === 'pending') return ['act.approve', 'act.reject']
  if (status === 'approved' || status === 'pending_confirmation') return ['act.confirm', 'act.reject']
  if (status === 'applied') return ['act.rollback']
  return []
}

/** The four approval-action labels; each maps to a gateway POST verb. */
type ActionKey = 'act.approve' | 'act.confirm' | 'act.rollback' | 'act.reject'

const ACTION_OF: Record<ActionKey, string> = {
  'act.approve': 'approve',
  'act.confirm': 'confirm',
  'act.rollback': 'rollback',
  'act.reject': 'reject',
}

/**
 * Cockpit tab body. Loads the operator's own store data on mount and on
 * demand; approval actions POST through the gateway (which enforces the
 * admin gate server-side) and reload the queue.
 */
export function OpsDashboardView({ t }: OpsDashboardProps) {
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null)
  const [acos, setAcos] = useState<Record<string, unknown> | null>(null)
  const [recs, setRecs] = useState<Record<string, unknown>[]>([])
  const [inventory, setInventory] = useState<Record<string, unknown>[]>([])
  const [admin, setAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [trend, setTrend] = useState<Record<string, unknown>[]>([])
  const [competitors, setCompetitors] = useState<Record<string, unknown>[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [ov, ac, rc, inv, tr, co, who] = await Promise.all([
        getJson(`${OPS}/ops/overview`),
        getJson(`${OPS}/ads/quantitative?days=30`),
        getJson(`${OPS}/recommendations`),
        getJson(`${OPS}/ops/inventory`),
        getJson(`${OPS}/reviews/trend?days=30`),
        getJson(`${OPS}/competitors/alerts`),
        getJson('/__tg/whoami'),
      ])
      setOverview(ov)
      setAcos(ac)
      setRecs((rc.recommendations ?? []) as Record<string, unknown>[])
      setInventory((inv.inventory ?? []) as Record<string, unknown>[])
      setTrend((tr.by_date ?? []) as Record<string, unknown>[])
      setCompetitors((co.alerts ?? []) as Record<string, unknown>[])
      setAdmin(who.admin === true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (id: unknown, label: ActionKey): Promise<void> => {
    const action = ACTION_OF[label]
    setBusy(`${String(id)}:${action}`)
    setNotice(null)
    try {
      const res = await fetch(`${OPS}/recommendations/${String(id)}/${action}`, { method: 'POST' })
      const data = await res.json() as Record<string, unknown>
      setNotice(data.ok === true ? `${t('act.done')} → ${str(data.status)}` : t('act.failed'))
      await load()
    } catch {
      setNotice(t('act.failed'))
    }
    setBusy(null)
  }

  const toggleSelect = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const batchApprove = async (): Promise<void> => {
    const ids = [...selected]
    if (ids.length === 0) return
    setBusy('batch')
    setNotice(null)
    let okCount = 0
    for (const id of ids) {
      try {
        const res = await fetch(`${OPS}/recommendations/${id}/approve`, { method: 'POST' })
        const data = await res.json() as Record<string, unknown>
        if (data.ok === true) okCount += 1
      } catch {
        /* per-row failure surfaces in the reloaded queue */
      }
    }
    setNotice(`${t('act.done')} ${okCount}/${ids.length}`)
    setSelected(new Set())
    await load()
    setBusy(null)
  }

  const exportReport = (): void => {
    const today = new Date().toISOString().slice(0, 10)
    const lines: string[] = [
      `# 运营日报 ${today}`,
      '',
      '## 一、经营总览',
      `- 今日订单：${num(overview?.today_orders)}`,
      `- 近30天 GMV：$${num(overview?.gmv_30d).toFixed(2)}`,
      `- 待处理订单：${num(overview?.pending_orders)}`,
      `- 库存总量：${num(overview?.total_inventory_units)} 件（在途 ${num(overview?.inbound_units)}）`,
      `- 低库存 SKU：${num(overview?.low_stock_count)}`,
      '',
      '## 二、广告 ACOS 诊断',
      `- 目标 ACOS：${pct(thresholds.target_acos)}% / 盈亏平衡：${pct(thresholds.breakeven_acos)}%`,
      `- 可避免浪费合计：$${totalWaste.toFixed(2)}（${campaigns.filter(c => num(c.avoidable_spend) > 0).length}/${campaigns.length} 个活动）`,
      '',
      '| 活动 | 判定 | 浪费类型 | 可避免花费 |',
      '|---|---|---|---|',
      ...campaigns.slice(0, 10).map(c =>
        `| ${str(c.campaign_name)} | ${str(c.verdict)} | ${str(c.waste_type)} | $${num(c.avoidable_spend).toFixed(2)} |`),
      '',
      '## 三、库存与补货风险（可售天数 <14）',
      '',
      '| ASIN | 名称 | 可售 | 日均 | 可售天数 |',
      '|---|---|---|---|---|',
      ...(risky.length > 0
        ? risky.map(i => `| ${str(i.asin)} | ${str(i.name)} | ${num(i.fba_available)} | ${num(i.daily_sales_avg).toFixed(1)} | ${daysOf(i).toFixed(1)} |`)
        : ['| （无） | | | | |']),
      '',
      '## 四、竞品告警',
      '',
      ...(competitors.length > 0
        ? competitors.map(a => `- ${str(a.asin)} ${str(a.name)}：${str(a.type)}（7天价格 ${num(a.price_delta_7d).toFixed(1)}%，评论增长 ${num(a.review_growth_7d).toFixed(1)}%）`)
        : ['- （无告警）']),
      '',
      '## 五、审批队列',
      '',
      ...(recs.length > 0
        ? recs.map(r => `- #${num(r.id)} [${str(r.status)}] ${str(r.type)}（${str(r.severity)}）：${str(r.message).slice(0, 80)}`)
        : ['- （队列为空）']),
      '',
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${today}-运营日报.md`
    a.click()
    URL.revokeObjectURL(a.href)
    setNotice(t('export.done'))
  }

  const thresholds = (acos?.thresholds ?? {}) as Record<string, unknown>
  const campaigns = ((acos?.campaigns ?? []) as Record<string, unknown>[])
    .slice()
    .sort((a, b) => num(b.avoidable_spend) - num(a.avoidable_spend))
  const totalWaste = campaigns.reduce((s, c) => s + num(c.avoidable_spend), 0)
  const risky = inventory.filter(i => daysOf(i) < 14).slice(0, 8)
  const pct = (v: unknown): string => (num(v) * 100).toFixed(1)

  if (loading && overview === null) {
    return <div className={css.page}>{t('loading')}</div>
  }
  if (error !== null && overview === null) {
    return (
      <div className={css.page}>
        <span className={css.error}>{t('error')}: {error}</span>
        <button type="button" className={css.btn} onClick={() => { void load() }}>{t('refresh')}</button>
      </div>
    )
  }

  return (
    <div className={css.page}>
      <div className={css.toolbar}>
        <button type="button" className={css.btn} onClick={() => { void load() }}>{t('refresh')}</button>
        <button type="button" className={css.btn} onClick={exportReport}>{t('export.report')}</button>
        {notice !== null && <span className={css.notice}>{notice}</span>}
        {!admin && <span className={css.hint}>{t('adminOnly')}</span>}
      </div>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('section.kpi')}</h3>
        <div className={css.kpis}>
          <div className={css.kpi}><span>{t('kpi.todayOrders')}</span><b>{num(overview?.today_orders)}</b></div>
          <div className={css.kpi}><span>{t('kpi.gmv30d')}</span><b>${num(overview?.gmv_30d).toFixed(2)}</b></div>
          <div className={css.kpi}><span>{t('kpi.pendingOrders')}</span><b>{num(overview?.pending_orders)}</b></div>
          <div className={css.kpi}><span>{t('kpi.inventory')}</span><b>{num(overview?.total_inventory_units)}</b></div>
          <div className={css.kpi}><span>{t('kpi.lowStock')}</span><b>{num(overview?.low_stock_count)}</b></div>
        </div>
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>
          {t('section.acos')}
          {' · '}
          {t('acos.target')}
          {' '}{pct(thresholds.target_acos)}% / {t('acos.breakeven')} {pct(thresholds.breakeven_acos)}% / {t('acos.waste')} ${totalWaste.toFixed(2)}
        </h3>
        <table className={css.table}>
          <thead>
            <tr><th>活动</th><th>判定</th><th>浪费类型</th><th>可避免花费</th></tr>
          </thead>
          <tbody>
            {campaigns.slice(0, 8).map(c => (
              <tr key={str(c.campaign_id)}>
                <td>{str(c.campaign_name)}</td>
                <td>{str(c.verdict)}</td>
                <td>{str(c.waste_type)}</td>
                <td className={num(c.avoidable_spend) > 0 ? css.warn : undefined}>${num(c.avoidable_spend).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('section.stock')}（{t('stock.risk')} &lt;14 {t('stock.days')}）</h3>
        <table className={css.table}>
          <thead>
            <tr><th>ASIN</th><th>名称</th><th>可售</th><th>日均</th><th>可售天数</th></tr>
          </thead>
          <tbody>
            {risky.map(i => (
              <tr key={str(i.asin)}>
                <td>{str(i.asin)}</td>
                <td>{str(i.name)}</td>
                <td>{num(i.fba_available)}</td>
                <td>{num(i.daily_sales_avg).toFixed(1)}</td>
                <td className={css.warn}>{daysOf(i).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('section.trend')}</h3>
        {trend.length === 0 ? (
          <span className={css.trendMeta}>{t('empty')}</span>
        ) : (
          <>
            <div className={css.trendChart}>
              {trend.map((d) => {
                const h = Math.max(4, Math.min(100, num(d.count) * 8))
                const hot = num(d.high_urgency) > 0
                return (
                  <div
                    key={str(d.date)}
                    className={hot ? `${css.trendBar} ${css.trendBarHot}` : css.trendBar}
                    style={{ height: `${h}%` }}
                    title={`${str(d.date)} · ${num(d.count)} ${t('trend.count')} · ${t('trend.avgRating')} ${num(d.avg_rating).toFixed(1)}`}
                  />
                )
              })}
            </div>
            <div className={css.trendMeta}>
              <span>{str(trend[0]?.date ?? '')} → {str(trend[trend.length - 1]?.date ?? '')}</span>
              <span>{t('trend.count')}: {trend.reduce((sum, d) => sum + num(d.count), 0)}</span>
              <span>{t('trend.avgRating')}: {(trend.reduce((sum, d) => sum + num(d.avg_rating) * num(d.count), 0) / Math.max(1, trend.reduce((sum, d) => sum + num(d.count), 0))).toFixed(2)}</span>
            </div>
          </>
        )}
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('section.competitors')}</h3>
        {competitors.length === 0 ? (
          <span className={css.trendMeta}>{t('empty')}</span>
        ) : (
          <table className={css.table}>
            <thead>
              <tr><th>ASIN</th><th>名称</th><th>{t('competitor.price7d')}</th><th>评分Δ30d</th><th>7天评论增长</th><th>{t('competitor.alert')}</th></tr>
            </thead>
            <tbody>
              {competitors.map(a => (
                <tr key={str(a.competitor_id)} className={css.alertRow}>
                  <td>{str(a.asin)}</td>
                  <td>{str(a.name)}</td>
                  <td>{num(a.price_delta_7d).toFixed(1)}%</td>
                  <td>{num(a.rating_delta_30d).toFixed(2)}</td>
                  <td>{num(a.review_growth_7d).toFixed(1)}%</td>
                  <td className={css.warn}>{str(a.type)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('section.approvals')}</h3>
        {admin && selected.size > 0 && (
          <div className={css.batchBar}>
            <span>{selected.size} {t('batch.selected')}</span>
            <button type="button" className={css.btn} disabled={busy !== null} onClick={() => { void batchApprove() }}>
              {busy === 'batch' ? '…' : t('batch.approve')}
            </button>
          </div>
        )}
        <table className={css.table}>
          <thead>
            <tr><th></th><th>#</th><th>类型</th><th>严重度</th><th>状态</th><th>说明</th><th>操作</th></tr>
          </thead>
          <tbody>
            {recs.map((r) => {
              const acts = admin ? actionsFor(r.status) : []
              const rid = String(r.id)
              const selectable = admin && (r.status === 'pending' || r.status === 'approved' || r.status === 'pending_confirmation')
              return (
                <tr key={rid}>
                  <td>
                    {selectable && (
                      <input
                        type="checkbox"
                        className={css.checkbox}
                        checked={selected.has(num(r.id))}
                        onChange={() => { toggleSelect(num(r.id)) }}
                      />
                    )}
                  </td>
                  <td>{str(r.type)}</td>
                  <td>{str(r.severity)}</td>
                  <td>{str(r.status)}</td>
                  <td className={css.msg}>{str(r.message).slice(0, 60)}</td>
                  <td>
                    {acts.map(label => (
                      <button
                        key={label}
                        type="button"
                        className={css.btn}
                        disabled={busy !== null}
                        onClick={() => { void act(r.id, label) }}
                      >
                        {busy === `${rid}:${ACTION_OF[label]}` ? '…' : t(label)}
                      </button>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}

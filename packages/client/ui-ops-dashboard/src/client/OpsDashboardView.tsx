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

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [ov, ac, rc, inv, who] = await Promise.all([
        getJson(`${OPS}/ops/overview`),
        getJson(`${OPS}/ads/quantitative?days=30`),
        getJson(`${OPS}/recommendations`),
        getJson(`${OPS}/ops/inventory`),
        getJson('/__tg/whoami'),
      ])
      setOverview(ov)
      setAcos(ac)
      setRecs((rc.recommendations ?? []) as Record<string, unknown>[])
      setInventory((inv.inventory ?? []) as Record<string, unknown>[])
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
        <h3 className={css.sectionTitle}>{t('section.approvals')}</h3>
        <table className={css.table}>
          <thead>
            <tr><th>#</th><th>类型</th><th>严重度</th><th>状态</th><th>说明</th><th>操作</th></tr>
          </thead>
          <tbody>
            {recs.map((r) => {
              const acts = admin ? actionsFor(r.status) : []
              const rid = String(r.id)
              return (
                <tr key={rid}>
                  <td>{rid}</td>
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

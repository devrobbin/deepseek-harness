/**
 * Operations cockpit plugin, browser half: contributes one entry to the
 * `conversation.view` slot (a tab beside 对话/轨迹) rendering the logged-in
 * operator's store dashboard. Reads through the team gateway's same-origin
 * proxies (`/__tg/ops/*`, `/__tg/whoami`), so it needs no config and the
 * browser never holds credentials.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by ui-conversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, NS, zh } from './locales.ts'
import { OpsDashboardView } from './OpsDashboardView.tsx'

/** Required services: the slot registry and the locale service. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the cockpit view tab. The registration rides
 * the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-ops-dashboard: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'ops-dashboard',
    order: 20,
    locale: NS,
    label: () => t('view.label'),
  }, OpsDashboardView))
}

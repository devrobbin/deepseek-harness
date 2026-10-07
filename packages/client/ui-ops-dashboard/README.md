# @deepseek-ai/dsh-client-ui-ops-dashboard

Operations cockpit view tab: contributes a tab (beside 对话/轨迹) that renders the logged-in operator's store dashboard — KPI cards, ACOS diagnosis table, stock-out risks, and a clickable approval queue — so operating a store does not require typing chat messages.

## Data path (team deployment)

All traffic goes through the team gateway's same-origin proxies, so this plugin needs no config and the browser never holds credentials:

- `GET /__tg/ops/*` → the operator's own amazon_ops instance (Bearer injected server-side)
- `GET /__tg/whoami` → `{ name, admin }`; non-admin accounts see the queue read-only, and the gateway independently rejects their POSTs (UI hiding is not enforcement)

Loaded via the team overlay template (`scripts/team-gateway/team.cordis.template.yml`), not the shipped web-app bundle — outside a gateway deployment the proxies do not exist.

## Model Experience

None, as `dsh-client-ui-ops-dashboard` — a browser view tab; it contributes no model-facing tools, prompt sections, or session events.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Gateway-coupled** — requires the team gateway's `/__tg/ops` and `/__tg/whoami` routes; a direct-attached instance shows the error state.
- **Poll-on-demand** — data refreshes on tab open and the 刷新 button; no live push.
- **30-day window fixed** — the ACOS table always asks for `days=30`.

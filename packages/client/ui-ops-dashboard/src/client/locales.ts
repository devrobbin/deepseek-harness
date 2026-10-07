/** `opsDashboard` namespace dictionaries (view tab label + cockpit strings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'opsDashboard'

/** The dictionary key set (source of truth for both locales). */
export type OpsDashboardKey =
  | 'view.label'
  | 'refresh'
  | 'loading'
  | 'error'
  | 'empty'
  | 'section.kpi'
  | 'section.acos'
  | 'section.stock'
  | 'section.approvals'
  | 'kpi.todayOrders'
  | 'kpi.gmv30d'
  | 'kpi.pendingOrders'
  | 'kpi.inventory'
  | 'kpi.lowStock'
  | 'acos.target'
  | 'acos.breakeven'
  | 'acos.waste'
  | 'stock.days'
  | 'stock.risk'
  | 'act.approve'
  | 'act.confirm'
  | 'act.rollback'
  | 'act.reject'
  | 'act.done'
  | 'act.failed'
  | 'adminOnly'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The operations cockpit view tab and its strings. */
    opsDashboard: OpsDashboardKey
  }
}

const zh: Record<OpsDashboardKey, string> = {
  'view.label': '运营驾驶舱',
  refresh: '刷新',
  loading: '加载中…',
  error: '数据加载失败',
  empty: '暂无数据',
  'section.kpi': '经营指标',
  'section.acos': '广告 ACOS 诊断',
  'section.stock': '库存与补货风险',
  'section.approvals': '审批队列',
  'kpi.todayOrders': '今日订单',
  'kpi.gmv30d': '近30天 GMV',
  'kpi.pendingOrders': '待处理订单',
  'kpi.inventory': '库存总量',
  'kpi.lowStock': '低库存 SKU',
  'acos.target': '目标',
  'acos.breakeven': '盈亏平衡',
  'acos.waste': '可避免浪费',
  'stock.days': '可售天数',
  'stock.risk': '缺货风险',
  'act.approve': '批准',
  'act.confirm': '确认执行',
  'act.rollback': '回滚',
  'act.reject': '拒绝',
  'act.done': '操作成功',
  'act.failed': '操作失败',
  adminOnly: '审批操作仅管理员账号可用',
}

const en: Record<OpsDashboardKey, string> = {
  'view.label': 'Ops Cockpit',
  refresh: 'Refresh',
  loading: 'Loading…',
  error: 'Failed to load data',
  empty: 'No data',
  'section.kpi': 'Business KPIs',
  'section.acos': 'Ad ACOS Diagnosis',
  'section.stock': 'Stock & Replenishment Risk',
  'section.approvals': 'Approval Queue',
  'kpi.todayOrders': 'Today Orders',
  'kpi.gmv30d': '30d GMV',
  'kpi.pendingOrders': 'Pending Orders',
  'kpi.inventory': 'Inventory Units',
  'kpi.lowStock': 'Low-Stock SKUs',
  'acos.target': 'Target',
  'acos.breakeven': 'Breakeven',
  'acos.waste': 'Avoidable Waste',
  'stock.days': 'Days of Cover',
  'stock.risk': 'Stock-out Risk',
  'act.approve': 'Approve',
  'act.confirm': 'Confirm',
  'act.rollback': 'Rollback',
  'act.reject': 'Reject',
  'act.done': 'Done',
  'act.failed': 'Failed',
  adminOnly: 'Approval actions require an admin account',
}

export { zh, en }

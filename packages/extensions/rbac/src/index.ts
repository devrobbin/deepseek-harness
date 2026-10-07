/**
 * @module @deepseek-ai/dsh-rbac
 *
 * Role-based tool access control. A `tools/pre-execute` waterfall listener
 * checks every tool call against the configured role's policy and denies
 * unauthorized calls; `rbac_whoami` lets the model (and humans) inspect the
 * active role and policy.
 *
 * Roles:
 * - admin  — all tools, minus the explicit `deny` list
 * - operator — day-to-day operations (diagnosis, memory, notifications);
 *   denied schedule management, shell/terminal execution, file mutation,
 *   arbitrary code, and dynamic plugin mounting
 * - viewer — read-only allowlist
 *
 * The `deny` config list applies to every role including admin (monotonic).
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'rbac'
export const inject = ['tools']

export type Role = 'admin' | 'operator' | 'viewer'

export interface Config {
  /** Active role for this deployment. */
  role: Role
  /** Extra tool names always denied, on top of role policy (even for admin). */
  deny: string[]
}

export const Config: Schema<Config> = Schema.object({
  role: Schema.union(['admin', 'operator', 'viewer'] as const).default('admin'),
  deny: Schema.array(Schema.string()).default([]),
})

/** Powers reserved to admin: schedule management, execution, mutation, dynamic plugins. */
const ADMIN_ONLY = new Set([
  'cron_create',
  'cron_delete',
  'bash',
  'pwsh',
  'write',
  'edit',
  'str_replace_editor',
  'terminal_close',
  'terminal_list',
  'terminal_open',
  'terminal_read',
  'terminal_send',
  'terminal_signal',
  'run_code',
  'cordis_define',
  'cordis_run',
  'cordis_undefine',
  // deerflow-dsh arbitrary-execution tools (same class as bash/run_code)
  'deerflow_run_bash',
  'deerflow_run_python',
  'deerflow_browser',
  // amazon_ops approval machinery: fund-sensitive ad mutations (operator may
  // list and read them; generating/approving/executing stays admin-only)
  'approvals_generate',
  'approvals_act',
])

/** The only tools a viewer may call. */
const VIEWER_ALLOW = new Set([
  'rbac_whoami',
  'hello',
  'memory_read',
  'memory_search',
  'memory_list',
  'cron_list',
  'ads_acos_quantitative',
  'ops_overview',
  'reviews_overview',
  'competitors_snapshot',
  'ops_overview',
  'ops_orders',
  'ops_inventory',
  'ops_replenishment',
  'listings_stats',
  'session_event_read',
  'session_event_search',
  'session_event_trace',
  'session_search',
  'session_trace',
  'read',
  'glob',
  'grep',
  'web_search',
  'web_fetch',
  'lsp',
  'ask_user_question',
])

function deniedByRole(role: Role, toolName: string): string | null {
  if (role === 'admin') return null
  if (role === 'operator') {
    if (ADMIN_ONLY.has(toolName)) {
      return `tool "${toolName}" is admin-only under the operator role`
    }
    return null
  }
  if (!VIEWER_ALLOW.has(toolName)) {
    return `tool "${toolName}" is outside the viewer read-only allowlist`
  }
  return null
}

export function apply(ctx: Context, config: Config) {
  const denySet = new Set(config.deny)

  const check = (toolName: string): string | null => {
    if (denySet.has(toolName)) {
      return `tool "${toolName}" is denied by deployment policy`
    }
    return deniedByRole(config.role, toolName)
  }

  // Waterfall policy gate: deny short-circuits; otherwise delegate.
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const reason = check(exec.name)
    if (reason !== null) {
      return { kind: 'deny', reason: `${reason} (role: ${config.role})` }
    }
    return await next()
  })

  ctx.tools.register(defineTool({
    name: 'rbac_whoami',
    description: '查询当前生效的角色与工具权限策略；可传入工具名检查该工具是否被允许。',
    parameters: {
      tool: { type: 'string', description: '要检查的工具名；缺省只返回角色概况' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string' },
          deniedToolCount: { type: 'number' },
          toolAllowed: { type: 'boolean', description: '仅当传入 tool 参数时有意义' },
          toolChecked: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.toolChecked
          ? `角色 ${value.role}：工具 "${value.toolChecked}" ${value.toolAllowed ? '允许' : `不允许（${value.reason}）`}。`
          : `当前角色 ${value.role}，策略拒绝清单 ${value.deniedToolCount} 项。`,
      }],
    },
    execute(args) {
      const checked = args.tool
      if (checked) {
        const reason = check(checked)
        return Promise.resolve({
          role: config.role,
          deniedToolCount: denySet.size,
          toolAllowed: reason === null,
          toolChecked: checked,
          ...(reason !== null ? { reason } : {}),
        })
      }
      return Promise.resolve({
        role: config.role,
        deniedToolCount: denySet.size,
      })
    },
  }))
}

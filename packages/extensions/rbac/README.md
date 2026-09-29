# @deepseek-ai/dsh-rbac

Role-based tool access control. A `tools/pre-execute` waterfall listener checks every tool call against the configured role's policy and denies unauthorized calls; `rbac_whoami` lets the model and humans inspect the active role and policy.

## Roles

| Role | Policy |
|---|---|
| `admin` | All tools, minus the explicit `deny` list |
| `operator` | Day-to-day operations (diagnosis, memory, notifications, web, session reads); denied schedule management (`cron_create`/`cron_delete`), shell/terminal execution (`bash`/`pwsh`/`terminal_*`), file mutation (`write`/`edit`/`str_replace_editor`), arbitrary code (`run_code`), and dynamic plugin mounting (`cordis_define`/`cordis_run`/`cordis_undefine`) |
| `viewer` | Read-only allowlist: memory reads/search, `cron_list`, `ads_acos_quantitative`, session query tools, `read`/`glob`/`grep`, `web_search`/`web_fetch`, `lsp`, `ask_user_question`, `rbac_whoami`, `hello` |

The `deny` config list applies to every role including admin (monotonic deny).

## Config

| Field | Type | Default | Description |
|---|---|---|---|
| `role` | `'admin' \| 'operator' \| 'viewer'` | `admin` | Active role for this deployment |
| `deny` | `string[]` | `[]` | Extra tool names always denied, on top of role policy |

Example `cordis.yml`:

```yaml
- id: rbac
  name: '@deepseek-ai/dsh-rbac'
  config:
    role: operator
    deny: ['memory_write']
```

## Tools

### `rbac_whoami(tool?)`

Report the active role, the deployment deny-list size, and — when `tool` is given — whether that specific tool would be allowed, with the denial reason.

## Policy gate

The `tools/pre-execute` listener denies with a reason like `tool "cron_create" is admin-only under the operator role (role: operator)`. Denial is a policy decision the model sees as a tool error; it is not a schema change, so denied tools remain visible (the model learns from the denial message).

## Model Experience

### Request context and condition

#### What the model sees

The `rbac_whoami` tool schema above.

#### Token effect

Fixed tool-schema tokens per request.

#### KV Cache effect

Prefix-stable while the tool set and schemas are unchanged.

## Known Limitations and Deferred Work

- **Deployment-wide role** — one role per process; no per-user or per-agent roles yet (multi-user identity lives outside DSH today).
- **Schema stays visible** — denied tools remain in the model-facing schema by design; a deployment that wants to hide tools entirely should not load them.
- **Exact-name matching** — policy entries are exact tool names; no prefix/wildcard matching.

# @deepseek-ai/dsh-scheduler

Global cron scheduler plugin. Persists 5-field cron jobs in a JSON file (survives restarts) and injects the job prompt into a live agent when the schedule fires.

Unlike the session-scoped `@deepseek-ai/dsh-schedule` (which only delivers while a session is live), jobs here are process-global and driven by a wall-clock scan loop, so they survive agent/session churn — the delivery target is any live root agent, not a specific session.

## Config

| Field | Type | Default | Description |
|---|---|---|---|
| `dataPath` | `string` | `.dsh-scheduler-jobs.json` | JSON file persisting jobs |
| `scanIntervalSeconds` | `number` | `60` | Scan granularity (must divide 60 for minute-level cron) |

## Tools

### `cron_create(name, cron, prompt, targetAgentId?)`

Create a global scheduled job. `cron` is a standard 5-field expression (`minute hour day-of-month month day-of-week`, 0 = Sunday; supports `*`, `*/n`, `a-b`, `a,b`). On fire, the prompt is injected into the target agent (or the first live root agent).

### `cron_list()`

List all jobs with their fire history (`lastFiredAt`, `lastResult`).

### `cron_delete(id)`

Delete a job.

## Delivery model

On fire, the scheduler calls `agent.inject()` — the prompt lands in the next admitted model request. `agent.inject` is a notification, not a wake-up: an idle agent stays idle. If no live agent exists at fire time, the fire is recorded as `missed: no live agent` in `lastResult`.

## Model Experience

### Request context and condition

#### What the model sees

The three tool schemas above.

#### Token effect

Fixed tool-schema tokens per request; the injected prompt adds tokens only when a job fires.

#### KV Cache effect

Prefix-stable while the tool set and schemas are unchanged.

## Known Limitations and Deferred Work

- **No catch-up** — a fire missed while the process is down is not replayed.
- **Minute granularity** — no seconds field; `scanIntervalSeconds` should divide 60.
- **Single delivery target** — jobs deliver to one agent, not to fan-out.
- **No cron names** — `JAN`/`MON` aliases unsupported; use numbers.

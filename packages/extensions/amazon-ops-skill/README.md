# @deepseek-ai/dsh-amazon-ops-skill

Registers the Amazon e-commerce operations inspection playbook as a runtime skill on `ctx.skills` (`amazon-ops-inspection`).

The skill teaches the model the standard closed loop — diagnose via `ads_acos_quantitative`, alert via `notify_send` when avoidable spend breaches the threshold, persist conclusions via `memory_write` under the 「ACOS分析」 topic, and compare trends / schedule follow-ups — so operations reviews run the same way every time without the user re-describing the procedure.

Companion to [`@deepseek-ai/dsh-amazon-ops-bridge`](../amazon-ops-bridge) (the tools) — this package contributes the methodology; the bridge contributes the capabilities. The skill assumes those tools are registered; loading it without the bridge leaves a playbook whose tools are absent.

## Config

None.

## Model Experience

### Request context and condition

#### What the model sees

The skill appears in the session skill catalog (via `dsh-tool-skill`) with the name `amazon-ops-inspection`, its description, and `whenToUse` routing guidance; loading it returns the full playbook body as a `<skill_content>` block.

#### Token effect

Catalog row: fixed small cost per session. Loaded body: one-time retained tool result (~600 tokens) when the model or user invokes it.

#### KV Cache effect

Catalog is prefix-stable; loading appends the body once and does not invalidate reuse.

## Known Limitations and Deferred Work

- **Single skill** — pricing guardrails and other playbooks live in memory topics (「定价策略」) rather than separate skills; split when a second playbook stabilizes.
- **Default threshold baked into prose** — the $5,000 alert threshold is playbook text, not config; the model defers to explicit user instructions over it.

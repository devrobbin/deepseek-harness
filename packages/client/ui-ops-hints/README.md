# @deepseek-ai/dsh-client-ui-ops-hints

Composer dock hint chips: a full-width row of one-click prompt chips stacked above the composer card (`conversation.input.dock` seat), giving the web UI a zero-learning-cost entry into the Amazon operations loop.

| Chip | Prompt sent |
|---|---|
| 🔍 跑一遍巡检 | 按 amazon-ops-inspection 技能跑一遍完整巡检闭环 |
| 📊 分析 ACOS | 分析最近 30 天的 ACOS 诊断报告，给出优化建议 |
| ⏰ 定时任务 | 列出当前的定时任务 |
| 🧠 长期记忆 | 列出所有长期记忆主题，并简要总结 |

Clicking a chip fills the composer draft and submits through the session standard kit's public `inputActions` face — the component holds no state and reads no live data beyond the kit.

Companion to [`@deepseek-ai/dsh-amazon-ops-skill`](../../extensions/amazon-ops-skill) (the methodology the first chip triggers) and [`@deepseek-ai/dsh-amazon-ops-bridge`](../../extensions/amazon-ops-bridge) (the tools the loop calls).

## Config

None.

## Model Experience

None, as `dsh-client-ui-ops-hints` — presentation only; the chips compose ordinary user messages, so all model-visible effects belong to the conversation itself.

#### KV Cache effect

None: no catalog, no injected instructions.

## Known Limitations and Deferred Work

- **Static chip set** — prompts are hardcoded prose; a config surface or dynamic skill-driven chips are deferred until a second playbook stabilizes.
- **Chinese-only labels** — the locale namespace is not wired; chips are unlocalized.

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock seat and
// its InputZone owner share plus the session standard kit's inputActions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './OpsHints.module.css'

/** Dock seat component props: the runtime share carries the standard kit. */
export type OpsHintsProps = PropsRuntime<'conversation.input.dock'>

/** One-click prompts rendered above the composer card. */
const HINTS: ReadonlyArray<{ readonly label: string; readonly prompt: string }> = [
  { label: '🔍 跑一遍巡检', prompt: '按 amazon-ops-inspection 技能跑一遍完整巡检闭环' },
  { label: '📊 分析 ACOS', prompt: '分析最近 30 天的 ACOS 诊断报告，给出优化建议' },
  { label: '📝 生成日报', prompt: '生成昨天的运营日报：结合最近的 ACOS 诊断结果和长期记忆「ACOS分析」中的历史巡检记录，输出核心指标、变化趋势和今日待办' },
  { label: '📅 设每日巡检', prompt: '创建一个每天上午 10 点的定时巡检任务：按 amazon-ops-inspection 技能跑完整巡检闭环。如果已存在类似的每日巡检任务，告诉我它的名字和计划，不要重复创建' },
  { label: '⏰ 定时任务', prompt: '列出当前的定时任务' },
  { label: '🧠 长期记忆', prompt: '列出所有长期记忆主题，并简要总结每个主题记住了什么' },
]

/**
 * A full-width chip row above the composer card. Every click fills the draft
 * and submits through the session kit's public input action face; the chips
 * themselves are static, so the component holds no state.
 */
export function OpsHints({ inputActions }: OpsHintsProps) {
  if (!inputActions) return null
  return (
    <div className={css.row}>
      {HINTS.map(hint => (
        <button
          key={hint.label}
          type="button"
          className={css.chip}
          onClick={() => {
            inputActions.setDraft(hint.prompt)
            inputActions.submit()
          }}
        >
          {hint.label}
        </button>
      ))}
    </div>
  )
}

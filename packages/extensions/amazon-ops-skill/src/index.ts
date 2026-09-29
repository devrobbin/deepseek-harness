/**
 * @module @deepseek-ai/dsh-amazon-ops-skill
 *
 * Registers the Amazon e-commerce operations inspection playbook as a runtime
 * skill on `ctx.skills`. The skill teaches the model the standard closed loop
 * — diagnose via `ads_acos_quantitative`, alert via `notify_send` when
 * avoidable spend breaches the threshold, persist conclusions via
 * `memory_write`, and schedule/compare follow-ups — so operations reviews run
 * the same way every time without the user re-describing the procedure.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

export const name = 'amazon-ops-skill'
export const inject = ['skills']

const INSPECTION_PLAYBOOK = `# 亚马逊电商运营巡检

标准巡检闭环。按顺序执行以下四步，每步使用对应工具，完成后汇总报告。

## 1. 诊断
调用 \`ads_acos_quantitative\`（days 默认 30，或按用户指定的窗口）获取 ACOS 定量诊断报告。
提取三个核心数：目标 ACOS、盈亏平衡 ACOS、可避免花费合计（所有活动 avoidable_spend 之和）。

## 2. 阈值判断与告警
若可避免花费合计超过告警阈值（默认 $5,000，用户另有指示时以其为准）：
- 调用 \`notify_send\` 发送告警。渠道按当前会话可用配置选择（feishu / dingtalk / telegram）。
- 告警内容包含：核心数值（目标/盈亏平衡 ACOS、可避免花费总额）、浪费最严重的活动（名称、金额、waste_type）、一句建议动作。
- 若发送结果为 mock 模式，如实告知用户"链路已验证但未实际投递"。
若未超阈值：跳过告警，报告"未达告警阈值"即可。

## 3. 结论沉淀
调用 \`memory_write\`，主题固定为「ACOS分析」，内容包含：诊断日期、目标/盈亏平衡 ACOS、
活动总数与存在浪费的活动数、可避免花费总额、最大浪费活动及金额、已执行的动作（是否已告警）。

## 4. 复查与跟进
- 用 \`memory_read\`（主题「ACOS分析」）取历史记录，对比本次与上次的可避免花费，报告趋势（恶化/改善/持平）。
- 用 \`cron_list\` 检查是否已有定时巡检任务；没有则建议用户创建（建议 cron '0 10 * * 1-5'，工作日上午十点）。
- 涉及调价建议时，先用 \`memory_read\` 读取「定价策略」主题中的护栏（如阶梯调价幅度）；护栏缺失时先向用户确认，再给出建议。

## 约束
- 金额保留两位小数，百分比保留一位小数。
- 只读操作（诊断、memory 读取、cron_list）直接执行；写操作（告警、memory_write）执行后如实报告结果。
- 工具返回的 render 摘要之外，需要明细时以工具返回的 JSON 字段为准。`

const SKILL: SkillRegistration = {
  name: 'amazon-ops-inspection',
  description: '亚马逊电商运营标准巡检闭环：ACOS 诊断 → 阈值告警 → 记忆沉淀 → 趋势复查，逐步指定所用工具与输出规范。',
  whenToUse: '用户要求巡检/检查广告 ACOS/生成运营日报/设置告警，或提到"跑一遍巡检流程"时加载。',
  content: INSPECTION_PLAYBOOK,
  source: 'runtime',
}

export function apply(ctx: Context): void {
  ctx.skills.register(SKILL)
}

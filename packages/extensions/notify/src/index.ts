/**
 * @module @deepseek-ai/dsh-notify
 *
 * Notification gateway plugin. Sends alerts to Feishu / DingTalk / Telegram
 * webhook robots through one model-facing tool. Webhook URLs come from the
 * environment (via cordis.yml `!!js process.env.X`), never from code.
 *
 * `mock` mode records sends without hitting the network — used for testing
 * the tool contract without real webhooks.
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'notify'
export const inject = ['tools']

export interface Config {
  /** Feishu custom-bot webhook URL (empty = disabled). */
  feishuWebhook: string
  /** DingTalk custom-bot webhook URL (empty = disabled). */
  dingtalkWebhook: string
  /** Telegram bot API token (empty = disabled). */
  telegramToken: string
  /** Telegram chat id to receive messages (empty = disabled). */
  telegramChatId: string
  /** Record sends instead of hitting the network. */
  mock: boolean
}

export const Config: Schema<Config> = Schema.object({
  feishuWebhook: Schema.string().default(''),
  dingtalkWebhook: Schema.string().default(''),
  telegramToken: Schema.string().default(''),
  telegramChatId: Schema.string().default(''),
  mock: Schema.boolean().default(true),
})

export type Channel = 'feishu' | 'dingtalk' | 'telegram'

async function sendFeishu(webhook: string, title: string | undefined, text: string, timeoutMs: number): Promise<void> {
  const body = title === undefined
    ? { msg_type: 'text', content: { text } }
    : { msg_type: 'post', content: { post: { zh_cn: { title, content: [[{ tag: 'text', text }]] } } } }
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw new Error(`feishu webhook returned ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

async function sendDingtalk(webhook: string, title: string | undefined, text: string, timeoutMs: number): Promise<void> {
  const body = title === undefined
    ? { msgtype: 'text', text: { content: text } }
    : { msgtype: 'markdown', markdown: { title, text: `## ${title}

${text}` } }
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw new Error(`dingtalk webhook returned ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

async function sendTelegram(
  token: string,
  chatId: string,
  title: string | undefined,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...(title !== undefined ? { text: `*${title}*

${text}`, parse_mode: 'Markdown' } : {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw new Error(`telegram returned ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: 'notify_send',
    description: '向 IM 渠道发送一条运营通知（飞书/钉钉/Telegram 机器人）。用于 ACOS 超标告警、库存告警、日报推送、任务完成通知等场景。',
    parameters: {
      channel: {
        type: 'string',
        enum: ['feishu', 'dingtalk', 'telegram'],
        required: true,
        description: '目标渠道',
      },
      message: {
        type: 'string',
        required: true,
        description: '通知内容（纯文本或 Markdown）',
      },
      title: {
        type: 'string',
        description: '通知标题（可选；飞书显示为卡片标题，钉钉/Telegram 加粗在正文前）',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          channel: { type: 'string' },
          sent: { type: 'boolean' },
          mode: { type: 'string', description: 'mock 或 live' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.sent
          ? `已通过 ${value.channel} 发送（${value.mode === 'mock' ? 'mock 模式，未实际发送' : '真实发送'}）。`
          : `${value.channel} 渠道未配置，未发送。`,
      }],
    },
    async execute(args) {
      const channel = args.channel
      const text = args.message

      if (config.mock) {
        return { channel, sent: true, mode: 'mock' }
      }

      switch (channel) {
        case 'feishu':
          if (!config.feishuWebhook) return { channel, sent: false, mode: 'live' }
          await sendFeishu(config.feishuWebhook, args.title, text, 15_000)
          break
        case 'dingtalk':
          if (!config.dingtalkWebhook) return { channel, sent: false, mode: 'live' }
          await sendDingtalk(config.dingtalkWebhook, args.title, text, 15_000)
          break
        case 'telegram':
          if (!config.telegramToken || !config.telegramChatId) {
            return { channel, sent: false, mode: 'live' }
          }
          await sendTelegram(config.telegramToken, config.telegramChatId, args.title, text, 15_000)
          break
      }
      return { channel, sent: true, mode: 'live' }
    },
  }))
}

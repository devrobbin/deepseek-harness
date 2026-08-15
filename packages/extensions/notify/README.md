# @deepseek-ai/dsh-notify

Notification gateway plugin. Sends alerts to Feishu / DingTalk / Telegram webhook robots through one model-facing tool. Webhook URLs are configured in `cordis.yml` (typically from environment variables) — never hardcoded.

## Config

| Field | Type | Default | Description |
|---|---|---|---|
| `feishuWebhook` | `string` | `''` | Feishu custom-bot webhook URL |
| `dingtalkWebhook` | `string` | `''` | DingTalk custom-bot webhook URL |
| `telegramToken` | `string` | `''` | Telegram bot API token |
| `telegramChatId` | `string` | `''` | Telegram chat id to receive messages |
| `mock` | `boolean` | `true` | Record sends instead of hitting the network |

Example `cordis.yml` with real webhooks:

```yaml
- id: notify
  name: '@deepseek-ai/dsh-notify'
  config:
    feishuWebhook: !!js process.env.FEISHU_WEBHOOK
    mock: false
```

## Tools

### `notify_send(channel, message)`

Send a text notification. `channel` is one of `feishu` / `dingtalk` / `telegram`. Returns `{ channel, sent, mode }` where `mode` is `mock` or `live`. A channel without a configured webhook returns `sent: false` without throwing.

## Model Experience

### Request context and condition

#### What the model sees

The `notify_send` tool schema above.

#### Token effect

Fixed tool-schema tokens per request.

#### KV Cache effect

Prefix-stable while the tool set and schemas are unchanged.

## Known Limitations and Deferred Work

- **Text messages only** — no rich cards / buttons / interactive messages yet.
- **No retry** — a failed webhook call throws and the model sees the error.
- **Webhook-only** — no incoming (bot receive) support; this is outbound alerting.
- **No rate limiting** — rapid repeated sends are not throttled.

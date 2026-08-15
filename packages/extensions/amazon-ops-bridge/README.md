# @deepseek-ai/dsh-amazon-ops-bridge

Bridge plugin exposing the [amazon_ops](https://github.com/devrobbin/deer-flow) (Amazon e-commerce operations) REST API as model-facing tools on `ctx.tools`.

The amazon_ops service runs independently (FastAPI on `:8001` by default). This plugin translates tool calls into HTTP requests against its `/api/amazon/*` endpoints and returns the canonical JSON values.

## Config

| Field | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `http://127.0.0.1:8001` | Base URL of the amazon_ops service |
| `mock` | `boolean` | `false` | Serve canned responses instead of calling the service (for testing) |

## Tools

### `ads_acos_quantitative`

Fetches the ACOS quantitative diagnosis report: target ACOS, breakeven ACOS, per-campaign diagnosis (waste type, avoidable spend, bid draft) and placement diagnosis.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `days` | `number` | no | Statistics window in days, 1-90, default 30 |

Canonical return: `{ days, thresholds, campaigns[], placements[] }` mirroring `GET /api/amazon/ads/quantitative`.

### `hello`

Minimal chain-verification tool.

## Model Experience

### Request context and condition

#### What the model sees

The tool schema and description above.

#### Token effect

Fixed tool-schema tokens per request; data-dependent response content.

#### KV Cache effect

Prefix-stable while the tool set and schemas are unchanged.

## Known Limitations and Deferred Work

- **Read-only endpoints only** — the `GET /ads/quantitative` style endpoints work without the DeerFlow gateway. Write operations that require `app.gateway.deps` (admin auth) fail in the standalone deployment until a real gateway is mounted.
- **No auth plumbing** — the bridge sends no credentials; the amazon_ops service must be reachable without auth (or the deployment adds a proxy).
- **No pagination streaming** — large reports come back as one JSON body.

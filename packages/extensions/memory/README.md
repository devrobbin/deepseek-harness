# @deepseek-ai/dsh-memory

Cross-session long-term memory plugin. Persists topic-organized memory entries to a JSON file so knowledge survives process and session churn.

This is the DSH counterpart of DeerFlow's memory layer: a simple durable store the model can consult and update across conversations. Plain substring search on top of the persisted store — no vector database required.

## Config

| Field | Type | Default | Description |
|---|---|---|---|
| `dataPath` | `string` | `.dsh-memory.json` | JSON file persisting memory |

## Tools

### `memory_write(topic, content)`

Append a memory entry under a topic. Topics are free-form strings (e.g. "店铺配置", "竞品情报", "定价策略"). Returns the topic and its new entry count.

### `memory_read(topic)`

Return all entries of a topic in chronological order; empty array if the topic does not exist.

### `memory_search(query)`

Case-insensitive substring search across all topics. Returns matching `{ topic, content, createdAt }` rows.

### `memory_list()`

List all topics with their entry counts.

## Model Experience

### Request context and condition

#### What the model sees

The four tool schemas above.

#### Token effect

Fixed tool-schema tokens per request; memory content is only read when a tool call returns it.

#### KV Cache effect

Prefix-stable while the tool set and schemas are unchanged.

## Known Limitations and Deferred Work

- **Substring search only** — no vector/embedding retrieval; fine for keyword recall, weak for semantic recall.
- **Append-only per write** — editing/removing an entry requires rewriting the JSON file manually.
- **No per-user scoping** — memory is process-global, shared by all sessions.
- **No TTL/eviction** — entries persist forever.

# DSH usage analytics

A **Usage analytics** main panel (sidebar) with a request log and usage charts,
built from the session logs DSH already writes. Observation only.

- **Request log**: model and provider, when, project, input, cache read,
  output, cost, duration, TTFT and status with the stop reason; status chips
  with counts, search by model, provider, project or thread title, a purpose
  filter (agent, subagent, compaction, title, memory summary, other side
  call) and a date range. A row opens its thread.
- **Charts**: headline tiles against the previous period, cost over time
  stacked by model, provider or project, cost per model, provider and project
  (selecting one filters the log), tokens by kind, cache hit ratio, requests
  and failures, TTFT and duration p50/p90, and the top threads by cost,
  hourly or daily. Charts use TanStack Charts from `@dshfiles/plugin-ui`.

## Data

The Host walks `<sessions root>/<project>/<session>/session[.vN].jsonl.zstd`
(newest generation only) and keeps, per log, the byte offset of the last
complete Zstandard frame and the fold state, in
`$DSH_HOME/plugins/usage/usage.db` (node:sqlite). A pass every 30 s, or
**Refresh**, decodes only the frames a log gained; a torn final frame waits for
the writer.

| Field       | Source                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| route       | `assistant/message` `message.source`, else the latest `request/header`, `request/context` or `model/selection`                                                                                                           |
| tokens      | `usage` (or the stream's last `usage` chunk): uncached input, cache read, cache write, output, reasoning                                                                                                                 |
| stop reason | `replayState.response.stopReason` (`toolUse`, `stop`, `length`), else the `finish` chunk kind                                                                                                                            |
| status      | `finish` kind `error` → Failed with the failure code; an attempt without a finish resolves at `llm/retry` (Failed) or `turn/end` (`aborted`/`interrupted` → Aborted); a step with no answer in an aborted turn → Aborted |
| duration    | `step/start` → `finish` chunk time                                                                                                                                                                                       |
| TTFT        | `step/start` → first stream chunk that is not `finish`/`usage`, so it includes request assembly before the provider call; `–` for compaction, titles and failures without output                                         |
| compaction  | `compaction/start` → `compaction/summary` (route and usage, no stream)                                                                                                                                                   |
| title       | `session/title-llm-request` → provider `session/title`; the log keeps no usage                                                                                                                                           |

An `llm/stream` observer adds what the logs lack: the usage and TTFT of title
calls (merged into the log row), OptMem summaries (`memory`) and other plugin
calls (`other`). It only sees calls made while the plugin is loaded.

## Cost

Costs are never stored. Queries join per-route, per-context-band rates derived
with AI Accounts' `resolveRouteQuote` and `costOfTokens` from the models.dev
cache AI Accounts keeps (`$DSH_HOME/plugins/ai-accounts/pricing.json`); this
plugin never fetches it. Subscription traffic is priced at list price, so
every figure is an estimate. AI Accounts' per-route price overrides live in its
settings namespace and are not applied here.

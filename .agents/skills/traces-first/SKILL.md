---
name: traces-first
description: Read the stored OpenTelemetry traces before reading code when something is slow, failing or hanging — a thread's turn, a tool call, a plugin API, a jj/secret/Jev/provider call. Use the traces_* agent tools (traces_status, traces_search with sessionId, traces_get, traces_session_summary, traces_error_groups, traces_service_map, traces_list_services) to name the slow or failing span, then open the code that owns it.
---

# Traces first

Every agent turn, model call, tool call and owned-plugin work unit lands in the in-DSH
trace store (`@dshfiles/traces`, see `docs/observability.md`). Each plugin feature names
its spans in `dshx.features.json` (`telemetry`), so a span name leads straight to the
code. Read the traces before guessing from source: they say which step took the time
and which one failed, with its error type.

## 0. Is anything being recorded?

`traces_status` first. Its `diagnosis` decides whether the rest is worth doing:

| `diagnosis`                        | Meaning                                                    | Next                                                                                       |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `receiving`                        | Spans arrive; counters move                                | Go on                                                                                      |
| `waiting`, `no-exporter`           | Receiver listens, nothing sends                            | Spans before now are missing; reproduce once, then read                                    |
| `exporting-elsewhere`              | `OTEL_EXPORTER_OTLP_ENDPOINT` points at another collector  | Read that collector, or say the store is empty here                                        |
| `port-in-use`, `failed`, `external-mode` | No local receiver                                    | Stored traces stay browsable; new ones are not here. Report it, do not restart DSH        |

Never restart the live DSH to turn tracing on; that is the user's call.

## 1. Find the trace

- **A thread is slow or failed:** `traces_session_summary({ sessionId })` for its span,
  error, model and tool counts and p50/p95, then `traces_search({ sessionId, limit: 20 })`
  newest first. Add `status: 'error'` or `minDurationMs: 2000` to narrow it.
- **A tool or plugin call:** `traces_search({ operation: 'execute_tool bash' })`,
  `traces_search({ operation: 'jujutsu/load' })` (`<api id>/<method>`), or
  `traces_search({ search: 'jj log' })` for a span name fragment.
- **Something fails repeatedly:** `traces_error_groups({ windowMinutes: 240 })` groups
  error spans by service, operation, `error.type` and message shape with a sample trace id.
- **Which service or operation is slow overall:** `traces_list_services({ windowMinutes: 60 })`
  (count, error rate, p50/p95/p99, max per operation); `traces_service_map` for who calls
  whom across services.

## 2. Read the span tree

`traces_get({ traceId })` returns the tree depth-first with offset and duration per span.
Read it top-down:

```text
invoke_agent coder                   41.2 s
└─ react step                          8.0 s
   ├─ chat gpt-6.1-sol                 2.1 s   gen_ai.response.time_to_first_token 1.8 s
   └─ execute_tool jj_load             5.9 s
      └─ jujutsu/load (server)         5.8 s
         └─ jj log (client)            5.6 s   process.exit.code 0, jj.output.truncated false
```

- The **deepest long span** is the owner: here `jj log` inside the jujutsu API, not the
  model and not the tool wrapper.
- A long parent with short children is time **between** spans: a queue, a lock, a wait
  span (`approval wait`, `llm retry wait`, `job <kind>`), or untraced work in the parent's
  own code.
- An `error` span carries `error.type` (`TypeError:cli-failed`), never a message; the
  `dshx.<plugin>.*` and `process.*` attributes say which input class it was.

## 3. Open the code the span names

Search the span name: every custom span is a string in Host code and is listed in its
plugin's catalog with the test that records it.

```sh
rg -n "'jj log'|jj \\$\\{" plugins/@dshfiles/*/src
rg -n '"span": "ai-accounts provider request"' plugins/@dshfiles/*/dshx.features.json
```

`<api id>/<method>` is a dshx API method: find `defineApi({ id: '<api id>'`. `execute_tool <name>`
is the tool of that name; `chat <model>` is the provider call.

## Example flows (illustrative numbers)

**"New thread takes 6 s to answer."** `traces_session_summary` → model calls p95 5.5 s,
TTFT 5.1 s on one provider route → the provider is slow, not DSH; check `ai_accounts_quota`
before touching plugin code.

**"Landing a thread spins."** `traces_search({ operation: 'jj-threads/landThread', minDurationMs: 1000 })`
→ `traces_get` → `jj rebase` 80 ms but `jj-integration workspace sync` 14 s → the slow part is
`dshx checkout sync` rebuilding plugins; read its `dshx.checkout.rebuilt_plugins`.

**"Backlog triage never applies."** `traces_error_groups` → `jev classify` errors,
`http.response.status_code` 401 → the Jev key reference is wrong; `secret_reference_status`,
not the triage code.

## When the trace is not enough

- No span covers the slow part: that Host code is missing a span. Add one at the work-unit
  boundary (`withSpan`, see `tooling/dshx/docs/guides/tracing.md`), list it in the catalog
  `telemetry` with a `recordSpans()` test, and `features:check` keeps it there.
- Browser-side slowness (rendering, long tasks, DOM size) has no spans: use
  `live-performance-audit`.
- Counts and cost over days: the usage ledger (`usage_report`), not traces.

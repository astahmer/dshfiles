# Observability: OpenTelemetry traces

The `web` profile exports OpenTelemetry spans for every agent turn, ReAct step, model call and tool call through
[`@dshfiles/agent-telemetry`](../plugins/@dshfiles/agent-telemetry/README.md) (row `dshfiles-agent-telemetry`), a port
of the marketplace plugin [`@loongsuite/dsh-plugin`](https://github.com/loongsuite/dsh-plugin) 0.1.3 onto
`@dshfiles/dshx/tracing`. Spans go to the `OTEL_EXPORTER_OTLP_*` endpoint when one is set, otherwise to the in-process
receiver of the traces plugin; with neither, nothing is recorded.

Four sources answer different questions; pick the one that owns the question before adding another:

| Question                                                          | Source                                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| What did a thread, its tools, Jev or an integration do, in order? | Activity Timeline plugin (`activity_timeline_*` agent tools): retained, condensed events.                 |
| How many requests, tokens, what cost, which tools fail?           | Usage plugin: SQLite ledger, `usage_report`, and its OTLP metrics push (below).                           |
| Why is the live GUI slow right now?                               | [`live-performance-audit`](performance.md) probes against :3080; measure before fixing.                   |
| Where did the time of one turn or call go, across plugins?        | Traces: agent-telemetry spans for turns, model calls and tools with our plugins' spans nested, one trace. |

The **Traces** panel ([in-DSH viewer](#in-dsh-viewer-dshfilestraces)) browses those spans without leaving DSH.

## Turning it on

Nothing to turn on. The seed installs `@dshfiles/agent-telemetry` with no `disabled` gate, and every span is a no-op
until dshx tracing has a destination, checked at each span:

- the traces plugin's receiver, published in-process once it listens (no variable, no restart when it binds later);
- or the standard variables in the `dsh web` environment, which win over it:

| Variable                                                          | Effect                                                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                     | OTLP/HTTP base URL, e.g. `http://127.0.0.1:4318`; `/v1/traces` is appended.                                                                 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`                              | Full traces URL, used as given.                                                                                                             |
| `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | `key=value,…` headers, e.g. a collector token; never sent to the in-process receiver. Keep the value in the environment, never the profile. |
| `OTEL_SERVICE_NAME`                                               | `service.name`, default `dshfiles`.                                                                                                         |
| `OTEL_SDK_DISABLED=true`                                          | Everything off.                                                                                                                             |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`              | Opt-in content capture while the `captureContent` setting is `environment` (its default): `SPAN_ONLY` or `SPAN_AND_EVENT`.                  |

Variables are read by the Host process, so setting them takes a DSH Host restart. The wire format is OTLP/HTTP JSON,
which the in-DSH viewer, any OTLP collector, Jaeger, Grafana Tempo, Langfuse's OTLP endpoint or
`comma otel-desktop-viewer` accept. Traces go only where the endpoint points; there is no default remote backend.

## What a span carries

Per turn, one trace (a subagent's turns join their parent's):

```text
enter_ai_application_system (server)
└─ invoke_agent <agent> (client)              turn totals: gen_ai.usage.*, finish reason, dsh.turn.end_reason
   └─ react step                               gen_ai.react.round / finish_reason
      ├─ chat <model> (client)                 one per attempt, retries included; dsh.llm.attempt, TTFT
      ├─ llm retry wait                        dsh.llm.retry, delay, error.type
      └─ execute_tool <tool>                   the tool body runs with this span active
         ├─ <api id>/<method> (server)         a dshx API the tool called, then its jj / secret / Jev spans
         ├─ approval wait                      dsh.approval.outcome
         ├─ job <kind> (producer)              a background job the tool started, until it settles
         └─ enter_ai_application_system        a subagent's turn (subagent, subagent_fork, workflow tools)
```

Also `compaction`, `chat <model>` with `dsh.llm.purpose` for title and compaction calls and with
`dsh.llm.standalone` for a plugin's own model call (under the span that made it), and `execute_tool <name>` for a
`run_code` sub-dispatch. Attributes follow the GenAI semantic conventions LoongSuite used: `gen_ai.operation.name`,
`gen_ai.span.kind`, `gen_ai.request.model`, `gen_ai.provider.name`, `gen_ai.usage.*_tokens` (cache buckets summed into
input), `gen_ai.response.finish_reasons`, `gen_ai.response.time_to_first_token`, `gen_ai.tool.name`,
`gen_ai.tool.call.id`, `error.type`, plus `dsh.session.id` (on every span), `dsh.turn`, `dsh.step`,
`dsh.session.parent_id`, `dsh.trace.parent_link` and `dsh.session.cwd` (the Session's working directory — a local
path).

By default no message text, tool argument, tool result, approval reason, job label or provider error message leaves
the Host; span status messages are error types or codes. The `captureContent` setting
(`dshfiles-agent-telemetry`) or the variable above puts content on spans, each value cut to 1,024 characters.

## Usage ledger metrics

`@dshfiles/usage` reads the same variables and, when an endpoint is set (or,
without one, while the in-DSH receiver listens), also POSTs its SQLite ledger
aggregates (model requests and tokens, tool executions
by category and source, Jev requests, duration histograms) to `/v1/metrics` as
OTLP/HTTP JSON every 60 s, cumulative since Host start. Its metrics are named
`dsh.*` under the `@dshfiles/usage` instrumentation scope and carry
`service.name` from `OTEL_SERVICE_NAME` (default `dshfiles`).
`OTEL_METRICS_EXPORTER=none` turns it off. Details and the full variable list are in the
[usage README](../plugins/@dshfiles/usage/README.md#periodic-export-opt-in).

## Spans from our own code (dshx)

Agent telemetry sees DSH core: turns, steps, model calls, tool calls. What an
owned plugin does inside a tool or a browser click comes from
`@dshfiles/dshx/tracing` (no dependency, OTLP/HTTP JSON to `/v1/traces`), the
same tracer agent-telemetry records through, with the same destinations: the
`OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` variables
(`OTEL_SERVICE_NAME`, default `dshfiles`; `OTEL_SDK_DISABLED=true` forces it
off) and, without one, the in-DSH receiver below, which publishes its address
in-process (`publishLocalOtlpEndpoint`). With neither, every span is a shared
no-op.

- Every dshx API dispatch (browser, plugin or agent tool) is a server span
  `<api id>/<method>`: package, API id, method, caller kind, outcome code and
  duration.
- Under it: `jj <subcommand>` (jujutsu, jj-integration, backlog, pulls-review),
  `git worktree` (jj-integration), `secret resolve` and `secret <verb>`
  (secret-catalog), `jev classify` (backlog, memory: model, provider, HTTP
  status, token counts), multi-host gateway `<namespace>/<method>` requests
  (forwarding `traceparent`), `ssh command` and `ssh tunnel open` (multi-host),
  `ai-accounts provider request` (quota, catalog and credit HTTP calls, host and
  status only), `keychain read`, `mcp registry search`, `mcp server start`,
  `project-checks run`, `brave search`, `dsh release check`,
  `marketplace hub request`, `tweet context fetch` and `ffmpeg sample`,
  `worktree-memory probe`, `usage index`, `usage metrics export`,
  `background-jobs history pass`, `session tail read` (session-controller),
  `otlp ingest` (traces receiver, metrics and logs only) and
  `jj-integration workspace sync`.
- `dshx checkout sync` records its own span, continuing a `TRACEPARENT`
  environment variable when set.
- A dshx span opened while an agent-telemetry span is active becomes its child:
  the `tools/execute` hook runs every tool body with its `execute_tool` span
  active and every model stream is pulled with its `chat` span active, so a
  tool call and the plugin work it caused land in one trace with no per-plugin
  code. To add a span of your own, see
  [Add tracing to a plugin](../tooling/dshx/docs/guides/tracing.md#add-tracing-to-a-plugin).

### The telemetry contract (checked)

Span coverage is a contract, checked like Gherkin coverage: `features:check`
(`tooling/dshx/scripts/feature-coverage.mjs`, which calls
`telemetry-coverage.mjs`) and `dshx build` fail a plugin that breaks it. Every
feature in a `dshx.features.json` lists `telemetry`, one or more of:

| Entry                                                   | Means                                                                                                                                                                                                                                                                                                                         | Checked                                                                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "kind": "automatic", "source": … }`                  | The span exists without plugin code: `api-dispatch` (`<api id>/<method>`), `agent-tool` (`execute_tool <name>`), `model-stream` (`chat <model>`), or a shared helper another owned plugin opens: `jj` (jujutsu / jj-integration APIs), `secret` (`secretCatalogValues`), `multi-host` (gateway). | The package's Host code (or an owned dshx module it imports) contains the thing that emits it: `defineApi`, a tool binding, a `ctx.llm` stream, the helper's import or service. |
| `{ "kind": "custom", "span", "file", "testName" }`      | A span this plugin opens with `withSpan` / `traced`. `span` is its name; `<word>` marks a dynamic part (`jj <subcommand>`).                                                                                                                                                                                                       | A Host source string emits the name; the named test exists, calls `recordSpans()` and names a concrete span matching it.                                                      |
| `{ "kind": "not-applicable", "reason" }` (stands alone) | No span is worth having: client-only presentation, a pure in-memory function, a registry. Never on a `tool` surface (those always list `agent-tool`).                                                                                                                                                                             | Reason of 20+ characters.                                                                                                                                                     |

The source rule catches new I/O no catalog mentions: every Host-reachable file
(the `dshx.config.ts` Host entry and modules, followed through relative
imports; tests excluded) that calls `fetch`, imports `node:http(s)/net/tls/dgram`
or `node:child_process` for values, or spawns through the subprocess service
must open a span itself (`withSpan`, `traced`, `startSpan`) or be listed in the
catalog's `ioDelegation` with a reason, and optionally `tracedBy` naming one of
its custom spans, when its caller opens the span (a runner the traced wrapper
calls, a transport under `chat <model>`, the subprocess runtime itself). A stale
delegation (no I/O any more, or the file opens its own span) fails too.

Keep it cheap: a feature served through a dshx API or an agent tool lists the
automatic source and is done. Add a custom span only for work that leaves the
process (network, child process, a socket), runs long (an index pass, a scan)
or is a hot read worth timing; wrap the call once at the work-unit boundary,
and prove it with one `recordSpans()` test. The `traces` receiver records no
span for `/v1/traces` requests: one per batch would be exported back into it
forever; its `traces_status` counters observe them instead.

`features:report` prints the telemetry column per feature and the
automatic/custom/not-applicable totals.

Spans carry identities, outcome codes, counts and durations only: no API
arguments or results, command positionals or flag values, secret values,
prompts or error messages. Attributes, bounds and the exporter's retry and
drop policy are in the [dshx tracing guide](../tooling/dshx/docs/guides/tracing.md).
Add a span at a work-unit boundary in an owned plugin with `withSpan`; do not
log the same event a second way.

### Browser interactions (`dshfiles-web`)

The GUI records four slow interactions as root spans of service
`dshfiles-web`, through `@dshfiles/dshx/tracing/client`:

| Span            | Opened by                         | Ends when                                     |
| --------------- | --------------------------------- | --------------------------------------------- |
| `thread switch` | thread-sidebar row, main-tabs tab | the chat transcript of that thread painted    |
| `new thread`    | workspace-nav (any New thread)    | `session/create` settled and the view painted |
| `panel open`    | main-tabs tab                     | the next paint after the panel was selected   |
| `composer send` | rich-composer submit              | the Host admitted (or refused) the prompt     |

While one is open, every dshx API call the page makes becomes its `client`
child and carries its `traceparent` in the request envelope, so the Host's
`<api id>/<method>` server span (and the `jj`, `secret`, Jev spans under it)
lands in the same trace: one trace from click to Host work. Long tasks of
200 ms or more are `longtask` events on the interaction. Native requests
(`session/follow`, `session/prompt`, `session/create`) carry no trace context,
so their time shows in the browser span only.

The page never talks to the OTLP receiver directly. dshx serves a
`browser-traces` API from whichever plugin leads its registry; it validates and
bounds every batch, rate-limits all pages together and forwards through the same
target as Host spans (environment endpoint, else the in-DSH receiver, else
nothing recorded at all: the page asks the Host once and stays silent while
the answer is off). The resource is an engine class and a mobile flag only. The
new Host route needs a **DSH Host restart**; the client halves arrive by HMR and
stay silent against an old Host. Details: [browser spans in the dshx tracing
guide](../tooling/dshx/docs/guides/tracing.md#browser-spans-dshfilesdshxtracingclient).
Using them in a performance audit: [performance](performance.md#browser-interaction-traces).

## In-DSH viewer (`@dshfiles/traces`)

The seed installs `@dshfiles/traces` (row `dshfiles-traces`). Its Host runs an
OTLP/HTTP receiver on `127.0.0.1:4318`, stores spans in
`$DSH_HOME/plugins/traces/traces.db` (72 h / 100k spans by default) and serves the
**Traces** panel: a trace list with filters, a span waterfall with a per-span
attribute and resource panel, a service/operation overview with error rate and
p50/p95/p99, error groups, a service map, `/v1/logs` log search correlated with traces and
spans, and `/v1/metrics` charts.
Agents get the same reads as `traces_*` tools. It accepts any OTLP/HTTP sender,
JSON or protobuf, not only DSH.

In `plugin` and `both` modes the receiver publishes its bound address to the
Host process (`@dshfiles/dshx/tracing`), so agent telemetry, dshx tracing and
the usage metrics push deliver to it **without any environment variable**,
re-reading the target at every export; any span producer built on
`otlpExportTarget` does the same. An explicit `OTEL_EXPORTER_OTLP_ENDPOINT`
always wins.

The environment trap, when you do set a variable: the DSH UI's restart button
respawns the Host with the environment of the nixfiles `dsh-web` supervisor, so
a variable added to the launcher (`nixapply`) after the supervisor started never
reaches the Host. Restart `dsh-web` itself from a terminal after changing the
launcher environment. `traces_status` and the panel say which case applies
(`diagnosis`: `waiting`, `receiving`, `exporting-elsewhere`, `no-exporter`,
`port-in-use`, `external-mode`, `failed`) and where this process's spans and
metrics go (`exporters`). Its `mode` setting decides who owns the port:

| `mode`             | Receiver                      | `OTEL_EXPORTER_OTLP_ENDPOINT` points at          |
| ------------------ | ----------------------------- | ------------------------------------------------ |
| `plugin` (default) | on, `host:port` from settings | the receiver, `http://127.0.0.1:4318`            |
| `external`         | off                           | the external viewer (dsh-traces, a collector)    |
| `both`             | on, forwards raw bodies       | the receiver; the viewer listens on `forwardUrl` |

When another process already holds the port, the panel and `traces_status` say
`port in use`, stored traces stay browsable, and the receiver retries every 30 s.
GenAI content attributes (prompts, messages, tool payloads, only present when
content capture is opted into) are stored as their size unless
`redactGenAiContent` is turned off. `/v1/metrics` is stored too, so the usage
ledger push charts in the Metrics tab. Details, settings and decisions are in the
[traces README](../plugins/@dshfiles/traces/README.md).

Each thread also has a **Traces** tab in its conversation view, after
Trajectory: the traces in which any span carries that thread's
`dsh.session.id` (agent turn, step, model and tool spans, and the plugin spans
nested under them), a summary (spans, errors, model and tool calls, total and
p50/p95 durations, `gen_ai.usage.*` token totals over model calls), the span
waterfall per turn and the thread's correlated logs. Agent-tool calls into dshx
APIs carry the calling Session as `dsh.session.id` on their dispatch span, so a
thread's own plugin work shows even without an agent telemetry exporter. Agents
read the same through `traces_session_summary`, and `traces_search` /
`traces_search_logs` with `sessionId`.

**Alerts and boards.** Alert rules run on the traces Host every minute over the
stored spans: error rate, latency percentile, throughput, span count, or any span
longer than N (a turn over 15 minutes), each with a service / span-name prefix /
attribute filter, window, threshold and severity. A rule is `ok` or `firing`,
resolves after two clear evaluations, and keeps a bounded history. Firing shows
in the panel's Alerts tab (red count, banner), is announced in-app through the
Host `Toast` from a shell overlay (a browser notification once allowed), and
marks the threads its spans carry unread through thread-sidebar's attention
contract. Built-in rules ship enabled with conservative thresholds (model call
error rate > 20 %, jj p95 > 5 s, turn > 15 min; plugin API errors off). The
Boards tab groups spans by tool, plugin, provider (with time to first token),
job kind and jj command, and named views save the panel's filters. Agents use
`traces_alerts`, `traces_alert_save` / `_mute` / `_delete`,
`traces_alerts_evaluate` and `traces_breakdown`. Each evaluation is itself a
`traces alerts evaluate` span; this receiver keeps only the ones that changed a
rule or failed. Nothing is announced while no DSH page is open: no Host service
lets a plugin notify the user ([gap 82](../plans/dsh-host-gaps.md)).

## Decision (2026-10-24): fork LoongSuite as `@dshfiles/agent-telemetry`

LoongSuite was adopted on 2026-10-23 (below) and replaced the next day by a port, because reading its source on DSH
0.2.1-rc.2 showed what it could not do here:

1. It never set an active OpenTelemetry context: spans were built after the fact from session events on a private
   tracer provider, so nothing a tool triggered could nest under the tool span, and dshx's "nest under the active
   OpenTelemetry span" (removed with this change) never fired in a real DSH.
2. Every turn started a new root trace, and a subagent was a separate trace linked only by a
   `dsh.session.parent_id` attribute.
3. Model calls with a `purpose` (title, compaction) were skipped.
4. No span for waits (approvals, model retries, background jobs).
5. Its row was gated on `OTEL_EXPORTER_OTLP_ENDPOINT` at launch: a UI restart that reused an old environment exported
   nothing.
6. It brought the whole OpenTelemetry SDK and protobuf exporters (with an unmet peer warning) next to our
   dependency-free dshx exporter.

The port keeps its span names and GenAI attributes, its metadata-only default and content switch, and its failure
containment, and fixes the six points: dshx tracing is the only exporter, the `tools/execute` hook and the
`llm/stream` interceptor run tool bodies and model streams with their span active, subagent turns parent under the
delegation tool span (shown in one trace in a real scratch DSH: `execute_tool subagent` → the child's
`enter_ai_application_system` with `dsh.trace.parent_link=async-context`), and the row has no environment gate.
Provenance and the update policy are in its [UPSTREAM.md](../plugins/@dshfiles/agent-telemetry/UPSTREAM.md); the
Host events it cannot reach are in [Host gaps](../plans/dsh-host-gaps.md).

Agent telemetry's `llm/stream` interceptor and `tools/execute` wrapper sit in the model and tool paths and pass them
through untouched when there is no destination; if a model or tool call misbehaves only with it, disable the
`dshfiles-agent-telemetry` row in Settings (takes effect live).

Dropped with LoongSuite: its GenAI metrics (`gen_ai.client.operation.duration`, `gen_ai.client.token.usage`); the
usage ledger push covers tokens and durations.

## Earlier decision (2026-10-23, b:299)

Two marketplace plugins export DSH spans. Both read on DSH 0.2.1-rc.2:

|                     | `@loongsuite/dsh-plugin` 0.1.3 (adopted, then forked)                                                                                                           | `dsh-observe` 0.2.25                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Source / license    | [loongsuite/dsh-plugin](https://github.com/loongsuite/dsh-plugin), Apache-2.0                                                                                   | [PerryLink/dsh-observe](https://github.com/PerryLink/dsh-observe), Apache-2.0                                         |
| DSH contract        | No peer ranges; injects `sessions`, `llm`; listens to `session/created`, `session/event`, `session/disposed` and wraps `llm/stream` — all present in 0.2.1-rc.2 | Peer ranges include `>=0.2.1-0 <0.3.0`; injects `storageDomain`; reads `session/event`, `tokenMeter`                  |
| Export config       | Standard `OTEL_EXPORTER_OTLP_*` variables, or Loader config                                                                                                     | Loader config only (`otlp.endpoint`); no environment variables                                                        |
| Content by default  | None; one opt-in switch (`captureContent` or the GenAI env variable)                                                                                            | Prompts and completions **on**; tool input/output always exported (truncated), no switch short of dropping tool spans |
| OTLP implementation | Official OpenTelemetry JS SDK 2.x, protobuf                                                                                                                     | Hand-written OTLP JSON plus a Langfuse sink and an on-disk offline buffer                                             |

dsh-observe was the starting lean, but it fails the metadata-only requirement:
tool inputs and outputs are attached to every tool span with no opt-out, and
it ignores the standard environment variables. LoongSuite meets both and uses
the upstream SDK.

The stock `@deepseek-ai/dsh-session-telemetry-otel` row is unrelated: it
uploads feedback-authorized Session logs as OTLP logs, and the seed keeps it
disabled.

### Evidence

- Scratch `DSH_HOME` with the `headless` profile, the plugin and the keyless
  `dsh-our-free-model` route (`kilo-auto/free`), a local Node receiver on a free
  port. Without the variable: zero requests. With it, one turn that ran `bash`
  produced two `/v1/traces` posts and one `/v1/metrics` post containing
  `invoke_agent`, `react step`, two `chat kilo-auto/free` spans (an upstream 503
  attempt marked `error.type`, then the successful one) and `execute_tool bash`.
  The prompt's `echo hi` and the reply text appear nowhere in the payloads.
  Spans flush on headless exit.
- A scratch copy of the live `web` profile reconciled by
  `scripts/profile-sync.ts` with this seed composes the gated row and boots on a
  scratch port with the variable set and no activation failures
  (`pnpm profile:boot`).

### Known caveats (LoongSuite, resolved by the fork)

- pnpm reported unmet peers: the OpenTelemetry SDK 2.x packages want
  `@opentelemetry/api <1.10.0` and 1.10.0 resolved.

## Update policy

`@dshfiles/agent-telemetry` follows LoongSuite by reading, not by version pin: on a new release, diff its
`src/coordinator.ts` and `src/mapping.ts` against the commit recorded in
[UPSTREAM.md](../plugins/@dshfiles/agent-telemetry/UPSTREAM.md), port span and attribute changes, and rerun the
plugin's tests and its journey.

# Tracing

`@dshfiles/dshx/tracing` is a small Host-only OpenTelemetry tracer. It records **metadata-only** spans and exports
them as OTLP/HTTP JSON. It adds no dependency and is off unless an OTLP endpoint is configured.

Status: **API Candidate**. Host bundles only (it uses `node:async_hooks`); never import it into Client code.

## Enable export

Export follows the standard OpenTelemetry environment variables of the process that runs the code — the DSH Host for
plugins, the shell for `dshx` CLI commands:

| Variable                                                          | Effect                                                                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`                              | Full traces URL, used as given (e.g. `http://127.0.0.1:4318/v1/traces`). Wins over the next.                                                                                   |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                     | Base URL; `/v1/traces` is appended (e.g. `http://127.0.0.1:4318`).                                                                                                             |
| `OTEL_SERVICE_NAME`                                               | `service.name` resource attribute; default `dshfiles`.                                                                                                                         |
| `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | `key=value,key2=value2` (URL-encoded) request headers, e.g. a collector API key; the traces one wins per key. Reference keys through the environment, never a checked-in file. |
| `OTEL_SDK_DISABLED=true`, `OTEL_TRACES_EXPORTER=none`             | Forces export off.                                                                                                                                                             |

With neither endpoint set, spans go to the **in-process receiver** when one is published (below); with no receiver
either (or a non-HTTP endpoint, which is never replaced), every span is one shared frozen no-op: `startSpan` allocates
nothing, `withSpan` just awaits the callback, and nothing is queued or sent.

### In-process receiver (no environment needed)

A Host plugin that runs an OTLP/HTTP receiver in the same process (`@dshfiles/traces`) announces it, and every
exporter of that process delivers there while no `OTEL_EXPORTER_OTLP_*` endpoint is set:

```ts
import { localOtlpEndpoint, otlpExportTarget, publishLocalOtlpEndpoint } from '@dshfiles/dshx/tracing'

// receiver owner, once it listens; call the result when it stops or moves
const withdraw = publishLocalOtlpEndpoint({ baseUrl: 'http://127.0.0.1:4318', owner: '@dshfiles/traces' })

// any exporter, at export time (not once at load: the receiver can bind later, move or vanish)
const target = otlpExportTarget({ signal: 'metrics' }) // { source: 'environment' | 'local-receiver' | 'off', url }
```

| Export                                         | Contract                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishLocalOtlpEndpoint({ baseUrl, owner })` | `baseUrl` without `/v1/…`; a non-http(s) URL publishes nothing. Returns a withdraw function that removes only this publication. One receiver per process; the latest wins.                                                                      |
| `localOtlpEndpoint()`                          | `{ baseUrl, owner }` or `undefined`.                                                                                                                                                                                                            |
| `otlpExportTarget({ signal })`                 | `traces`, `metrics` or `logs`. `OTEL_SDK_DISABLED=true` / `OTEL_<SIGNAL>_EXPORTER=none` → `off`; `OTEL_EXPORTER_OTLP_<SIGNAL>_ENDPOINT` as given; `OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/<signal>`; a non-http(s) one → `off`; else the receiver. |

An environment endpoint always wins. When the target is the local receiver, do not send `OTEL_EXPORTER_OTLP_HEADERS`:
they belong to the configured collector. The value lives on `globalThis` under
`Symbol.for('@dshfiles/dshx.otlp-local-endpoint.v1')`, so every bundled dshx copy sees one receiver. The dshx tracer
itself reads it on every span and every batch; the usage plugin's metrics push reads it per export.

The body is always JSON (`content-type: application/json`), whatever `OTEL_EXPORTER_OTLP_PROTOCOL` says; the
OpenTelemetry Collector, Jaeger, Tempo and most vendors accept it on the same `/v1/traces` path.

A live DSH reads the variables once, when the first span starts. Setting them takes a **DSH Host restart** with the
variables in its environment — the user's decision, never an agent's. The DSH UI's restart button respawns the Host
with the environment of the process that supervises it (the nixfiles `dsh-web` supervisor), so a variable added to the
launcher afterwards needs `dsh-web` itself restarted from a terminal. The in-process receiver below needs neither.

```sh
# A local collector, e.g. Jaeger all-in-one listening on 4318:
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_SERVICE_NAME=dsh-verify \
  DSH_HOME=/private/tmp/dsh-verify dsh web --port 3199 --no-open
```

## What is recorded

| Span                 | Kind     | Where                                                | Attributes                                                                                                                                                                                                                                                           |
| -------------------- | -------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<api id>/<method>`  | server   | every dshx API dispatch (Client, plugin, agent tool) | `dshx.plugin.package`, `dshx.api.id`, `dshx.api.method`, `dshx.api.caller` (+ `.package` for plugin callers), `dshx.api.outcome` (`ok` or error code), `dshx.api.duration_ms`, `rpc.system/service/method`, `dsh.session.id` (agent-tool calls: the calling Session) |
| `<api id>/<method>`  | client   | `createDshxApiCaller` (remote dshx API calls)        | `rpc.*`, `dshx.plugin.package`, `dshx.api.remote`                                                                                                                                                                                                                    |
| `dshx checkout sync` | internal | the CLI                                              | workspace, bookmark, dry run, status, changed-file and rebuilt-plugin counts, restart needed                                                                                                                                                                         |

Owned plugins add child spans: `jj <subcommand>` (jujutsu, jj-integration), `secret <verb>` and `secret resolve`
(secret-catalog), `jev classify` (backlog, memory), `<namespace>/<method>` gateway requests (multi-host) and
`jj-integration workspace sync`. See [observability](../../../../docs/observability.md#spans-from-our-own-code-dshx), which also covers the agent turn, model and tool spans of `@dshfiles/agent-telemetry`.

Never recorded: API inputs and outputs, command positionals and flag values (paths, revisions, messages, file
contents), secret values, prompt text, error messages. A thrown error marks the span `error` with its class and string
`code` only (`TypeError:cli-failed`), and still rethrows.

Bounds: span names 128 characters, 64 attributes per span, strings 1,024 characters, lists 64 items.

## API

```ts
import { commandAttributes, tracingEnabled, withSpan } from '@dshfiles/dshx/tracing'

const run = (args: readonly string[]) =>
  withSpan('tool run', { kind: 'client', attributes: commandAttributes({ executable: 'tool', args, valueFlags: ['-o'] }) }, async span => {
    const result = await spawnTool(args)
    span.setAttribute('process.exit.code', result.exitCode)
    return result
  })
```

| Export                                                 | Purpose                                                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withSpan(name, options?, run)`                        | Runs `run` inside a span; nested spans (in any plugin of the process) become its children; ends when `run` settles.                                                      |
| `startSpan(name, options?)`                            | A span the caller must `end()`; parented to the active span unless `options.parent` is given (`null` = new trace).                                                       |
| `tracingEnabled()`                                     | Skip building expensive attributes when export is off.                                                                                                                   |
| `commandAttributes({ executable, args, valueFlags? })` | Executable name, up to two adjacent leading subcommand words, flag names without values, argument count. Name every flag whose next argument is a value in `valueFlags`. |
| `traceparent()` / `parseTraceparent()`                 | W3C `traceparent` header for the active span, to continue a trace in another process; incoming API routes read it.                                                       |
| `activeSpanContext()`, `flushTracing()`                | The active `{ traceId, spanId }`; send everything queued now (never rejects).                                                                                            |
| `withActiveSpan(span, run)`                            | Run `run` (sync or async) with an existing span as the active parent; the caller still ends the span.                                                                    |
| `traced(name, fn, options?)`                           | `fn` wrapped so each call runs in a span; `options` may be a function of the call's arguments.                                                                           |
| `pluginAttributes({ plugin, attributes })`             | `{ 'dshx.<plugin>.<key>': value }`; throws on a non-kebab plugin or a non-`snake_case` key.                                                                              |
| `redactIdentifier`, `contentSize`, `truncateText`      | Keep a value only when it is one bounded identifier token; record a payload's size instead of it; cut deliberate text.                                                   |
| `recordSpans()`                                        | In-memory recorder of every span ended in the process, endpoint or not: `span(name)`, `named()`, `children()`, `stop()` / `using`.                                       |

`Span` has `setAttribute`, `setAttributes`, `setStatus('ok' | 'error', message?)`, `recordFailure(error)` and `end()`;
`recording` is false on the no-op span.

## Add tracing to a plugin

**What you get for free.** With `@dshfiles/agent-telemetry` in the profile, no plugin code is needed for:

- every dshx API method the plugin serves (`<api id>/<method>`, server span), whoever calls it;
- every agent tool it registers, dshx-bound or `defineTool` (`execute_tool <name>`, from the `tools/execute` hook,
  keyed by tool name, nothing per plugin);
- every model stream it opens through `ctx.llm` (`chat <model>`, with `dsh.llm.purpose` when one is set);
- the shared process helpers it calls: `jj` runs (jujutsu), `secret` lookups (secret-catalog), Jev requests, multi-host
  gateway calls.

They nest: a tool that calls a plugin API that runs `jj` shows as `execute_tool` → `<api>/<method>` → `jj <verb>`.

**One-line custom span** at a work-unit boundary (one per unit of work, not per loop iteration):

```ts
import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'

const result = await withSpan('backlog triage', { attributes: pluginAttributes({ plugin: 'backlog', attributes: { items: ids.length } }) }, () => triage(ids))
// or wrap the function once: export const triage = traced('backlog triage', run, ids => ({ attributes: … }))
```

It parents to whatever is active (the tool call, the API dispatch, the turn's model call), and a throw marks it failed
with the error class and string `code` only.

**Conventions.**

- Span name: `<subject> <verb>` in lowercase (`backlog triage`, `jj log`, `secret resolve`), at most 128 characters;
  put identifiers in attributes, not in the name (except the GenAI `chat <model>` / `execute_tool <tool>` forms).
- Attributes: the standard key when one exists (`gen_ai.*` for model and tool facts, `process.*` for subprocesses,
  `rpc.*`, `error.type`, `dsh.session.id` for a thread); otherwise `dshx.<plugin>.<key>` through `pluginAttributes`.
- Values: identities (`redactIdentifier`), counts, sizes (`contentSize`), durations, outcome codes. Never arguments,
  results, prompts, file contents, paths a user typed, secret values or error messages.

**Test kit.** Assert spans in a unit test without an endpoint:

```ts
import { recordSpans } from '@dshfiles/dshx/tracing'

using recorder = recordSpans()
await triage(['b:1'])
expect(recorder.span('backlog triage').attributes['dshx.backlog.items']).toBe(1)
```

`recorder.children(span)` checks nesting; the recorder sees spans from every dshx copy in the process, so a test of
one plugin also sees the API and process spans its call caused. Recording turns tracing on for the process, so code
guarded by `tracingEnabled()` records too.

**Declare it in the catalog.** Every `dshx.features.json` feature lists `telemetry`, and `features:check` and
`dshx build` check it: `automatic` sources (`api-dispatch`, `agent-tool`, `model-stream`, `jj`, `secret`,
`multi-host`) need Host-code evidence, a `custom` span needs a Host source string with its name and a named test that
calls `recordSpans()` and asserts it, and every Host file that does network or process I/O opens a span or is named in
`ioDelegation`. `dshx create` scaffolds `src/work.ts`, `tests/telemetry.spec.ts` and a catalog that already pass. The
contract is described in [observability](../../../../docs/observability.md#the-telemetry-contract-checked).

```json
"telemetry": [
  { "kind": "automatic", "source": "api-dispatch" },
  { "kind": "custom", "span": "backlog triage", "file": "plugins/@dshfiles/backlog/src/triage.test.ts", "testName": "records a backlog triage span" }
]
```

## Runtime model

- Every plugin bundles its own dshx copy, so the tracer lives on `globalThis` under
  `Symbol.for('@dshfiles/dshx.tracing.v2')`: all copies share one `AsyncLocalStorage` and one export queue, and a span
  opened while plugin A serves a call parents the spans plugin B opens. A change to the shared tracer shape needs a new
  symbol version (v2: a tracer created before the receiver was published starts recording once it is).
- Agent work is in the same context: `@dshfiles/agent-telemetry` runs every agent tool body and every model stream
  with its `execute_tool` / `chat` span active (`withActiveSpan`), so a dshx span opened by a tool nests under it. dshx
  no longer reads the `@opentelemetry/api` global context; a span from another OpenTelemetry SDK in the process does
  not parent dshx spans (W3C `traceparent` across processes still does).
- The exporter batches up to 512 spans every 5 s, holds at most 2,048 (newer spans drop when full), retries
  `429/502/503/504` and network failures with jittered exponential backoff (1 s doubling to 60 s, 5 attempts), drops
  other failures, and times a request out after 10 s. It never throws into the code that ended a span.
- Queued spans flush when an API is disposed (plugin reload or Host stop), on `beforeExit`, and at the end of
  `dshx checkout sync`.

The OTLP encoding follows the [OTLP JSON mapping](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding):
lowercase hex `traceId`/`spanId`, decimal-string `startTimeUnixNano`/`endTimeUnixNano`/`intValue`, integer `kind`
(1 internal … 5 consumer) and `status.code` (0 unset, 1 ok, 2 error). `tests/tracing.spec.ts` pins it.

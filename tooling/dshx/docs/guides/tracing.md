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
`jj-integration workspace sync`. See [observability](../../../../docs/observability.md#spans-from-our-own-code-dshx), which also covers the adopted LoongSuite plugin's core spans.

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
| `withSpan(name, options, run)`                         | Runs `run` inside a span; nested spans (in any plugin of the process) become its children; ends when `run` settles.                                                      |
| `startSpan(name, options?)`                            | A span the caller must `end()`; parented to the active span unless `options.parent` is given (`null` = new trace).                                                       |
| `tracingEnabled()`                                     | Skip building expensive attributes when export is off.                                                                                                                   |
| `commandAttributes({ executable, args, valueFlags? })` | Executable name, up to two adjacent leading subcommand words, flag names without values, argument count. Name every flag whose next argument is a value in `valueFlags`. |
| `traceparent()` / `parseTraceparent()`                 | W3C `traceparent` header for the active span, to continue a trace in another process; incoming API routes read it.                                                       |
| `activeSpanContext()`, `flushTracing()`                | The active `{ traceId, spanId }`; send everything queued now (never rejects).                                                                                            |

`Span` has `setAttribute`, `setAttributes`, `setStatus('ok' | 'error', message?)`, `recordFailure(error)` and `end()`;
`recording` is false on the no-op span.

## Runtime model

- Every plugin bundles its own dshx copy, so the tracer lives on `globalThis` under
  `Symbol.for('@dshfiles/dshx.tracing.v2')`: all copies share one `AsyncLocalStorage` and one export queue, and a span
  opened while plugin A serves a call parents the spans plugin B opens. A change to the shared tracer shape needs a new
  symbol version (v2: a tracer created before the receiver was published starts recording once it is).
- With no dshx span active, a new span takes the active OpenTelemetry API span as its parent (read through the
  `Symbol.for('opentelemetry.js.api.1')` global and the `OpenTelemetry Context Key SPAN` context key that
  `@opentelemetry/api` 1.x shares across copies, without depending on it). Under the adopted LoongSuite plugin, a dshx
  API call made by an agent tool therefore nests under that tool's `execute_tool` span. Verified against
  `@opentelemetry/api` 1.9.1; 1.10.0 uses the same keys.
- The exporter batches up to 512 spans every 5 s, holds at most 2,048 (newer spans drop when full), retries
  `429/502/503/504` and network failures with jittered exponential backoff (1 s doubling to 60 s, 5 attempts), drops
  other failures, and times a request out after 10 s. It never throws into the code that ended a span.
- Queued spans flush when an API is disposed (plugin reload or Host stop), on `beforeExit`, and at the end of
  `dshx checkout sync`.

The OTLP encoding follows the [OTLP JSON mapping](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding):
lowercase hex `traceId`/`spanId`, decimal-string `startTimeUnixNano`/`endTimeUnixNano`/`intValue`, integer `kind`
(1 internal … 5 consumer) and `status.code` (0 unset, 1 ok, 2 error). `tests/tracing.spec.ts` pins it.

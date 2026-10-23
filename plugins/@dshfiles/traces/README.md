# @dshfiles/traces

![Trace list and span waterfall](docs/screenshots/trace-explorer.png)

A local OpenTelemetry viewer inside DSH, in the spirit of [Maple Local](https://maple.dev/): one OTLP/HTTP receiver on
`127.0.0.1:4318`, an embedded SQLite store, a typed query API with agent tools, and a **Traces** panel with a trace
list, a span waterfall, a per-span attribute panel, log search correlated with traces and spans, a service map, a
service/operation overview and error groups.

It is a generic viewer: anything that speaks OTLP/HTTP can send to it, with any `service.name`, resource, scope,
span kind or attribute key. DSH-specific touches are enrichments only: a span carrying `dsh.session.id` gets an
**Open thread** button.

Choice: **build with dshx**. The marketplace has exporters (LoongSuite, dsh-observe) but no in-DSH viewer, and an
external viewer (otel-desktop-viewer, Jaeger) cannot open a DSH thread or serve agent tools.

## Sending telemetry here

Point an exporter at the receiver with the standard variable:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
```

For DSH itself, that variable in the `dsh web` environment (nixfiles sets it) enables the adopted LoongSuite plugin
(turn, step, model and tool spans, protobuf), dshx tracing (plugin API, jj, secret, Jev spans, JSON) and the usage
plugin's metrics push. With this plugin in `plugin` mode the Host sends them to its own receiver. Setting the variable
takes a DSH Host restart; see [observability](../../../docs/observability.md#in-dsh-viewer-dshfilestraces).

## Settings (`dshfiles-traces`)

| Setting              | Default     | Effect                                                                                                                                  |
| -------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`               | `plugin`    | `plugin`: the receiver owns the port. `external`: receiver off, another viewer owns it. `both`: store here and forward to `forwardUrl`. |
| `host`               | `127.0.0.1` | Listen address.                                                                                                                         |
| `allowNonLoopback`   | `false`     | A non-loopback `host` is refused unless this is on.                                                                                     |
| `port`               | `4318`      | OTLP/HTTP port; `0` picks a free one (the panel shows it).                                                                              |
| `forwardUrl`         | empty       | `both` mode: the external viewer's OTLP base URL, e.g. `http://127.0.0.1:4319`. The raw body is forwarded to `/v1/<signal>`.            |
| `externalViewerUrl`  | empty       | Linked from the panel in `external` and `both` modes, e.g. `http://127.0.0.1:8000` for otel-desktop-viewer.                             |
| `redactGenAiContent` | `true`      | Store GenAI message, prompt and tool-payload attributes as `[redacted: N chars]`. The span panel says when a value was redacted.        |
| `retentionHours`     | `72`        | Drop telemetry received longer ago.                                                                                                     |
| `retentionSpans`     | `100000`    | Keep at most this many spans; whole traces drop, oldest first.                                                                          |
| `retentionLogs`      | `100000`    | Keep at most this many log records, oldest first.                                                                                       |

Settings apply live: changing `mode`, `host` or `port` restarts the receiver without a Host restart.

How the modes map to `OTEL_EXPORTER_OTLP_ENDPOINT`:

- `plugin` / `both`: the endpoint is this receiver, `http://<host>:<port>`.
- `external`: the endpoint is the external viewer; this panel only shows what it stored before.
- `both` with an external viewer: run the viewer on another port (for example 4319) and set `forwardUrl` to it.

## Agent tools

Every read the panel makes is a read-only tool; the one destructive verb needs an explicit opt-in.

| Tool                   | What it returns                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `traces_search`        | Traces newest first; filter by service, operation, error status, min duration, time, text, DSH session. |
| `traces_get`           | One trace as a depth-first span tree with offsets, attributes, events and resource attributes.          |
| `traces_list_services` | Per service and operation: count, error rate, p50/p95/p99 and max duration over a window.               |
| `traces_search_logs`   | Log records newest first; filter by service, min severity, text, one attribute, trace or span id, time. |
| `traces_service_map`   | Services with span count, error rate and latency; cross-service parent → child calls with counts.       |
| `traces_error_groups`  | Error spans grouped by service, operation, error type and message shape, with a sample trace.           |
| `traces_status`        | Receiver mode, address, state, counters, forwarding and store size.                                     |
| `traces_clear`         | Deletes every stored trace and log record; requires `confirm: true`.                                    |

## Decisions

- **Port strategy.** Default to the standard 4318 so a stock `OTEL_EXPORTER_OTLP_ENDPOINT` works. When another process
  holds it (otel-desktop-viewer, a collector), the receiver reports `port in use` in the panel and the status tool,
  keeps serving what is stored, and retries every 30 s, so stopping the other viewer hands the port over without a
  restart. `mode: external` turns the receiver off on purpose.
- **Protobuf.** LoongSuite uses `@opentelemetry/exporter-trace-otlp-proto`, which always sends protobuf and ignores
  `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`, so protobuf has to be decoded. `@opentelemetry/otlp-transformer` 0.222 only
  serializes requests (it dropped protobufjs), so `src/otlp/protobuf.ts` is a small decoder for
  `ExportTraceServiceRequest` (opentelemetry-proto v1 field numbers) that emits the OTLP JSON mapping; both wire
  formats then cross one zod schema and one normalizer. Tests encode with the official SDK serializers
  (`ProtobufTraceSerializer`, `JsonTraceSerializer`, devDependencies only) and require identical spans from both.
- **Bounds.** Request bodies over 8 MiB get 413, gzip/deflate bodies may inflate to 32 MiB; span names keep 256
  characters, 128 attributes of 2,048 characters, 64 list items and 32 events.
- **Storage.** SQLite (`node:sqlite`, like usage and memory) at `$DSH_HOME/plugins/traces/traces.db`: spans, one row
  per trace (root, duration, counts, services, session) and deduplicated resource attributes. Retention drops whole
  traces so a kept trace never loses part of its tree.
- **Self-spans.** dshx records a span for every API dispatch; the traces API's own (`dshx.api.id = traces`) are
  dropped at ingest so the panel's 5-second polling never shows up as traces of itself.
- **Logs.** `POST /v1/logs` (JSON or protobuf, same decoder and bounds) stores records with severity, body (8 KiB),
  attributes, resource and their trace/span ids. The Logs tab filters by text, service, minimum severity and one
  `key=value` attribute; a record opens its trace, and a trace or a span opens only its own logs. With
  `redactGenAiContent`, a GenAI content event (`gen_ai.*` event name) keeps only its body size.
- **Service map.** An edge is a span whose parent belongs to another service (no `peer.service` guessing), so it
  only shows calls both sides exported. The SVG lays services out in columns by their longest incoming call chain;
  no graph library is involved.
- **Metrics.** `/v1/metrics` is accepted (200) and forwarded in `both` mode but not stored yet; the overview is
  computed from spans.

## Follow-ups

- Stored metrics with one chart per metric.
- Out of scope: alerting, dashboards and a query builder, session replay.

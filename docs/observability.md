# Observability: OpenTelemetry traces

The `web` profile can export OpenTelemetry spans for every agent turn, ReAct
step, model call and tool call. It uses the marketplace plugin
[`@loongsuite/dsh-plugin`](https://www.npmjs.com/package/@loongsuite/dsh-plugin)
(adopted, not ported or built), and exports nothing unless the Host process
starts with `OTEL_EXPORTER_OTLP_ENDPOINT` set.

## Turning it on

The seed (`profiles/web/package.json` and the managed region of
`profiles/web/cordis.patch.yml`) installs the plugin and gates its Loader row:

```yaml
- id: loongsuite-observability
  disabled: !!js '!process.env.OTEL_EXPORTER_OTLP_ENDPOINT'
```

The `!!js` expression is evaluated once at boot, so set the variables in the
environment of the `dsh web` process (the nixfiles supervisor), then restart
the DSH Host process. Without the variable the row stays disabled and nothing
is collected or sent.

The plugin reads the standard OpenTelemetry exporter variables:

| Variable                                                    | Effect                                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                               | OTLP/HTTP base URL, e.g. `http://127.0.0.1:4318`; `/v1/traces` and `/v1/metrics` are appended. Required here: it also enables the row.                 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `…_METRICS_ENDPOINT` | Per-signal full URLs, overriding the base.                                                                                                             |
| `OTEL_EXPORTER_OTLP_HEADERS`                                | `key=value,…` headers, e.g. a collector token. Keep the value in the environment, never in the profile.                                                |
| `OTEL_METRICS_EXPORTER=none`                                | Traces only.                                                                                                                                           |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`        | Opt-in content capture: `SPAN_ONLY` or `SPAN_AND_EVENT` put prompts, completions, tool arguments and tool results on spans. Unset means metadata only. |

The wire format is OTLP/HTTP protobuf (`application/x-protobuf`), so any OTLP
collector, Jaeger, Grafana Tempo, Langfuse's OTLP endpoint or
`comma otel-desktop-viewer` can receive it. Traces go only where the endpoint
points; the plugin has no default remote backend.

## What a span carries

Per turn one `invoke_agent deepseek-harness` span, with `react step`,
`chat <model>` (one per LLM attempt, retries included) and
`execute_tool <name>` children. Attributes follow the GenAI semantic
conventions: `gen_ai.request.model`, `gen_ai.provider.name`,
`gen_ai.usage.*_tokens`, `gen_ai.response.finish_reasons`,
`gen_ai.response.time_to_first_token`, `gen_ai.tool.name`, `gen_ai.tool.call.id`,
`error.type`, plus `dsh.session.id`, `dsh.turn`, `dsh.step` and
`dsh.session.cwd` (the Session's working directory — a local path). Token and
duration metrics go to `/v1/metrics`.

By default no message text, tool argument or tool result leaves the Host.

## Decision (2026-10-23, b:299)

Two marketplace plugins export DSH spans. Both read on DSH 0.2.1-rc.2:

|                     | `@loongsuite/dsh-plugin` 0.1.3 (adopted)                                                                                                                        | `dsh-observe` 0.2.25                                                                                                  |
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

### Known caveats

- pnpm reports unmet peers: the OpenTelemetry SDK 2.x packages want
  `@opentelemetry/api <1.10.0` and 1.10.0 resolves. The export works; revisit if
  the SDK misbehaves.
- The `llm/stream` interceptor sits in the model stream path; if a model request
  misbehaves only with the plugin enabled, unset the variable and restart.

## Update policy

The version is pinned exactly in the seed. To upgrade, read the new release's
`dist/config.js` and `dist/coordinator.js` for content defaults, rerun the
headless receiver probe above, then bump the pin.

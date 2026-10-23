# Upstream

- **Package replaced:** `@loongsuite/dsh-plugin` (Apache-2.0), row id `loongsuite-observability`, removed from the
  `web` seed in the same stack.
- **Upstream version read:** `0.1.3` — [loongsuite/dsh-plugin](https://github.com/loongsuite/dsh-plugin) tag `v0.1.3`,
  commit `f44ccfcd2255186bfcfe1c9f8c7db047204865b7`; span naming and finish-attribute rules from
  `@loongsuite/otel-util-genai` `0.1.1` (`extended-handler.js`, `span-utils.js`, `extended-span-utils.js`).
- **Shape:** a TypeScript reimplementation against dshx, not a vendored copy, so there is no `native-fork.json` (that
  record is for byte-identical forks of native DSH packages). `LICENSE` is upstream's; `NOTICE` names both sources.

## Behaviour kept

| Upstream                                                                                                                                                                                            | Here                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `enter_ai_application_system` (server) → `invoke_agent <agent>` (client) → `react step` → `chat <model>` (client, one per attempt) and `execute_tool <tool>` (internal)                             | `src/coordinator.ts`, `src/genai.ts` `GenAiNames`            |
| `gen_ai.operation.name` / `gen_ai.span.kind` per span, `gen_ai.session.id`, `gen_ai.turn.id`, `gen_ai.step.id`, `gen_ai.agent.*`, `gen_ai.conversation.id`, `dsh.session.*`, `dsh.turn`, `dsh.step` | `sessionAttributes`, `stepAttributes`, `operationAttributes` |
| Usage: DSH's disjoint cache buckets summed into `gen_ai.usage.input_tokens`; turn totals on `invoke_agent`; `gen_ai.usage.reasoning_tokens`                                                         | `GenAi.usageAttributes`, `GenAi.totalsAttributes`            |
| Finish reasons (`tool_calls`, `length`, `cancelled`), `gen_ai.react.finish_reason`, `dsh.turn.end_reason`, `dsh.llm.attempt`, TTFT in ns, `langfuse.observation.completion_start_time`              | `GenAi.finishReason`, `observeChunk`                         |
| Content capture off by default; `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY\|SPAN_AND_EVENT` or the setting turns it on; truncation marker JSON                                   | `src/settings.ts`, `GenAi.serializeCaptured`                 |
| No history replay on adoption (HMR would duplicate spans); every Host callback contained                                                                                                            | `adopt`, `contained`                                         |

## Delta

- **Exporter.** dshx tracing (OTLP/HTTP JSON, one shared queue, the traces plugin's in-process receiver) replaces the
  OpenTelemetry SDK, its protobuf exporters and `@loongsuite/otel-util-genai`. LoongSuite's GenAI metrics
  (`gen_ai.client.*`) are not exported; the usage plugin pushes the ledger's token and duration metrics.
- **Enablement.** No `disabled: !process.env.OTEL_EXPORTER_OTLP_ENDPOINT` gate: spans are no-ops until dshx has a
  destination, read at each span.
- **Active context.** `tools/execute` runs each tool body with its `execute_tool` span active; `llm/stream` pulls
  every chunk with its `chat` span active. Upstream built spans after the fact on a private provider, so nothing a
  tool did could nest under it.
- **Subagents.** A subagent's turns parent under the parent's delegation tool span (one trace), recorded as
  `dsh.trace.parent_link`; upstream started a new trace per turn everywhere.
- **More spans.** Model calls with a `purpose` and outside a step (`dsh.llm.purpose`, `dsh.llm.standalone`), nested
  `run_code` dispatches, `compaction`, `approval wait`, `llm retry wait`, `job <kind>`, and
  `dsh.inbox.spliced_messages`.
- **Redaction.** Status messages are an error type or code (upstream used provider and tool messages); content
  values are bounded by dshx to 1,024 characters (upstream: 128,000).
- **Dropped.** The Loader `Config` (endpoint, headers, batch sizes, debug): the standard `OTEL_*` variables and the
  traces receiver configure dshx tracing for every plugin at once.

## Update policy

On a new LoongSuite release, diff `src/coordinator.ts` and `src/mapping.ts` between the recorded commit and the new
tag, plus `@loongsuite/otel-util-genai`'s `extended-span-utils.js` / `span-utils.js` for attribute renames. Port span
or attribute changes (keep the GenAI names so other viewers read the data), ignore SDK and exporter changes, run
`pnpm --dir plugins/@dshfiles/agent-telemetry test`, then update the version and commit above. Revisit when DSH ships
its own OpenTelemetry instrumentation: if it emits the same tree with an active context, drop this package.

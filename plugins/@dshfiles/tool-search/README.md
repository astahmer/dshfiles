# @dshfiles/tool-search

Opt-in Native Tool Mode plugin for per-agent progressive disclosure of global tools.

Inspired by and adapted from [`vibeinging/dsh-tool-search`](https://github.com/vibeinging/dsh-tool-search), an experimental MIT-licensed implementation. This plugin retains its MIT license in [LICENSE](LICENSE). The upstream README describes a private experimental repository; no upstream version or commit was vendored. Search ranking and the Host integration here are adapted to the installed DSH 0.2.1-rc.2 APIs. Update policy: re-check the upstream design and the installed DSH tool/session contracts before updating this adaptation.

## Opt-in installation

This package is not included in the web profile by default. Add `@dshfiles/tool-search` to a profile's dependencies and include its `cordis.patch.yml` entry only in the profile where progressive disclosure is wanted. It does not install a replacement tool registry or modify DSH core.

```yaml
- id: dshfiles-tool-search
  name: '@dshfiles/tool-search'
  config:
    alwaysVisible: [read_file, todo_*]
    maxResults: 5
    maxQueryChars: 512
```

`alwaysVisible` accepts trimmed tool names with `*` as the only wildcard. `maxResults` must be an integer from 1 through 100; `maxQueryChars` must be an integer from 1 through 4096. Defaults are `[]`, `5`, and `512`.

## Behavior and safety

Every live agent gets a scope-local `tool_search` tool. Initial visibility is limited to `alwaysVisible`; other eligible global tools can be found by exact name, name fragments, or BM25-ranked name/description matches. A selection updates only this plugin's per-agent `tools.restrict({ allow })` contribution. DSH's tool registry still intersects other restrictions and policies; selected-but-denied tools are reported as `unavailable`. Scoped tools remain governed by DSH's scoped registry rules.

The catalog is per-agent and restricted to global tools already visible to that agent at attachment time. Agents that begin with an unrestricted global view admit future registrations, including dynamically registered MCP tools; agents already behind a separate restriction keep their original eligible-name set. `alwaysVisible` is the explicit way to admit known tools by name pattern.

Calls nested through Code Mode (`run_code`) are rejected. The current API does not expose a supported deferred-loading contract for Code Mode, so the plugin fails closed rather than widening nested dispatch.

On resume and fork, the plugin reconstitutes selected global tool names from the session's last durable `request/header`, using the supported `Session.requestHeader()` fold. It deliberately does not invent an ignorable custom session event: stock DSH's persisted known-event catalog cannot safely replay required downstream event types. If the process ends after a selection but before another model request records a new request header, that selection is not durable and must be searched again.

Unloading the plugin lifts only the restrictions and scoped registrations it owns. Existing agents are attached when the plugin starts; new agents are attached before their subsequent model requests.

## Local measurement

The tiny in-process AgentLoop comparison uses one `defineTool` fixture and a scripted adapter; it makes no provider calls:

| Mode                  |                   Initial tool schema |                  After discovery | Requests | Total tool tokens |
| --------------------- | ------------------------------------: | -------------------------------: | -------: | ----------------: |
| Direct visibility     |  200 JSON bytes / 54 estimated tokens |                                — |        2 |               108 |
| Progressive discovery | 492 JSON bytes / 127 estimated tokens | 691 bytes / 177 estimated tokens |        3 |               481 |

For this tiny catalog, discovery starts 73 estimated tokens higher, adds one model request, and raises cumulative tool-schema tokens from 108 to 481.

A second keyless AgentLoop comparison uses the same three representative tasks as the provider fixture and an eight-tool catalog (three task tools, five decoys). The adapter supplies a hand-written natural-language discovery query rather than the target tool name, then selects the expected tool deterministically; assertions verify the search result exposed it. All tool effects stay in memory:

| Mode                  | Requests across 3 tasks | Serialized tool-schema bytes | TokenMeter tool-token estimate | Cumulative request-context estimate |
| --------------------- | ----------------------: | ---------------------------: | -----------------------------: | ----------------------------------: |
| Direct visibility     |                       6 |                        9,474 |                          2,394 |                               2,887 |
| Progressive discovery |                       9 |                        5,688 |                          1,461 |                               2,617 |

On this fixture, progressive discovery cuts schema bytes about 40%, estimated tool tokens about 39%, and cumulative request-context tokens about 9.4%, at the cost of three more requests. The context column sums TokenMeter's per-request system, message, and tool estimates, counting shared context again on each request. The one-tool fixture above loses while this broader catalog gains, so results depend on catalog breadth and task mix. These are fixed-density TokenMeter estimates, not provider-exact usage or model-quality results. A separate 603-schema no-match control returns no candidates for an unrelated query. Host integration also confirms a no-match leaves deferred schemas hidden and a following matching query exposes its target. The hand-written discovery queries test the plugin's search ranking on these fixtures, not an LLM's query generation or judgment.

A separate keyless scale test runs the same three tasks against 603 DSH `defineTool` schemas (three task tools, five fixed decoys, 595 generated decoys). All three tasks succeed in both modes. It approximates the magnitude of the earlier ~30.4K tool-schema observation; the catalog itself is synthetic, not a live profile export:

| Mode                  | Visible schemas per request | Requests across 3 tasks | Serialized tool-schema bytes | Cumulative tool-token estimate | Cumulative request-context estimate |
| --------------------- | --------------------------: | ----------------------: | ---------------------------: | -----------------------------: | ----------------------------------: |
| Direct visibility     |                         603 |                       6 |                      755,604 |                        188,928 |                             189,421 |
| Progressive discovery |                   1 → 2 → 2 |                       9 |                        5,688 |                          1,461 |                               2,619 |

Each direct request carried 31,488 estimated tool tokens, near the observed baseline's magnitude. Across the three tasks, progressive discovery reduced the summed request-context estimate by about 98.6% and tool-token estimate by about 99.2%, at the cost of three extra requests. This is only a synthetic scale stress test; it does not establish full-profile savings, retrieval quality, cache impact, or provider economics. Reproduce the local metrics without provider usage:

```sh
DSH_TOOL_SEARCH_MEASURE=1 fnm exec --using=22.23.3 pnpm --dir plugins/@dshfiles/tool-search exec vitest run src/provider-benchmark.test.ts
```

The same file includes an opt-in provider benchmark that runs the three synthetic tasks in both modes through OpenCode Go Alex at high reasoning. It is skipped unless `DSH_TOOL_SEARCH_PROVIDER_BENCHMARK=1`; tools return only fixture data and record note writes in memory. Each scenario caps requests at three direct or four progressive, disables retries, and caps output at 1,024 tokens. It reports schema bytes, local tool-token and context estimates, provider-reported usage, tool selection, and latency without logging prompts, response text, or credentials. It disables the default Harness identity and runtime-context snapshots so only the synthetic system instruction, prompts, and schemas are sent.

Run only when real provider usage is intended. Use `secret run` to inject project aliases; its leak guard scrubs known secret values from child stdout/stderr:

```sh
DSH_TOOL_SEARCH_PROVIDER_BENCHMARK=1 secret run -- fnm exec --using=22.23.3 pnpm --dir plugins/@dshfiles/tool-search exec vitest run src/provider-benchmark.test.ts
```

The authorized follow-up run resolved the alias but OpenCode Go returned `AUTH` on the first direct request, with zero usage and no tool call. The early-stop guard prevented the progressive and remaining tasks. DSH account status reported OpenCode Go Alex signed in and healthy, so that status alone does not validate this API credential. Provider-backed A/B results remain unavailable; do not retry until the credential or route is corrected.

These synthetic tasks do not establish full-profile savings, cache impact, or production-level economics; do not enable progressive disclosure profile-wide from this fixture alone.

## Checks

```sh
pnpm --dir plugins/@dshfiles/tool-search typecheck
pnpm --dir plugins/@dshfiles/tool-search test
pnpm --dir plugins/@dshfiles/tool-search build
```

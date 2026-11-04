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
    reportSchemaMetrics: false
```

`alwaysVisible` accepts trimmed tool names with `*` as the only wildcard. `maxResults` must be an integer from 1 through 100; `maxQueryChars` must be an integer from 1 through 4096. Defaults are `[]`, `5`, and `512`. `reportSchemaMetrics` defaults to `false`; set it to `true` only for an isolated measurement profile.

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

A temporary instrumented build of the isolated full-profile scratch boot (211 active entries; all 56 bundles under test loaded) recorded a final global catalog of 203 tool schemas and 95,177 UTF-8 bytes of serialized schemas. The final report was the last of 204 registry snapshots. This measures schema payload size only—not provider tokenization or task quality. The opt-in `reportSchemaMetrics` config defaults to false and reports aggregate counts and byte totals only; it never logs schema names or contents.

## Provider benchmark (Codex)

The same file includes an opt-in A/B benchmark against a real Codex (ChatGPT subscription) account from `@dshfiles/ai-accounts`. It authenticates in-process through that plugin's `codexCredentialStore`, the same read/refresh path the live Host uses; the token never leaves the process. It is skipped unless `DSH_TOOL_SEARCH_PROVIDER_BENCHMARK=1`. Every tool answers from in-memory fixtures. Retries are off, each scenario is capped at 4 (direct) or 6 (progressive) requests, and a total request budget stops the run. Progressive mode uses the plugin defaults (`maxResults: 5`, nothing always visible).

Catalogs: `real-335` registers the 335 real schemas the owned web-profile bundles serve (`tooling/dshx/e2e/fixtures/tool-schemas.json`), with six tasks phrased by intent so the tool must be found by meaning; `synthetic-603` and `synthetic-8` reuse the fixture above. Success means an accepted tool ran with acceptable arguments and the final answer contains the fixture fact.

```sh
DSH_TOOL_SEARCH_PROVIDER_BENCHMARK=1 DSH_TOOL_SEARCH_BENCHMARK_ACCOUNT=codex-alex2 DSH_TOOL_SEARCH_BENCHMARK_MODEL=gpt-6-luna \
  DSH_TOOL_SEARCH_BENCHMARK_REQUEST_BUDGET=85 DSH_TOOL_SEARCH_BENCHMARK_OUTPUT=/tmp/tool-search-benchmark.json \
  pnpm --dir plugins/@dshfiles/tool-search exec vitest run src/provider-benchmark.test.ts -t 'Codex provider'
```

Results on 2026-11-04, `codex-alex2` / `gpt-6-luna` / high, 85 provider requests (per-scenario mean ± sd; prompt = uncached input + cached input, both provider-reported):

| Catalog       | Mode        | Success | Requests |  Uncached input |    Cached input |   Output |  Model latency |
| ------------- | ----------- | ------: | -------: | --------------: | --------------: | -------: | -------------: |
| real-335      | direct      |   12/12 |    2 ± 1 | 16,529 ± 14,118 | 43,595 ± 24,840 |  80 ± 43 |  7.1 s ± 2.9 s |
| real-335      | progressive |    9/12 |    4 ± 1 |   2,911 ± 1,774 |       331 ± 623 | 212 ± 84 | 14.6 s ± 7.3 s |
| synthetic-603 | direct      |     2/2 |        2 |          16,520 |          16,192 |       34 |          7.5 s |
| synthetic-603 | progressive |     2/2 |        3 |           1,132 |               0 |       71 |          5.6 s |
| synthetic-8   | direct      |     1/1 |        2 |             588 |               0 |       41 |          4.1 s |
| synthetic-8   | progressive |     1/1 |        3 |           1,073 |               0 |       72 |          5.7 s |

On the real catalog, direct visibility sends about 27.7K provider tokens of schemas per request, but Codex serves most of it from the prompt cache (72% cached overall; 5 of 12 first requests were already cached from earlier scenarios). Progressive discovery cuts prompt tokens about 95% (60K → 3.2K per task) and cache-discounted input about 86% (20.9K → 2.9K, counting cached tokens at 10%), but it never benefits from caching, doubles requests and model latency, nearly triples output tokens, and lost 3 of 12 tasks: BM25 search did not map "task tracker" to `backlog_capture` within six searches, and twice did not map "ChatGPT subscription allowance" to `ai_accounts_quota` (once the model answered without a tool, once it used `usage_status`). Direct mode made no wrong tool choice. On the 8-tool catalog progressive discovery costs more tokens and latency.

These runs use one route, short single-turn tasks and a bare system prompt; they do not measure long multi-turn sessions, where direct mode's cached schema prefix amortizes further, or subscription quota accounting of cached tokens.

## Checks

```sh
pnpm --dir plugins/@dshfiles/tool-search typecheck
pnpm --dir plugins/@dshfiles/tool-search test
pnpm --dir plugins/@dshfiles/tool-search build
```

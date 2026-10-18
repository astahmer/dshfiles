# ADE interaction-speed audit

## Scope and guardrails

Measure what users actually see across the ADE; compare architecture options; prototype and benchmark one reversible improvement; deliver a recommendation and phased roadmap. Do not implement a final framework/state migration. Keep DSH Host authoritative, use a uniquely named scratch DSH only, do not touch `127.0.0.1:3080` or `~/.dsh`, and do not push or restart the live app.

## Progress

| Track | Status | Evidence / next action |
|---|---|---|
| Runtime and ownership audit | Complete | Installed DSH `0.2.1-rc.2`; React 18.3.1, TanStack Query 5.104.1, Virtual 3.14.13. Host owns conversation/history; retained switches can reuse open sessions, and reopen/older-page requests cross Host boundary. |
| Plugin hot-path audit | Complete (static) | Sidebar, Activity Timeline, Agent Communication and Jujutsu code-shape findings. Treat every cost as a hypothesis until the affected UI path is measured. |
| Framework/local-first comparison | Complete | Keep React + TanStack Query. Host remains authoritative; no renderer/store replacement has DSH-specific evidence or a supported boundary. |
| Scratch browser and provider setup | Complete | Fixed dshx scratch seeding/parser/ownership. Scratch `ade-speed-20261018g`: doctor and `activity-timeline/verification-receipts` passed; all 5 selected bundles loaded, browser reported zero console/page/request/HTTP errors, and `dev down` stopped Host/browser/provider. |
| Correct-content benchmark at 1/5/20 active turns | Complete (warm path) | 40 conversation switches per load (20 each direction), 10 Activity and 10 AI Accounts panel samples per load; exact content plus two animation frames. See benchmark results. |
| Long-history, streaming and remaining plugin workloads | Pending | Current held fake turns emit no token deltas and transcripts are short. Add a representative long transcript and streaming load; measure Jujutsu and Agent Communication navigation separately. |
| Product-side prototype and comparison | Deferred pending evidence | Warm 1/5/20 paths show no long tasks and mostly sub-120 ms p95. Do not pick a product optimization blindly; use the richer workload to identify a bottleneck, then compare one reversible change if warranted. |
| Prior click-path audit | Complete | Published in `docs/ade-performance/README.md`; its click-based samples do not satisfy the new ArrowDown target. |
| Sub-50 ms ArrowDown navigation | Research complete; prototype/benchmark pending authorization | Source confirms the current lists lack ArrowDown selection. Plugin-side navigation and Session-history lookahead are supported; retaining the native ChatView is not. |

## Current verified baseline

- Benchmark harness: [benchmark.mjs](plans/ade-performance/benchmark.mjs). Structured raw samples: [benchmark-results-20261018.json](plans/ade-performance/benchmark-results-20261018.json). Screenshots: [5 active turns](plans/ade-performance/evidence/benchmark-5-agents-older-session.png), [20 active turns](plans/ade-performance/evidence/benchmark-20-agents.png).
- Runtime: installed DSH `0.2.1-rc.2`; React 18.3.1, TanStack Query 5.104.1, TanStack Virtual 3.14.13; Chromium 141.0.7390.37; viewport 1440×900; Node v22.23.3 on darwin/arm64, Apple M4, 10 logical CPUs. Five scratch bundles loaded: UI styles, shared runtime, Activity Timeline, AI Accounts, Project Checks.
- Two fresh `dshx dev up` runs took 25.8 s and 14.6 s; build/cache conditions differed, and these are single CLI wall-clock samples, not startup p50/p95. Fresh `dshx dev open activity-timeline/verification-receipts` took 18.3 s total, including 13.2 s for `seed tool-call-thread`; Activity/event/open steps took 69/44/35 ms. These are journey timings, not paint measurements.
- First synthetic held-turn content became visible after 126.3 ms. Across 20 agent-creation samples, p50/p95 were 113.2/137.0 ms (max 178.8 ms).

### Correct content, conversation switching

Each destination had 20 samples. p50/p95 below are split by destination rather than pooled across both directions.

| Held turns | Destination | p50 / p95 (ms) |
|---:|---|---:|
| 1 | Completed `Fake thread title` | 81.9 / 98.1 |
| 1 | Active 01 | 81.7 / 98.5 |
| 5 | Active 05 | 97.9 / 99.0 |
| 5 | Active 04 | 97.6 / 99.2 |
| 20 | Active 20 | 81.7 / 98.1 |
| 20 | Active 19 | 82.5 / 98.5 |

### Plugin navigation and browser load

Each panel path had 10 samples per load level. At `n=10`, p95 is the maximum and remains noisy.

| Held turns | Activity open p50/p95 | AI Accounts open p50/p95 | Activity return p50/p95 |
|---:|---:|---:|---:|
| 1 | 65.3 / 66.2 ms | 98.5 / 101.7 ms | 64.7 / 65.2 ms |
| 5 | 64.8 / 65.8 ms | 97.6 / 98.3 ms | 64.2 / 64.5 ms |
| 20 | 78.2 / 112.4 ms | 97.8 / 193.8 ms | 64.8 / 131.9 ms |

- Visible DOM nodes at 1/5/20 held turns: 608/716/1,099; after revealing the older completed session at 20, 1,122 nodes. Chromium reported ~76.6 MB used JS heap at every snapshot. No forced GC; identical heap samples are too coarse to conclude memory stays flat.
- No long tasks appeared in measured interactions. Ordinary conversation/panel frame-gap maxima were 16.8 ms; the one older-session transcript path had a 33.3 ms gap. Twenty distinct held turns produced 20 visible `Running` rows and 20 provider hold requests.
- At 20 turns, one `Show more sessions` click revealed the older completed row in 108.2 ms; opening its correct transcript took another 135.2 ms; total path to correct content was 246.2 ms.

## Measurement rules and caveats

- Samples require exact unique transcript text plus the ongoing-status indicator, or exact Activity/AI Accounts content, then two `requestAnimationFrame` callbacks. `contentVisibleMs` is a content-visible-after-two-frames proxy—not compositor paint, viewport-intersection, or occlusion proof. The 20-turn screenshot provides a visual spot-check; no title-only, skeleton, stale-content, or synthetic score counts.
- Warm navigation p50/p95 is separate from scratch `up`/`open` journeys. No independent cold-Host-history versus retained-session distribution has been measured yet.
- Frame gaps and long tasks come from page-local `PerformanceObserver`/rAF instrumentation. Negative rAF deltas are discarded because a frame may have started before measurement. Heap uses Chromium `performance.memory` without forced GC.
- The 1/5/20 workload uses local fake-provider turns held at the pending state. It creates real DSH sessions and visible status, but emits no ongoing model-token deltas. Transcripts are short; this does not test 500-message history, 20 simultaneous streams, cross-host work, or provider latency.
- Live panel timing covers Activity Timeline and AI Accounts only. Jujutsu and Agent Communication have static code-path audits, not real-browser timings. Event-count and Host/RPC-versus-render breakdowns were not captured.
- All timings are bounded single-run evidence on one scratch profile and host, not universal SLOs. At 20, AI Accounts p95 and Activity-return p95 deserve follow-up, but 10 samples and no causal trace do not identify a bottleneck. Static history/reopen claims are separately labeled in the audit.
- Scratch verification passed (`doctor`, feature reach, 5 bundles; zero browser console/page/request/HTTP errors) and all scratch Host/browser/fake-provider processes were stopped. No live `127.0.0.1:3080`, `~/.dsh`, or DSH core was touched.

## Architecture decision

Keep React 18 + TanStack Query as baseline. DSH owns Host services, RPC, plugin slots and lifecycle; Host remains canonical for sessions/history. Query is already the plugin UI's async-data cache, with Host-fed updates and optimistic mutation/rollback support; Virtual is already present for selected lists. A second authoritative store or renderer would add coordination and compatibility costs without DSH-specific evidence. See [Query setup](plugins/@dshfiles/plugin-ui/src/query.tsx#L8-L27), [state ownership](plugins/@dshfiles/plugin-ui/docs/state-ownership.md#L3-L11), and the [DSH extension boundary](tooling/dshx/docs/sdk/getting-started.md#L3-L35).

| Candidate | Fit for this ADE | Recommendation |
|---|---|---|
| TanStack Query + React | Already integrated; Host stays source of truth; cache/prefetch and rollback are available. | Keep. If profiling isolates a query wait, test existing-query prefetch first ([Query optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)). |
| TanStack DB | Official README marks it beta and advertises sub-millisecond live queries; that is a vendor claim, not a DSH result. No DSH adapter or measured cross-view join bottleneck found. | Defer; consider only as a bounded read-only projection after evidence ([README](https://raw.githubusercontent.com/TanStack/db/main/README.md)). |
| LiveStore | Docs say its local event log is source of truth and identify remote-server-primary systems as a non-fit. That conflicts with Host authority. | Reject for current ownership model ([fit guidance](https://docs.livestore.dev/overview/when-livestore/)). |
| TinyBase | Can be an in-memory read model, but npm `10.0.1` declares optional React peer `^19.3.0`, outside this DSH React 18 range; another projection adds invalidation/normalization work. | Defer; no persistence/CRDT authority ([package metadata](https://registry.npmjs.org/tinybase/latest)). |
| Preact/compat or Solid | Different rendering runtimes; DSH plugin slots rely on React context/hooks and do not expose a supported renderer replacement. Framework switch means rewrite, not local tuning. | Reject as performance-first migration ([Preact differences](https://preactjs.com/guide/v11/differences-to-react/), [Solid overview](https://docs.solidjs.com/)). |

Installed DSH `0.2.1-rc.2` history code opens a Host follow with an opening snapshot; retained open-session switches can reuse it, while a released session and every `loadOlder` page cross the Host boundary. ChatView maps loaded conversation entries into seats; no transcript-row virtualization was found in the installed bundle. These are runtime/source facts, not measured causes. The upstream tagged sources are [Session](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/api/session-controller/src/client/sessions/session.ts), [transport](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/api/session-controller/src/client/transport.ts), and [ChatView](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/ui-chat/src/client/chat/ChatView.tsx). Cold session-log full-read/copy cost remains a profiling hypothesis; no core patch is allowed. If that boundary proves insufficient, record concrete gap in `plans/dsh-host-gaps.md` and stop there.

## Static plugin hot-path hypotheses

These are source-shape findings only; none has measured as the cause of a user-visible delay.

- [Activity Timeline ingestion](plugins/@dshfiles/activity-timeline/src/service.ts#L91-L139) serializes reads, dedupe/sort, and state writes per `ingest`; a batch method exists. Event adapters currently ingest individually. Profile a burst/backfill before wiring a batch change.
- [Jujutsu graph search](plugins/@dshfiles/jujutsu/src/client.tsx#L379-L432) rebuilds filtered/layout input as text changes; [graph layout](plugins/@dshfiles/jujutsu/src/graph.ts#L262-L446) does branch/lane work over loaded revisions. Virtualization bounds mounted rows, not necessarily graph computation. Measure large/branchy graphs and search.
- [Jujutsu workspace enumeration](plugins/@dshfiles/jj-integration/src/host.ts#L198-L266) walks projects/workspaces and performs multiple `jj` reads; finished-thread sweep and progress polling are additional possible costs. Profile many workspaces before changing concurrency.
- [Agent Communication browse](tooling/dshx/packages/dshx/src/communication/service.ts#L260-L301) filters retained messages; tracked Host calls await durable activity recording before return ([host path](plugins/@dshfiles/agent-communication/src/host.ts#L466-L507)). Retention is bounded, but large histories/tool bursts still need real measurements.

## Prototype gate and next steps

The no-prototype conclusion above applies only to the earlier click-based warm benchmark; it does not establish the new ArrowDown target. The target is ≤50 ms from each accepted keydown to the first compositor-presented correct main view during held repeat. Current stock WorkspaceBrowser and owned ThreadSidebar source lack ArrowDown selection, so first step is an owned ThreadSidebar key path, not a core patch. Use `ctx.sessions.retain` for bounded history lookahead: it warms Session data, not ChatView. The native view remounts per Session generation, so measure whether retained data alone clears the budget; if not, request a public retained-view or main-transcript virtualization seam. Keep Host history authoritative; no second store or framework migration.

## Resume here

Research complete; no product code changed. The ~145 ms full-profile click-to-visible numbers are a warning signal, not ArrowDown latency. Live web uses DSH `0.2.1-rc.2` with ThreadSidebar active; status does not list its bundle as stale. I used status only and did not interact with or reload the live instance. Scratch ThreadSidebar `doctor` and `open` passed; `shot` failed twice with CDP `ECONNREFUSED` after `open`, and the scratch was cleaned. No live data or runtime was changed.

If implementation is approved, prototype visible-row ArrowDown/ArrowUp handling plus a bounded one- or two-row Session-history lookahead, then measure browser keydown to exact target ID and unique transcript sentinel on a presented frame. Validate synthetic cadence and headed physical repeat separately; split warm, query-cold and Host-cold conditions, 20/100 rows and short/100/500-turn histories. Report p50/p95/p99/max, misses, skipped/superseded selections and stale exposure. If retained history still misses 50 ms because native ChatView remounts, use the renderer/cache gap recorded in `plans/dsh-host-gaps.md`. Keep React + TanStack Query; do not patch DSH core or commit to a final migration.
# ADE interaction performance

## Recommendation

Keep React 18 and TanStack Query, with DSH Host as the authority for sessions and conversation history. The evidence does not justify a framework or state-store migration. Full-profile 1/5/20 conversation switching stayed near 145 ms p50, but a 100-turn transcript run reached 1,547.5 ms p95 with many observed long tasks. That is a signal for deeper profiling, not proof that transcript rendering is the cause.

The native user/assistant transcript is rendered by DSH ChatView. DSHX's experimental `conversation.chat.node` API adds event-derived plugin nodes; it does not replace the native message list or its viewport. Do not patch DSH core or work around this boundary with a second client store. If profiling confirms the native list is the bottleneck, request a supported upstream renderer/virtualization seam, then compare an opt-in, reversible React/TanStack Virtual prototype while keeping Host history authoritative.

## Runtime and evidence

The measured full-profile run used DSH `0.2.1-rc.2`, React `18.3.1`, TanStack Query `5.104.1`, TanStack Virtual `3.14.13`, Node `22.23.3`, Chromium `141.0.7390.37`, a 1440×900 viewport, and an Apple M4 with 10 logical CPUs. Its scratch profile loaded 43 bundles and 202 active entries; `doctor` passed. The browser capture reported zero console, page, request, or HTTP errors and six warnings. A later refresh attempt after a 44th owned bundle appeared was not used: `doctor` found `@dshfiles/background-jobs/dist/index.js` missing, and that scratch was stopped without measurements.

The full-profile JSON files preserve the aggregates recorded from the successful run; they do not contain per-sample arrays. Earlier five-bundle and standalone prototype artifacts retain structured samples. The 100-turn screenshot is kept beside the results.

- [Full-profile interaction aggregates](evidence/full-profile-results-20261018.json)
- [Long-history aggregates](evidence/long-history-results-20261018y.json), [screenshot](evidence/long-history-100-full-profile.png), and [capture summary](evidence/scratch-shot-summary-20261018y.json)
- [Streaming aggregates](evidence/streaming-results-20261018y.json)
- [Jujutsu and Agent Communication aggregates](evidence/jujutsu-communication-results-20261018z.json)
- [Earlier five-bundle raw results](evidence/benchmark-results-20261018m.json) and [prototype raw results](evidence/transcript-prototype-results.json)
- [Concurrency/panel harness](benchmark.mjs), [long-history harness](long-history-benchmark.mjs), [streaming harness](streaming-benchmark.mjs), and [standalone prototype](transcript-prototype.html) with its [benchmark](transcript-prototype-benchmark.mjs)

## Reproduce

Run from the repository root with a unique scratch name. Keep it alive through the measurements and stop it with `dev down` afterward. Do not use the live DSH port or live home.

```sh
TMPDIR=/tmp fnm exec --using=22.23.3 node tooling/dshx/packages/dshx/dist/cli/bin.js dev up --name ade-perf-rerun --json
TMPDIR=/tmp fnm exec --using=22.23.3 node tooling/dshx/packages/dshx/dist/cli/bin.js dev doctor --name ade-perf-rerun
fnm exec --using=22.23.3 node docs/ade-performance/benchmark.mjs /tmp/dshx-dev/ade-perf-rerun/state.json 20 /tmp/ade-perf-switches.json
fnm exec --using=22.23.3 node docs/ade-performance/streaming-benchmark.mjs /tmp/dshx-dev/ade-perf-rerun/state.json 10 /tmp/ade-perf-streaming.json
fnm exec --using=22.23.3 node docs/ade-performance/long-history-benchmark.mjs /tmp/dshx-dev/ade-perf-rerun/state.json 100 /tmp/ade-perf-history.json
fnm exec --using=22.23.3 node docs/ade-performance/transcript-prototype-benchmark.mjs 10 /tmp/ade-perf-prototype.json
TMPDIR=/tmp fnm exec --using=22.23.3 node tooling/dshx/packages/dshx/dist/cli/bin.js dev down --dry-run --name ade-perf-rerun
TMPDIR=/tmp fnm exec --using=22.23.3 node tooling/dshx/packages/dshx/dist/cli/bin.js dev down --name ade-perf-rerun
```

Only trust a run after `doctor` passes and exact feature paths reach their targets. If a bundle is missing `dist`, build it before measuring.

## Full-profile results

`contentVisibleMs` records exact target content after two `requestAnimationFrame` callbacks. It is a content-visible proxy, not compositor paint, viewport intersection, or occlusion proof. Conversation switches used 40 samples per load (20 in each direction); panel paths used 10 samples each. With `n=10`, p95 is the maximum and remains noisy.

| Visible working rows | Session rows | DOM nodes | Conversation switch p50/p95 | Activity open p50/p95 | AI Accounts open p50/p95 | Activity return p50/p95 |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 2 | 754 | 144.6 / 164.5 ms | 82.0 / 82.5 ms | 98.1 / 129.4 ms | 65.8 / 81.8 ms |
| 5 | 6 | 906 | 143.7 / 213.0 ms | 81.1 / 164.9 ms | 102.7 / 115.8 ms | 64.6 / 82.4 ms |
| 20 | 21 | 1,476 | 145.8 / 163.0 ms | 98.0 / 108.3 ms | 97.3 / 130.5 ms | 97.7 / 102.5 ms |

Switch latency did not trend upward from one to 20 visible working rows. Conversation switching recorded no long tasks at one row, two at five rows (maximum 66 ms), and one at 20 rows (maximum 52 ms); panel navigation had none. Chromium reported about 157 MB heap at each snapshot; these coarse `performance.memory` values, without forced GC, do not prove memory is flat.

Twenty agent-creation samples measured 491.3 ms p50, 2,323.1 ms p95, and 3,347.7 ms maximum. This end-to-end path includes session creation, Host/provider activity, and rendering; it does not isolate UI time. The fake-provider hold log was empty and `holdRequestAttempts` was 0. Visible `Working` rows prove list state, not provider-side request count; the earlier claim of 20 held provider requests is withdrawn.

### Long history and streaming

The 100-turn run verified every exact answer. Overall content-visible latency was 889.7 ms p50, 1,547.5 ms p95, and 2,127.3 ms maximum. Turns 1–20 measured 498.1/1,019.1 ms p50/p95 with no observed long tasks. Turns 81–100 measured 1,315.5/2,066.8 ms, with 180 observed long tasks (maximum 138 ms) and a maximum frame gap of 333.3 ms. DOM nodes grew from 1,458 to 7,586; transcript flow items grew from 0 to 400. The correlation warrants investigation, but end-to-end timing does not establish a rendering-only cause.

The controlled streaming run used 10 samples of a 24-word response, with a 40 ms delay between words. First content became visible at 297.4/404.6 ms p50/p95; the complete answer at 1,196.1/1,289.1 ms. Every sample was progressive and correct, with 20 working rows present before and after. The maximum frame gap was 83.3 ms and no long tasks were observed. These timings include the controlled stream and browser/Host path.

### Jujutsu and Agent Communication

Warm navigation used 10 samples per panel. The Agent Communication `Message a thread…` combobox measured 80.3/112.7 ms p50/p95; a visible Jujutsu graph row measured 97.2/125.2 ms. Both paths had zero observed long tasks and a maximum sampled frame gap of 16.8 ms. The Jujutsu sample used a small repository and the communication panel had no large history, so these results do not cover large graphs or message volumes.

## Comparable transcript prototype

A standalone fixed-height 1,000-row prototype compared eager DOM, CSS containment, and windowing. Each mode used 10 samples at 1440×900 and rendered the correct content. This is ordinary JavaScript/DOM, not React, TanStack Virtual, or the production DSH transcript.

| Mode | Initial content p50/p95 | Scroll-to-newest p50/p95 | Mounted rows / card DOM nodes |
|---|---:|---:|---:|
| Eager | 28.6 / 35.6 ms | 28.3 / 42.3 ms | 1,000 / 4,007 |
| Contained | 21.5 / 30.1 ms | 34.4 / 35.4 ms | 1,000 / 4,007 |
| Windowed | 18.6 / 26.2 ms | 49.2 / 50.0 ms | 15 / 70 |

All modes had a 16.8 ms maximum frame gap and no observed long tasks. Windowing reduced mounted rows by 98.5% and card DOM nodes by 98.3%; initial p95 improved, while scroll-to-newest p95 was slower than eager. Fixed-height simple cards and lack of React/streaming make this a mechanism comparison, not a production performance claim.

## Architecture fit

React and TanStack Query already fit the DSH boundary: Host owns sessions and history; Query is the plugin UI's async-data cache, with Host-fed updates and optimistic mutation/rollback. TanStack Virtual is available for list use. A second authoritative store or renderer replacement adds coordination and compatibility costs without evidence that it fixes the measured path. See [plugin Query setup](../../plugins/@dshfiles/plugin-ui/src/query.tsx), [state ownership](../../plugins/@dshfiles/plugin-ui/docs/state-ownership.md), and the [DSH extension boundary](../../tooling/dshx/docs/sdk/getting-started.md).

| Candidate | Fit | Recommendation |
|---|---|---|
| React + TanStack Query | Already integrated; Host remains authoritative; cache, prefetch, and rollback are available. | Keep. If profiling isolates a query wait, test prefetch of the existing query/key before adding state. |
| TanStack DB | README labels it beta and advertises sub-millisecond live queries; those are vendor claims, not DSH measurements. No adapter or measured cross-view join bottleneck was found. | Defer; consider only as a bounded read-only projection after evidence ([README](https://raw.githubusercontent.com/TanStack/db/main/README.md)). |
| LiveStore | Local event log is the source of truth; fit guidance identifies remote-server-primary systems as a non-fit. | Reject for current Host-authoritative ownership ([fit guidance](https://docs.livestore.dev/overview/when-livestore/)). |
| TinyBase | npm `10.0.1` declares an optional React peer `^19.3.0`, outside DSH's React 18 range; another projection adds invalidation and normalization work. | Defer; do not add persistence or CRDT authority ([package metadata](https://registry.npmjs.org/tinybase/latest)). |
| Preact/compat or Solid | DSH plugin slots rely on React context/hooks and expose no supported renderer replacement. | Reject as a performance-first migration ([Preact differences](https://preactjs.com/guide/v11/differences-to-react/), [Solid overview](https://docs.solidjs.com/)). |

## Static hot-path hypotheses

These source-shape observations are not verified causes of user-visible delay:

- Activity Timeline ingestion serializes reads, dedupe/sort, and writes per `ingest`; a batch method exists. Profile bursts/backfills before changing it (`plugins/@dshfiles/activity-timeline/src/service.ts`).
- Jujutsu graph search rebuilds filtered/layout input as text changes, and graph layout performs branch/lane work. Virtualization bounds mounted rows, not graph computation (`plugins/@dshfiles/jujutsu/src/client.tsx`, `src/graph.ts`).
- Jujutsu workspace enumeration walks projects/workspaces and performs multiple `jj` reads; profile many workspaces before changing concurrency (`plugins/@dshfiles/jj-integration/src/host.ts`).
- Agent Communication browse filters retained messages; tracked Host calls await durable activity recording. Large histories and tool bursts still need measurement (`tooling/dshx/packages/dshx/src/communication/service.ts`, `plugins/@dshfiles/agent-communication/src/host.ts`).

## Reversible roadmap

1. Keep React + TanStack Query and Host ownership. Do not add a second store or perform a framework migration based on synthetic timings.
2. Instrument Host/request latency, query/cache work, React commit/content visibility, and actual paint separately. Repeat cold and warm runs with variable-height Markdown, tool cards, attachments, older-page loading, and simultaneous streams at 1/5/20 sessions; include 100- and 500-turn histories. Record provider attempts through a verified signal rather than the empty hold log.
3. If the native transcript remains the bottleneck, request a supported upstream message-list/viewport seam. Do not work around its absence with a parallel store or dshfiles-only replacement.
4. Only after that seam exists, compare native and windowed React/TanStack Virtual implementations behind a disabled-by-default flag. Keep Host history authoritative and preserve ordering, streaming, older-page insertion, `scrollToTurn`, auto-follow, keyboard/screen-reader semantics, and rich cards.
5. Set latency and accessibility budgets before the experiment. Roll back by disabling the flag if correctness, scroll anchoring, accessibility, memory, or 1/5/20 navigation regresses; promote only after repeatable improvement on the same full-profile workload.

No production migration or DSH core patch was made in this audit.

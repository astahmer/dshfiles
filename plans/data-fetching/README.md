# Data fetching: one batched transport and a page-wide resource store

Resume here: P1 (find what holds the browser's HTTP/1.1 sockets on the live page), then the P2 batch-transport spike.
P0 quick fixes 1–2 are on revisions above `main` in the `data-fetch` JJ workspace; 3–10 are open.

## Why

A fresh page load of the live GUI (`~/Downloads/06-10-2027-fresh.har`, 2026-11-06, Fetch/XHR only, 143 s) was parsed by
a read-only script (no headers, cookies or bodies printed). dshx channels were mapped to plugins by hashing every
`@dshfiles/*` package × API id with dshx's `ApiChannelModel.apiChannel`; all 16 channels in the HAR resolved.

| Measure                                        | Value                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Requests                                       | 158 in 143 s (148 POST RPC, 10 GET), 7.8 MB of responses          |
| Request time p50 / p95 / max                   | 4.3 s / 113 s / 118 s                                             |
| **First request to leave the browser queue**   | **115.6 s after the first request was issued**                    |
| Share of request time spent queued (`blocked`) | **99 %** — `blocked` p50 2.2 s, p95 113 s                         |
| Server time (`wait`) p50 / p95 / max           | 5 ms / 1.4 s / 6.1 s                                              |
| Requests aborted before being sent             | 26 (`ERR_ABORTED`, `wait` 0): client timeouts fired in the queue  |
| Identical method + body fired more than once   | 84 extra calls; 26 of them within the same second                 |
| 404s                                           | 9 (`changes.summary` ×8, `present.open` ×1)                       |
| Protocol                                       | HTTP/1.1 only, so six sockets per origin for every tab and worker |

The Host was not the bottleneck: once a request left the browser it was answered in 5 ms at the median. Every page-load
read sat behind sockets held by something else for almost two minutes. Each RPC is its own HTTP POST
(`client-request` envelope, `dsh-client-connection` `createWebConnectionRpc`), so the page needs a free socket per
read, and every open DSH tab, the `shared-streams` SharedWorker's EventSources and any slow call (SSH-backed
`preview/devServers`, `multi-host/runtimeStatus`) draw from the same six. Client timeouts (15 s `runHostRequest`, 30 s,
40 s, 60 s) then abort queued reads and their retries rejoin the back of the queue.

Top methods (count · distinct bodies · response size · owner):

| Method                                               | Calls | Distinct | Notes                                                          | Owner                         |
| ---------------------------------------------------- | ----- | -------- | -------------------------------------------------------------- | ----------------------------- |
| `session/modelCatalog`                               | 16    | 1        | 4 in the same ms, five bursts                                  | `model-selection` fork (P0-2) |
| `annotations/list`                                   | 15    | 4        | 11 aborted at 15 s in the queue, then retried                  | annotations                   |
| `credentials/describe`                               | 13    | 3        | 3 in the same ms, four bursts                                  | to attribute (P0-5)           |
| `changes.summary` (GET)                              | 9     | 9        | 8 × 404, 5 in the same 10 ms                                   | diff-viewed, pulls-review     |
| `llm/listProviders`, `llm/listConfigurableProviders` | 8 + 8 | 1 + 1    | pairs in the same ms with each modelCatalog burst; 92 KB per 8 | to attribute (P0-5)           |
| `preview/devServers`                                 | 8     | 4        | 3 at t = 0                                                     | preview                       |
| `jj-threads/threadAt`                                | 8     | 4        | 5 aborted at 15–30 s                                           | jj-integration                |
| `traces-alerts/feed`                                 | 6     | 1        | 30 s poll, 4 aborted at 15 s                                   | traces                        |
| `backlog/aiActivity`                                 | 6     | 1        | 1 s poll (queue stretched it to 4 s)                           | backlog (P0-1)                |
| `session/page`                                       | 4     | 4        | 3.8 MB total, 1.6 MB max                                       | core / session-controller     |
| `thread-sidebar-attention/state`                     | 4     | 1        | 514 KB total, 128 KB each                                      | thread-sidebar                |
| `backlog/list`                                       | 4     | 4        | 816 KB total, 744 KB max                                       | backlog                       |
| `settings/describe`, `settings/mutate`               | 3 + 2 | 1 + 2    | 406 KB per describe, 302 KB per mutate                         | core settings                 |
| `jj-threads/repositories`                            | 2     | 1        | 558 KB                                                         | jj-integration                |

An earlier capture (2026-10, 63 s) had 181 requests, p50 36 ms and p95 2.46 s, so queueing is intermittent: it depends on
how many tabs are open and which slow calls hold sockets. This load is the worst case, not a typical one.

### Root causes in the current client stack

1. **One HTTP request per read on a six-socket pool.** dshx `createApiClient` calls `connection.rpc.call`, one POST each
   (`tooling/dshx/packages/dshx/src/api/runtime.ts`). Nothing batches reads issued in the same tick, so a page load
   needs ~16 sockets in its first 8 s and a slow read holds a socket for its whole duration.
2. **Cadence is owned by each observer, per bundle.** `@dshfiles/plugin-ui/query` gives every plugin bundle its own
   `QueryClient` (`plugins/@dshfiles/plugin-ui/src/query.tsx`); polls are `refetchInterval` on each `useQuery`, so two
   plugins reading one Host fact poll twice, and a mounted-but-hidden surface keeps polling (backlog, before P0-1).
3. **Native `ctx.remote` reads bypass dshx coalescing.** The page-wide in-flight join and the 30 s completed-read cache
   (`runtime.ts` `coalesce`, `api/query-cache.ts`) only cover dshx contracts used through `useApiQuery`; core reads such
   as `session/modelCatalog` and `credentials/describe` from several owners fire separately.
4. **Events refresh coarsely.** `useApiEvent` exists, but most surfaces still poll; where events are used they trigger
   a full re-read per event (model-selection refreshed once per event, four events per write).
5. **Timeouts measure the queue, not the Host.** A 15 s client timeout that fires while the request has not left the
   browser cancels work that never started, and the retry goes to the back of the queue.
6. **Payloads are whole snapshots.** `settings/describe` 406 KB, `thread-sidebar-attention/state` 128 KB per call,
   `backlog/list` 744 KB, `session/page` 1.6 MB: a changed field re-sends everything.

TanStack Query is not itself the defect; it has no notion of the transport, and its per-bundle client and per-observer
cadence spread ownership. It is also React-only, which matters for a Foldkit move.

## Options considered

| Option                                                                                             | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tune TanStack defaults further                                                                     | Keep doing for P0, but it cannot fix the socket pool or cross-bundle duplication.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Effect RPC (`effect/rpc`, 4.1)                                                                     | `RpcClient.makeProtocolHttp({ batch: { window, maxSize } })` batches calls in a window; `makeProtocolSocket` multiplexes over a WebSocket; streams are first-class (`~/.references/effect-4.1.0/packages/effect/src/rpc/RpcClient.ts`). Good model for our batch window and streamed results; adopting the wire format would replace the dshx contract layer and the core Connection envelope, so borrow the design, not the protocol.                                                                                                                                                                                                                                                      |
| GraphQL / Fate / a sync engine                                                                     | Still deferred: the Host owns the data and already pushes events; the gap is transport and cache ownership, not a query language.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [Foldkit](https://foldkit.dev/core/architecture) + [foldkit-plus](https://foldkit-plus.pages.dev/) | Elm architecture on Effect 4: one Schema-typed Model, Messages, a pure `update` returning Commands (Effects); Subscriptions and [Managed Resources](https://foldkit.dev/core/managed-resources) are derived from the Model with dependency diffing. [foldkit-remote](https://foldkit-plus.pages.dev/remote) keeps server data in the Model as normalized entities with live data and pluggable transports; [foldkit-react](https://foldkit-plus.pages.dev/react) embeds either side in the other at one DOM element. So the data layer we build must be a plain subscribable store whose "which keys are needed" input can come from a Foldkit Subscription as easily as from a React hook. |
| **Batched dshx transport + page-wide keyed resource store** (chosen)                               | Fixes the socket pool and the duplicate cadences at dshx, no core patch, adoptable one plugin at a time, framework-agnostic core.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Design

Two layers in `@dshfiles/dshx`, both page-wide (one instance on `globalThis` under a versioned `Symbol.for`, like the
in-flight map and the events hub, because every bundle inlines its own dshx copy):

1. **Batched transport.** Read calls issued within one window (start with 8 ms, `maxSize` 32) are sent as one POST to
   a dshx-owned route (`/api/dshx-batch`) served by the leading dshx Host bundle, which dispatches each entry through the
   shared `apiRegistry` exactly as the per-channel route does (same validation, same `api-dispatch` span per entry). The
   response streams one NDJSON line per entry as it settles, so a slow `devServers` never delays a fast `revision`.
   Per-call abort removes the entry; the in-flight join stays in front of the batcher. When the route is absent (an
   old Host), calls fall back to today's per-channel POST. Writes stay unbatched at first. A spike checks whether dshx
   can carry the events stream and the batch over the `/api/remote.mux` WebSocket (exempt from the six-socket budget);
   if no plugin-owned route can, record it in [Host gaps](../dsh-host-gaps.md) with these numbers.
2. **Resource store.** `ResourceStore` keyed by `owner/api/method + stableJson(input)` holds
   `{ status, data, error, updatedAt }` and exposes only `subscribe(key, listener)`, `getSnapshot(key)`,
   `ensure(key)`, `invalidate(tag)` and `mutate(...)`. Subscriptions are ref-counted requirements: the first
   subscriber fetches when stale, the last one leaving stops its poll. Freshness, polling and visibility live on the
   resource definition (one timer per key, paused while no subscriber is visible or the document is hidden), not on
   each caller. API contracts gain optional `tags` on reads and `invalidates` on events; a Host event names tags, and
   the store refetches only subscribed keys with those tags. Later, hot keys can switch to Host-pushed snapshots and
   patches over the same events stream, which removes their poll.
3. **Adapters.** React: `useResource(contract, method, input)` over `useSyncExternalStore`. TanStack bridge:
   `resourceQueryOptions(...)` whose `queryFn` reads through the store, so existing `useQuery` sites migrate without a
   rewrite. Foldkit (later): a Subscription that maps a Model slice to the set of keys and turns store updates into
   Messages, and Commands for `ensure`/`mutate`; evaluate foldkit-remote's transport contract before writing our own.
   Native `ctx.remote` reads used by several owners (`session/modelCatalog`, `credentials/describe`) get a store
   resource too, so they coalesce like dshx reads.

The store never mixes owners: keys carry the owner and the Connection identity, and a Host generation reset clears it.

## Phases

| Phase | Work                                                                                                                                                                                                                                                                                                                   | Owner                              | Status                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------- |
| P0    | Quick fixes from the HAR (list below)                                                                                                                                                                                                                                                                                  | each plugin                        | 2 of 10 done (not deployed) |
| P1    | Name what holds the sockets: per tab, list EventSources, WebSockets and long requests (resource timing + `chrome://net-export` on the live page, tabs counted); promote the HAR analyzer to `.agents/skills/live-performance-audit/scripts/har-summary.mjs` with the channel → plugin map computed from the repository | live-performance-audit             | Not started                 |
| P2    | Batched transport: Host route on the dshx leader, client batcher with NDJSON streaming, per-entry abort, old-Host fallback, spans; WebSocket-mux feasibility spike                                                                                                                                                     | dshx                               | Not started                 |
| P3    | `ResourceStore` core + React adapter + TanStack bridge; pilot on backlog `revision`/`aiActivity`, `annotations/list`, `traces-alerts/feed`                                                                                                                                                                             | dshx, plugin-ui, pilots            | Not started                 |
| P4    | Event tags and `invalidates` on contracts; drop the pilots' polls where the Host publishes the change                                                                                                                                                                                                                  | dshx, pilots                       | Not started                 |
| P5    | Store resources for shared native reads (`session/modelCatalog`, `credentials/describe`, `llm/listProviders`)                                                                                                                                                                                                          | dshx, model-selection, ai-accounts | Not started                 |
| P6    | Host-pushed snapshots/patches for the heaviest hot keys (`thread-sidebar-attention/state`, `jj-threads/threadAt`), only if P4 numbers still show them                                                                                                                                                                  | thread-sidebar, jj-integration     | Not started                 |
| P7    | Foldkit adapter spike (Subscription/Command) and a foldkit-remote transport comparison                                                                                                                                                                                                                                 | dshx                               | Not started                 |
| P8    | Migrate remaining Host reads; keep TanStack only where a plugin needs its mutation/form helpers                                                                                                                                                                                                                        | all plugins                        | Not started                 |

### P0 quick fixes

| #   | Offender (HAR)                                                        | Fix                                                                                                                        | Files                                                                                                                                     | Status                      |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | backlog `aiActivity` 1 s + `revision` 5 s while the panel is hidden   | poll only while visible; read both once on reveal                                                                          | `plugins/@dshfiles/backlog/src/backlog-panel.tsx`, `panel-poll.ts`                                                                        | Done, revision above `main` |
| 2   | `session/modelCatalog` ×4 in the same ms (16 calls, 1 body)           | one refresh per 50 ms burst of Host change events                                                                          | `plugins/@dshfiles/model-selection/src/native/catalog.ts`, `service.ts`                                                                   | Done, revision above `main` |
| 3   | 26 reads aborted in the browser queue, then retried                   | time out on server time, not queue time (start the timer when the request is sent, or drop `retry` after a client timeout) | `plugins/@dshfiles/plugin-ui/src/lib/host-request.ts`, `annotations/src/ui/annotations-action.tsx`, `traces/src/alerts/alerts-queries.ts` | Open                        |
| 4   | `changes.summary` 404 ×8, 5 in the same 10 ms                         | treat 404 as "no summary" without retry; share one query key between both callers                                          | `plugins/@dshfiles/diff-viewed/src/viewed-toggle.tsx`, `plugins/@dshfiles/pulls-review/src/changes-facet.tsx`                             | Open                        |
| 5   | `credentials/describe` ×3 and `llm/list*Providers` ×2 in the same ms  | attribute the callers with a browser trace, then coalesce like P0-2                                                        | to attribute                                                                                                                              | Open                        |
| 6   | `preview/devServers` ×3 at t = 0, one held a socket 2.3 s server-side | one page-wide read per session; poll only while the chip is visible                                                        | `plugins/@dshfiles/preview/src/dev-servers-chip.tsx`                                                                                      | Open                        |
| 7   | `jujutsu-composer/context` ×4 distinct at 7.6 s                       | check why four composers mount on load; read only for the visible one                                                      | `plugins/@dshfiles/jujutsu`                                                                                                               | Open                        |
| 8   | `thread-sidebar-attention/state` 128 KB per read                      | trim the snapshot to what the badges render                                                                                | `plugins/@dshfiles/thread-sidebar/src/attention-api.ts`                                                                                   | Open                        |
| 9   | `backlog/list` 744 KB                                                 | page the list; send bodies with `get`                                                                                      | `plugins/@dshfiles/backlog`                                                                                                               | Open                        |
| 10  | `settings/describe` 406 KB ×3 in 6 s, `settings/mutate` 302 KB        | core payloads: find the owned callers that re-describe after each mutate; Host gap if the size itself is core              | to attribute                                                                                                                              | Open                        |

## Risks

- **A batch couples failures.** One malformed entry or a Host crash fails the whole POST; entries must settle
  independently and the client must fall back per entry, not per batch.
- **Streaming through the Connection route.** The batch route must stream a body through `connection.fetch.register`;
  verify it is not buffered by the Gateway before relying on it (the SSE events route proves streaming works).
- **Leader handover.** The batch route lives on whichever dshx bundle leads, like the events route; an unloaded leader
  must hand over without losing in-flight entries (the client retries the unsettled ones once).
- **Cache mixing.** A page-wide store must key by owner and Connection identity and clear on Host generation reset, or
  one plugin could read another's stale data — the reason `plugin-ui` kept per-bundle clients.
- **Old Host / new client.** Every new route and event is optional at the boundary; absent means today's behavior.
- **Foldkit timing.** Do not shape the store around React; keep the core free of React and of Effect runtime
  requirements so the Foldkit adapter is a thin layer.

## Verification

Same inputs before and after each phase:

- `node har-summary.mjs <fresh-load.har>` (P1) on a fresh load with the same number of DSH tabs open: requests, time to
  first request sent, `blocked` p50/p95, server `wait` p50/p95, duplicates, aborted-in-queue count, bytes.
- `live-performance-audit` probes on the live page: `switch-probe.mjs` with `REQUESTS=1` (requests per thread switch),
  `host-lag.mjs` (Host not stalled), and one three-tab load.
- Targets: page-load reads leave the browser within 250 ms at p95 with three tabs open; requests per thread switch
  halved against the last recorded switch probe; no identical read twice within a second; polls only from visible
  surfaces. Record the tables in [docs/performance.md](../../docs/performance.md).

P0-1 and P0-2 are verified only by focused tests (`panel-poll.test.ts`, `tests/catalog-refresh.test.ts`) and typecheck;
they are not deployed, so no live after-number exists yet.

# Data fetching: what is left after the batched transport and the resource store

Resume here: P0-6 and P0-7 need a capture with a thread open and restored Workbench panels, since a fresh one-tab load
reproduces neither; P0-9 needs a product decision on paging before its API change.

**Done and documented, no longer a plan item:** P0-8. Attention writes answer a delta through `writeDelta` (probed with
`writeCapabilities`, v1 writes kept for older Hosts) and the `thread_attention` unit stores one record per thread; the
before/after numbers are in
[performance.md](../../docs/performance.md#attention-writes-answer-a-delta-and-the-unit-stores-one-record-per-thread-2026-11-11).
The rest of the finished work is documented where it lives now: the batched transport in the
[dshx API guide](../../tooling/dshx/docs/guides/api.md#several-reads-of-one-tick-share-one-http-request), the
page-wide resource store, tags and `invalidates` in [resource-store.md](../../tooling/dshx/docs/sdk/resource-store.md),
`joinPageRead` and the `settings-models` / `settings-web-search` forks in their READMEs, the live before/after
(158 → 53 requests, 99 % → 0 % of request time queued) in
[performance.md](../../docs/performance.md#live-page-load-after-the-data-fetching-work-2026-11-10), and the batch-aware
HAR, the scratch-host probe, the `ai-accounts/read` route snapshot, attention `changesSince` and the `retry: 1` cleanup in
[performance.md](../../docs/performance.md#batch-aware-page-load-and-the-owned-reads-it-named-2026-11-10-evening), and the project-origins wait budget and the Land `revisionLimit` (P0-11) in
[performance.md](../../docs/performance.md#project-origins-and-the-land-repositories-view-2026-11-10-night).

## Open items

| #    | Item                                                                                                                                                                                                                   | Owner                  | Next step                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| P0-6 | `preview/devServers` ×3 at t = 0 in the 2026-11-06 HAR. Current traces: 306 spans, p50 2.78 s, p95 11.67 s, 27 errors; three roots started within 0.334 ms but arguments are untraced, so duplicate calls are unproven | preview                | Capture with a thread open and count `QueryClient`s / `dshx.api.coalesced` before changing code           |
| P0-7 | `jujutsu-composer/context` ×4 distinct at load. Current traces: 48 spans, p50 4.87 s, p95 24.50 s; one 22.6 s trace is mostly inter-span waits                                                                         | jujutsu, workbench     | A panel-visibility signal from Workbench (owner of the dock) or an always-rendered ref target             |
| P0-9 | `backlog/list` 744 KB in its 2026-11-06 HAR; no `backlog/list` spans in the current retained window, and the panel still sends `limit: 2000`                                                                           | backlog                | API change plus a product decision on paging                                                              |
| P1   | Socket census of the user's own browser: per tab, which EventSources, WebSockets and long reads hold the six sockets                                                                                                   | live-performance-audit | Needs the user's `chrome://net-export` with the tab count noted; a headless capture cannot see other tabs |
| P4b  | Annotations and traces alerts still poll (60 s, 4 s while the annotations popover is open; 30 s alerts feed, every 15 s in the 2026-11-10 load): the Host publishes no change event for them                           | annotations, traces    | Publish `annotations/changed` and an alerts event with `invalidates` tags, then drop the base polls       |
| P6   | Host-pushed snapshots/patches for the heaviest hot keys (`jj-threads/threadAt`)                                                                                                                                        | jj-integration         | Only if a batch-aware HAR still shows it                                                                  |
| P7   | Foldkit adapter spike (a Subscription mapping a Model slice to store keys, Commands for `ensure`/`mutate`) and a foldkit-remote transport comparison                                                                   | dshx                   | Not started; the store core is already free of React and of an Effect runtime                             |
| P8   | Migrate the remaining polling Host reads to store resources; keep TanStack only where a plugin needs its mutation/form helpers                                                                                         | all plugins            | Not started                                                                                               |

P0-10 (`settings/describe` 201 KB ×2) is core `ui-settings`, not an owned plugin: recorded as Host gaps 97 and 99, no
plan item here.

## Constraints that still hold

- The store never mixes owners: keys carry the owner and the Connection identity, and a Host generation reset clears
  it — the reason `plugin-ui` kept per-bundle clients before the store existed.
- Every new route and event stays optional at the boundary; absent means today's behavior on an older Host.
- Verify each item with the same inputs before and after: `har-capture.mjs --summary` on a fresh load with the same
  number of tabs, `REQUESTS=1 switch-probe.mjs`, `host-lag.mjs`, and record the table in
  [docs/performance.md](../../docs/performance.md).

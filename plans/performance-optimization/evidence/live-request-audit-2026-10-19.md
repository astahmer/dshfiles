# Live request audit — 2026-10-19

Slow `/api/...` calls observed in the running Web GUI on `127.0.0.1:3080` (profile `web`, DSH 0.2.1-rc.2,
854 Sessions, 240 plugin entries / 196 active, 92 registered workspaces, 8 jj repositories).

## How this was measured

Reproduction and server-side numbers, all read-only against the running instance:

- Browser: Playwright (headless Chromium) opened the tokenized launch URL from `~/.dsh/runtime/web-url`, waited for
  the first paint plus settle time, then read `performance.getEntriesByType('resource')` and CDP
  `Network.requestWillBeSent` (URL, post body, initiator stack). `durationMs` is the DevTools "Time" column,
  `serverMs` is `responseStart - requestStart` (time to first byte), so a large `serverMs` is Host time and a large
  `startTime -> requestStart` gap is client queueing.
- Direct RPC: `curl` with the cookie jar the tokenized URL sets (`dsh-auth-*`), posting
  `{"type":"client-request","rpcId":…,"method":"<ns>/<method>","payload":{"args":{…}}}` to `/api/<ns>/<method>`.
  `payload.version` must match the plugin API version for `dshx-…` channels.
- Plugin channel mapping: `apiChannel = /dshx-<fnv1a32(packageId + "\0" + apiId)>` (`tooling/dshx/packages/dshx/src/api/common.ts`).
  `dshx-e1cc781b` = `@dshfiles/jj-integration` (`jj-threads`), `dshx-9ca8a5fa` = `@dshfiles/multi-host`,
  `dshx-2c5a0dae` = `@dshfiles/ai-accounts`.
- jj workload: `jj-scan-bench` (below) replays the plugin's own commands — one `jj --ignore-working-copy root` per
  registered workspace, then `jj workspace list` plus the two thread revsets per workspace, at the plugin's
  concurrency of 8.

Probe scripts used here (re-runnable, no writes to the instance):
`~/.dsh`-independent copies live in this thread's workspace history and in `plans/performance-optimization/evidence/`
as `live-request-probe.mjs` and `jj-scan-bench.mjs`.

## What the browser saw (first load after a restart)

| Path | duration | server TTFB | transfer / decoded | repeats |
|---|---|---|---|---|
| `/api/dshx-e1cc781b/repositories` | 18.1 s | 18.1 s | 4.5 kB / 15.6 kB | 2 |
| `/api/session/modelCatalog` | 16.8 s | 1.4 s | 0.9 kB / 2.9 kB | 12 |
| `/api/session/modelCatalog` (worst copy) | 14.3 s | 12.5 s | 0.9 kB / 2.9 kB | 12 |
| `/api/settings/describe` | 14.2 s | 0.1 s | 19.2 kB / 84.8 kB | 2 |
| `/api/agentPresets/list` | 2.6 s | 0.2 s | 0.5 kB / 0.3 kB | 3 |
| `/api/credentials/describe` | 2.3 s | 0.0 s | 0.5 kB / 0.2 kB | 7 |
| `/api/dshx-2c5a0dae/usage` | 2.2 s | 1.8 s | 1.1 kB / 2.7 kB | 1 |
| `/api/dshx-2113d713/state` | 5.0 s | 0.0 s | 0 / 0 | 9 |
| `/api/dshx-57970384/pending` | 10.9 s | 0.4 s | 0.4 kB / 0.2 kB | 4 |
| `/api/session/list` (measured directly) | 2.9 s | – | 23.4 MB decoded, 857 items | 1 |

Non-API first-load cost: the two `/plugins/?…&rev=…` module bundles decoded to **10.3 MB** and **14.5 MB** and took
**4.8 s** and **4.6 s** (60+ modules per request, 39 of them owned).

## Root causes

1. **`session/list` is unbounded and huge.** One call returns 857 Sessions with full projections: 23.4 MB of JSON,
   ~2.9 s server-side, 1.9 MB transferred. It takes `cursor` but returns no continuation, so a client cannot page it.
   The Host serializes and compresses it on one thread, and the page then parses 23 MB on its main thread — which is
   why unrelated requests in the same window show 3.3 s stalls and why requests queued behind it show 5–16 s.
2. **`@dshfiles/jj-integration` `repositories` blocked on the Session list.** The scan awaited
   `readSessionActivity()`, which folds the same 857-Session projection list with an `AbortSignal.timeout(15_000)`.
   The measured jj work for the same store is only **1.7 s** (139 `jj` processes: 47 locates at concurrency 8, then
   56 workspaces × 2 revsets at concurrency 8, 6.7 s of process CPU). 15 s timeout + 1.7 s jj + overhead explains the
   18 s TTFB — and when the timeout fired the scan silently published `canRebase: undefined`, which the client reads
   as "not eligible", so the **Rebase button stays disabled** on a large store (the delayed-activation bug).
3. **Per-repo status reads were sequential.** `scanRepositories` awaited `threads.list(repoRoot)` inside a loop over
   registered workspaces, so 8 repositories cost their sums, not their maximum.
4. **Repeated requests: timers, not double mounts.** Re-measuring the same endpoints with their start timestamps
   corrects the earlier "×2 per mount" reading — none of them fire twice for one mount. They repeat on schedules, and
   the browser allows only six HTTP/1.1 connections per origin, so whatever overlaps the 15 s and 4.8 s requests
   inherits their delay (the identical ~3.3 s block in the screenshot).

   | Endpoint | Cadence | Caller |
   |---|---|---|
   | `dshx-57970384/pending` | every ~5 s | `thread-sidebar` restart-recovery query (`refetchInterval: 5000`) |
   | `dshx-2113d713/state` | every ~5 s | `main-tabs` state query |
   | `dshx-e1cc781b/repositories`, `dshx-9ca8a5fa/threadList` | every ~15–16 s | `thread-sidebar` inventory poll (`INVENTORY_REFRESH_INTERVAL_MS`) |
   | `dshx-2c5a0dae/quotaContinuations` | every ~15 s | `thread-sidebar` usage-limit query (`refetchInterval: 15_000`) |
   | `session/modelCatalog` | 4 concurrent calls every ~21 s | core `dsh-client-ui-model-selection` (one per mounted picker) |
   | `credentials/describe` | bursts of 3, then scattered | core `dsh-client-ui-settings-web-search` |
   | `settings/describe`, `dynamicCordisRunner/inventory`, `syncInspectManifest`, `agentPresets/list`, `permissionPresets/catalog`, `llm/listProviders`, `skills/list` | 2–5 per load | core settings, agent-preset, LLM and Cordis surfaces |

   Caller attribution comes from mapping each CDP initiator frame's line back to the served module section: bundle 1
   (rev `4289a3d29ac6`) holds the core clients, and `session/modelCatalog` frames resolve into
   `@deepseek-ai/dsh-client-ui-model-selection`, `credentials/describe` into `dsh-client-ui-settings-web-search`.
   Endpoints under `/api/dshx-…/` resolve to plugins through the channel hash.
5. **Two monolithic client bundles.** 24.8 MB decoded JavaScript in two requests, both on the critical path; every
   owned plugin's client code lands in one of them.

## Fixed in this thread

`@dshfiles/jj-integration` (revision on this workspace):

- `src/session-activity-cache.ts`: the Session-activity fold is now one bounded, single-flight read. Display reads get
  the last good value immediately, refresh in the background after a 30 s TTL, and wait at most **2.5 s** on a cold
  store; the rebase guard still reads fresh activity with its own 15 s budget, so a rebase can never be authorized by a
  stale "idle" bit. Failures degrade to "unknown" (previous behaviour) instead of hanging the caller.
- `scanRepositories` reads repository statuses with `REPOSITORY_SCAN_CONCURRENCY = 4` instead of one after another.
- A jj mutation still invalidates the activity cache along with the other jj-derived caches.

Expected effect: `repositories` after a restart drops from ~18 s to ~2–4 s (jj 1.7 s + one bounded activity read),
and a slow Host can no longer hold the sidebar's repository query for 15 s.

`@dshfiles/thread-sidebar` (same workspace):

- The shell hides the thread region with CSS while the sidebar is collapsed, so the package now passes `wide` through
  the `sidebar.workspaces` props and the inventory query is `enabled` only while that region is on screen. Collapsing
  the sidebar buys no jj scan, and expanding it reads the inventory once.
- The inventory schedule stops while the collapsed sidebar cannot show its result (`setAvailable` now also carries the
  visibility), so its 30 s→**60 s** interval no longer spends a full jj scan (139 `jj` processes on this store) on
  every other tick — the Host keeps a repository view for sixty seconds, which the shorter schedule kept missing.
- Evidence: `thread-sidebar.jj-inventory-pauses-while-collapsed` (new journey) passes, and fails when the `enabled`
  gate is removed (negative control); `inventory-poll.test.ts` covers the stopped schedule through a visibility cycle.


## Still open (measured, not yet fixed)

- `session/list` pagination/projection filtering is **Host/core** work: the gateway offers only `cursor` and returns
  one unpaged block. Recorded in `plans/dsh-host-gaps.md` terms; no core patch from this repository.
- The remaining per-surface timers are honest product choices, not duplicates: `thread-sidebar` reads restart
  recovery every 5 s and usage limits every 15 s, `main-tabs` reads state every 5 s, and core's model selection asks
  for `session/modelCatalog` four times in a burst every ~21 s (one per mounted model picker). Shortening or pausing
  the ones a hidden surface owns is the next lever; none of them is a double mount.
- Client bundle size: the owned client bundles the live profile links total **15.4 MB** of JavaScript, and the two
  served module requests decode to 10.3 MB + 14.5 MB. Ranked sizes are in
  [owned-client-bundles.json](owned-client-bundles.json); `@dshfiles/editor` alone is **5.7 MB** (a bundled editor
  dependency that is neither shared nor loaded on demand), then `pulls-review` and `jujutsu` at 1.6 MB each. That is
  the next measured lever, not `ui-styles` as earlier assumed.

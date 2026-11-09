# Startup request audit — fresh DSH start + page refresh

Measured from a real browser HAR (`fresh-start-not-busy.har`, HAR 1.2, 27 MB, captured on the user's live
instance on 2026-11-03 08:06 UTC). Read-only: the capture was copied to a scratch path and parsed in memory.
Reproduce with the script that produced every number here:

```sh
node plans/performance-optimization/evidence/har-requests.mjs <copy of the capture.har> --json result.json
```

The script prints the group table, patterns by decoded bytes, the 20 slowest entries, repeats with the gap
between consecutive identical requests, what was still open at the two load markers, and every long-lived entry.
`dshx-<hash>/<method>` channels resolve to `@dshfiles/<plugin>` through
`apiChannel = /dshx-<fnv1a32(packageId + "\0" + apiId)>` (`tooling/dshx/packages/dshx/src/api/channel.ts`);
the mapping used below is resolved by hand from each plugin's `defineApi` id.

## Headline

| Reading               | Value                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Requests              | 189 (all `_resourceType: fetch`; no bundle, static or websocket entries were in this capture)          |
| Decoded / transferred | 12,647 KiB / 3,190 KiB                                                                                 |
| Window                | 42.0 s                                                                                                 |
| Page markers          | `DOMContentLoaded` 435 ms, `load` 2,246 ms                                                             |
| Queueing              | 119 of 189 requests waited > 50 ms for a connection; 116 s of blocked time in total; peak 38 in flight |
| Failed                | 7 requests, all `GET /api/changes.summary` → 404                                                       |

The page reached `load` in 2.2 s while 42 s of API traffic continued behind it. Most of that tail is real work
(session history), but the budget question from `docs/performance.md` is per request: 11 requests took over
2.5 s. Those are the ones this audit ranks.

## Group owners

| Owner                                               | Requests |   Decoded | What it is                                                          |
| --------------------------------------------------- | -------: | --------: | ------------------------------------------------------------------- |
| native `session`                                    |       36 | 9,834 KiB | history pages, Session list, attachments, model catalog             |
| `@dshfiles/jj-integration`                          |       28 | 1,265 KiB | `repositories`, `threadAt`, `projects`, `destination`               |
| `@dshfiles/jujutsu`                                 |       10 |   631 KiB | `referenceGraph`, `openRepository`, `registerRepository`, `context` |
| `@dshfiles/thread-sidebar`                          |        6 |   352 KiB | attention `state`, `pending`, `cleanupJobs`, `threadList`           |
| native `settings` / `pluginManager` / `credentials` |       10 |   245 KiB | profile describe, bundle list, credential probes                    |
| `@dshfiles/ai-accounts`                             |       10 |    55 KiB | `quotaContinuations`, `usage`, `read`, `quoteRoutes`                |
| `@dshfiles/preview`                                 |       18 |   2.6 KiB | `devServers` + `list`, once per mounted session header every 10 s   |
| everything else (14 owners)                         |       40 |    60 KiB | small single reads                                                  |

## Patterns by decoded bytes

| Requests |   Decoded |   Slowest | Slowest TTFB | Pattern                              | Owner                      |
| -------: | --------: | --------: | -----------: | ------------------------------------ | -------------------------- |
|        4 | 6,047 KiB |  9,747 ms |     9,477 ms | `api/session/page`                   | native                     |
|        1 | 3,225 KiB | 10,220 ms |     9,061 ms | `api/session/list`                   | native                     |
|        3 |   999 KiB |  1,646 ms |        74 ms | `dshx-e1cc781b/repositories`         | jj-integration             |
|        5 |   630 KiB |  1,299 ms |       319 ms | `dshx-6b371122/referenceGraph`       | jujutsu                    |
|        7 |   457 KiB |  1,513 ms |     1,441 ms | `api/session/attachment`             | native                     |
|        3 |   352 KiB |    852 ms |        13 ms | `dshx-2113d713/state`                | thread-sidebar             |
|       18 |   257 KiB |  1,803 ms |       469 ms | `dshx-e1cc781b/threadAt`             | jj-integration             |
|       24 |   105 KiB |  1,660 ms |       750 ms | `api/session/modelCatalog`           | native                     |
|       18 |   2.6 KiB |  3,102 ms |     3,099 ms | `dshx-16a2d652/devServers` + `/list` | preview                    |
|        7 |   0.2 KiB |    369 ms |        79 ms | `api/changes.summary`                | diff-viewed (native route) |

## 20 slowest

|            start |           wall |       TTFB | status |   decoded | pattern                                    |
| ---------------: | -------------: | ---------: | -----: | --------: | ------------------------------------------ |
|           599 ms |      10,603 ms |  10,120 ms |    200 |   1.0 KiB | `ai-accounts/quotaContinuations`           |
|         1,002 ms |      10,220 ms |   9,061 ms |    200 | 3,225 KiB | `session/list`                             |
|        22,237 ms |       9,747 ms |   9,477 ms |    200 | 3,620 KiB | `session/page`                             |
|        31,186 ms |       9,220 ms |   9,036 ms |    200 |   380 KiB | `session/page`                             |
|        22,931 ms |       8,866 ms |   7,880 ms |    200 | 1,470 KiB | `session/page`                             |
|        22,475 ms |       8,613 ms |   8,405 ms |    200 |   577 KiB | `session/page`                             |
|        26,208 ms |       4,877 ms |   2,248 ms |    200 |   1.0 KiB | `ai-accounts/quotaContinuations`           |
|        12,966 ms |       3,102 ms |   3,099 ms |    200 |   0.2 KiB | `preview/devServers`                       |
|        13,003 ms |       3,065 ms |   3,060 ms |    200 |   0.2 KiB | `preview/devServers`                       |
|        13,008 ms |       3,061 ms |   2,359 ms |    200 |   0.2 KiB | `preview/devServers`                       |
|        28,143 ms |       2,945 ms |       2 ms |    200 |   0.5 KiB | `session-undo/history`                     |
|        26,078 ms |       2,756 ms |       1 ms |    200 |   0.1 KiB | `preview/list`                             |
| 26,077–26,072 ms | 2,753–2,755 ms | 1–2,743 ms |    200 |   0.2 KiB | `preview/devServers` ×3, `preview/list` ×2 |
|        28,687 ms |       2,404 ms |       2 ms |    200 |   1.5 KiB | `session-undo/history`                     |
|        29,277 ms |       1,814 ms |       2 ms |    200 |   0.4 KiB | `session-undo/history`                     |
|        30,000 ms |       1,803 ms |     469 ms |    200 |   0.7 KiB | `jj-integration/threadAt`                  |

Two things separate TTFB (~server) from wall (~browser queue) here: `quotaContinuations` at 10.6 s is 10.1 s of
Host time, while `preview/list` at 2.7 s is 1 ms of Host time and 2.75 s of queueing behind the six-connection
limit. The second is a symptom of firing 38 requests at once, not of a slow endpoint.

## Repeats (identical method + path), gap to the previous copy

| Requests | Closest gap | Gaps ≤ 1 s | Pattern                               |
| -------: | ----------: | ---------: | ------------------------------------- |
|       24 |        0 ms |         22 | `session/modelCatalog`                |
|       18 |        0 ms |         12 | `jj-integration/threadAt`             |
|    9 + 9 |        1 ms |      6 + 6 | `preview/devServers` + `preview/list` |
|        7 |        0 ms |          5 | `credentials/describe`                |
|        7 |        0 ms |          5 | `session/attachment`                  |
|        7 |        1 ms |          4 | `changes.summary` (all 404)           |
|        6 |        2 ms |          5 | `multi-host/sessionRuntime`           |
|        6 |        4 ms |          4 | `session-undo/history`                |
|        5 |      254 ms |          3 | `jujutsu/referenceGraph`              |

## Waterfall against the page markers

`load` at 2,246 ms. Everything still open then (start → end, wall):

- `session/list` 1,002 → 11,222 ms (3.2 MB), `quotaContinuations` 599 → 11,203 ms
- `settings/describe` 1,027 → 2,276 ms and 0 → 91 ms, `account/getBalance` 1,035 → 2,666 ms
- `agentPresets/list` 1,020 → 2,196 ms, `jj-integration/projects` 1,132 → 2,348 ms
- `preview/devServers` + `/list` 12.9 s → 16.1 s: the first probe round lands after the page is already loaded

So the first usable content is gated by `session/list` (3.2 MB, 9.1 s TTFB) and its queue: 24 requests stacked
behind it. The capture starts 1.9 s after `pages[0].startedDateTime` and holds only `fetch` entries, so bundle
loading is outside the recorded window; this artifact can say nothing about bundle bytes or cache state, only
that the API traffic after the first paint is what keeps the page busy.

## Long-lived / polled entries

No websocket and no event-stream entry exists in this capture: the connection's long poll (`/api/dshx-events`)
is not represented as an HTTP entry, so it cannot be audited from this artifact. The long-lived list is therefore
just the slow polls above. Cadences observed:

| Endpoint                       | Cadence in the window                  | Caller                               |
| ------------------------------ | -------------------------------------- | ------------------------------------ |
| `preview/devServers` + `/list` | every 10 s, per mounted session header | `@dshfiles/preview` `DevServersChip` |
| `jj-integration/repositories`  | 60 s, or 5 s while `refreshing`        | `@dshfiles/jj-integration` panel     |
| `thread-sidebar/state`         | 30 s (2 s minimum gap)                 | attention store                      |
| `session-undo/history`         | 15 s per mounted composer              | `@dshfiles/session-undo`             |

## Ranked by wasted work

1. **`preview/devServers` + `list`: 18 requests and ~9 s of Host probe for an empty answer.** Three session
   headers each poll every 10 s; each `devServers` call spawns `lsof`, `ps` and the same `sessionController.list()`
   fold the page's own `session/list` ships as 3.2 MB, then returns `{"supported":true,"servers":[]}`; `DevServersChip` renders `null` when both lists are empty. On an
   idle profile 100 % of this work is wasted, and it repeats forever while the page is open. Each round costs
   3.0–3.1 s of Host time, 18 requests per 42 s. Expected: the poll exists so a newly started dev server shows up;
   the same information arrives on the `pagesChanged` event the chip already subscribes to.
2. **`session/modelCatalog` 24 requests, 22 within 1 s of the previous copy.** Four mounted pickers ask for the
   same catalog in the same tick. `ModelCatalogDirectory.load()` does coalesce one in-flight load per generation,
   so the 4-wide bursts come from consumers outside that directory (the native settings rows and the effort picker
   load their own). Owner is native for three of the four → recorded, not fixed here.
3. **`jj-integration/threadAt` 18 requests, 12 within 1 s.** One path answers with the same 42,345 bytes six
   times (201 unlanded revisions, 14.5 KB of descriptions) for a control that only reads `.length` and
   `.some(conflict)`. Repeats at 4.8–6.4 s, three paths in lockstep. The poll condition lives in
   `client.tsx`'s `refetchInterval`; whether it should fire at all in this state needs a live re-measurement, so
   no change was made from the static reading.
4. **`jujutsu/referenceGraph` 5 × 125–131 KiB.** Two full revisions arrays (208–217 rows) per visible project,
   for a chip title and a hover popover. N+1 by reference: each visible jj reference resolves its own graph, and a
   miss in the preferred project re-probes cwd and then every registered repository.
   **Payload fixed:** the Host now collapses each hidden stretch between listed rows to one stand-in revision, so on
   this repository an answer went from 233–240 revisions / 121–146 KiB to 9–15 revisions / 6–10 KiB with an identical
   preview layout (`ReferenceGraphModel.collapseHidden`, checked against the full graph on four real references). The
   per-reference fan-out is still open.
5. **`changes.summary` 7 × 404.** `@dshfiles/diff-viewed` asks `api/changes.summary` (a native route this Host
   does not serve) once per rendered turn action, and gets 404 every time. Small bytes, but it is a failed request
   per turn on every page load.
   **Re-read 2026-11-09 (B10):** the route is served (`dsh-client-ui-deliverables` `handleChangesSummary`); it
   answers 404 once the Host no longer holds that Session's in-memory change recorder, which a fresh start always
   is. The per-turn loads on page load come from the native turn card (`Deliverables` loads every announced
   turn's summary on mount), not from diff-viewed: its toggle only renders inside the review tab after the
   native read succeeded. diff-viewed now reads a summary once per page and keeps a 404 as "no summary" instead of
   re-asking on each file switch. The native per-turn 404 after a restart remains, owned by stock core.
6. **`multi-host/sessionRuntime` 6 × (2 per Session), `session-undo/history` 6 ×.** Both are tiny payloads; the
   duplication is mount-time, not a growth pattern. Worth a `staleTime`, not a work package on its own.
7. **Queueing, not server time.** 38 concurrent requests against a six-connection HTTP/1.1 origin turned a 1 ms
   `preview/list` into 2.75 s. Trimming request count (items 1–5) is worth more than any single endpoint's speed.

## Regressions from the Effect migration?

No evidence in this artifact. The capture holds only `fetch` entries and no bundle request, so client-side bundle
growth from the Effect edge cannot be read from it; the `dshx-*` requests each map to exactly one `defineApi`
method, and the recorded API dispatch hop is the same one the plugin's own client already had. Any "extra
layering" claim would need a bundle-and-Host CPU profile, not a HAR.

## Against the repo's own expectations

- `docs/performance.md` sets 250 ms per request. 11 of 189 exceed 2.5 s and 5 exceed 8 s; all five belong to
  native `session/page` and `session/list`. The owned-plugin offenders are `quotaContinuations` (10.1 s Host time,
  `@dshfiles/ai-accounts`, which folds `sessionController.list()` — 3.2 MB — to attach titles to a handful of
  rows), `preview/devServers` (3.1 s probe, item 1), and `session-undo/history` (queueing only).
- The plan's own live audit from 2026-10-19 (`plans/performance-optimization/evidence/live-request-audit-2026-10-19.md`)
  named `session/list` as unbounded and huge; this capture confirms it unchanged (3.2 MB, one request, 9.1 s TTFB).
- The `live-performance-audit` skill's trap list includes "input-trigger sources that warm on every composer mount"
  and "`refetchOnMount: 'always'` on queries mounted by the composer". Item 1 is the same shape: a global poll
  mounted by every session header.

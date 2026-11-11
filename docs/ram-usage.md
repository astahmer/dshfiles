# RAM usage

What a DSH Host and its browser tab actually hold, how to measure it without fooling yourself, and which
patterns keep it bounded. Numbers below were measured on this machine (2026-11-08, Node 22, DSH 0.2.1-rc.2,
~2,800 stored Sessions); the sweep that produced them is in [performance.md](performance.md#ram-sweep-2026-11-08).

## How to measure

- **Settle first.** A Host reads ~500 MB ten seconds after boot and ~610 MB at two minutes; reads between 10 s
  and 100 s scatter ±90 MB. Take `heapUsed` after a full GC and only after ~110 s.
- **Never census a live Host.** `Runtime.queryObjects(Object.prototype)` keeps every object it returns alive in
  the inspector session. One census of a 3 GB Host pinned ~2.3 GB, pushed it past V8's 4 GB ceiling and killed
  it. Use `process.memoryUsage()` and `v8.getHeapSpaceStatistics()` for counters; run a census or a snapshot only
  on a scratch Host you can lose.
- **Close the inspector.** `SIGUSR1` opens 127.0.0.1:9229; a second Host cannot open it, so a probe may silently
  measure the wrong process. Check `process.pid` through the socket before trusting a reading, and close the
  session when done.
- **Compare like with like.** A scratch Host needs the same profile, Session corpus and storages; a scratch
  without an attached client is the _steady_ state, and a live Host's extra heap is what clients cost.

## The live Host now (2026-11-10)

The multi-GB heaps described below are gone. Read on the live Host 1 h 38 min after its 16:15 restart (Node 22,
DSH 0.2.1-rc.2, every change in this file on `main`), with RSS only, no inspector attached:

```sh
ps -o rss,etime -p <verified Host pid>      # or the worktree_memory_snapshot agent tool
du -sh ~/.dsh ~/.dsh/plugins/* ~/.dsh/storages/*
```

| Measure                        | 2026-11-08 / 11-09                                                                | 2026-11-10                                  |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------- |
| Host heap / RSS                | 3,151 MB `heapUsed` after GC (76 % of the 4.14 GB limit); 2.82 GB after a restart | RSS 409–579 MB across two reads 2 min apart |
| `~/.dsh` on disk               | 11 GB                                                                             | 4.2 GB, of which 3.0 GB is the Session logs |
| `plugins/session-search`       | 3.8 GB, 1,236,334 Session documents                                               | 332 MB, 106,020 documents                   |
| `plugins/session-query-sqlite` | 874 MB                                                                            | gone                                        |
| `plugins/fff-search`           | 584 MB                                                                            | 38 MB                                       |
| `plugins/usage`                | 356 MB (82 MB WAL)                                                                | 250 MB (4 MB WAL)                           |
| `plugins/traces`               | 271 MB (50 MB WAL)                                                                | 79 MB (19 MB WAL)                           |
| `plugins/optmem`               | 334 MB (orphan, no owning package)                                                | gone                                        |
| `storages/session_projcache`   | 317 MB                                                                            | 45 MB                                       |
| `session list read` span       | p50 8.7 s, p95 10 s                                                               | p50 47 ms, p95 320 ms (78 reads in 100 min) |

What closed the gap, in order of size:

- **Decoded logs held by prepared Sessions.** A sampling heap profile started at boot (never a snapshot of the live
  Host) named one site for 1,376 MB of a 3,045 MB heap: `SessionLogScanner.write` in the session-log restore path, i.e.
  whole decoded logs (the largest are 283 / 199 / 157 MB uncompressed) kept by the native `SessionQueryEngine`'s
  prepared-session cache. `profiles/web` sets `preparedSessionCacheSize: 1`; the byte-bounded cache needs the core
  engine (Host gap 102). The `session-controller` fork stopped open follows from pinning decoded logs and frames and
  disposes an Agent idle for five minutes.
- **Search over the hot set only.** 2,079 of 2,820 Sessions were archived, so `session-search` drops archived Sessions'
  documents and indexes one back only for a targeted search. Age was not a usable cutoff: 2,294 of 2,406 logs were
  younger than 30 days. The FTS `_content` tables were not a duplicate of the index (2,336 MB content + 1,312 MB index
  for 1.24 M documents is normal FTS sizing), so a contentless index was never needed.
- **Dead stores.** `fff-search` records each store's root (`root.txt`) and prunes stores whose root is gone at worker
  start (2,099 of 2,152 stores were dead); the WAL limits and demand gates below keep `usage` and `traces` small.

A scratch Host with the identical corpus, stores and profile held 519 MB after GC against the live 3,156 MB at the
time, and 293 MB without the plugin stores: store work is a disk lever (about 226 MB resident), not the heap.

## What the memory was

Measured on 2026-11-09 after a fresh restart, the sweep's 610 MB baseline no longer holds. The live Host reached
**2.82 GB live heap** (`heapUsed` after `HeapProfiler.collectGarbage`, 8.5 minutes uptime, 6 attached clients), and one
Chrome renderer for the DSH tab held **3.3 GB RSS** with another at 1.7 GB during the same window.

A heap snapshot attributed the Host's 2.92 GB of nodes as: **2.03 GB of strings** (12.2 million string nodes over 3.06
million distinct values, average 174 bytes), 382 MB objects, 261 MB arrays. Deep retainer chains name the owner: the
strings sit under `Object.events[] → Object.data → Object.stream[] → Object.chunk → Object.replayState →
Object.blocks[] → Object.thinkingSignature`, and the same shape appears through message data and through suspended
async stacks that hold an `events` array. So the Host retains **every streamed assistant chunk with its per-chunk
`replayState` blocks** for the live Sessions it keeps. That is the same payload the browser path already strips:
[`browser-event.ts`](../plugins/@dshfiles/session-controller/src/browser-event.ts) deletes `replayState.blocks`
before an event reaches a client, which is why the wire is small while the Host copy is not.

Module source, schemas and Effect are minor in comparison; the 3 GB log corpus only matters once something decodes
it. What the fork in `plugins/@dshfiles/agent-loop` removes, measured on `session-6b9ec57a` (760 assistant messages,
19 MB of events, 2026-11-09):

| Part of `assistant/message`                               | Bytes   |
| --------------------------------------------------------- | ------- |
| Whole event data                                          | 4.55 MB |
| `message.source.replayState.blocks`                       | 433 KB  |
| `stream[].chunk.replayState.blocks` (dropped by the fork) | 433 KB  |
| `data.stream` in total                                    | 2.85 MB |

A scripted integration run through the real loop (`tests/agent-loop.integration.test.ts`, one 600-byte signature)
compares both sides in one test: upstream stores the block list on the message source **and** the terminal stream
record (1,981 B of event data), the fork keeps only the source copy (1,353 B) while the replayed assistant message in
the next model request still carries the block list — 628 B saved per message, and provider replay proven intact.

That is ~9.5 % of that Session's `assistant/message` bytes and ~2.3 % of its whole log. Across the eleven Sessions of one
live thread the removable duplicate is **1.02 MB of 8.34 MB** of `assistant/message` data — a genuine duplicate
removed, but **not** the explanation for the multi-GB live heap. The same log shows where the rest of a Session's
bytes sit: `request/header` 8.87 MB (34 events, mostly the 455-tool catalog), `assistant/message` 4.45 MB,
`tool/result` 2.51 MB. A 2.82 GB live set over a handful of live Sessions therefore still means those events are held
several times over, not that one event is huge; the next thing to attribute is the 12.2 M `{"type":"reasoning",…}`
strings in the snapshot, which are raw adapter chunks and not the compact records this fork trims.

Two owners follow:

- **Host:** the per-block replay duplicate is fixed by the
  [`@dshfiles/agent-loop`](../plugins/@dshfiles/agent-loop/README.md) fork (see the table above); the `request/header`
  tool catalog is stored once per Session by the
  [`@dshfiles/session-persistence-jsonl`](../plugins/@dshfiles/session-persistence-jsonl/README.md) fork (repeats are
  288-byte references, numbers in [performance.md](performance.md#session-log-tool-catalog-bytes-2026-11-10)); the raw
  reasoning-chunk strings and the multi-copy question are separate and unattributed.
- **Browser:** one renderer held 3.3 GB for this tab, with a second at 1.7 GB. Its own copy is already block-stripped,
  so the cost is resident per-thread client state. The client store is the owned
  [session-controller fork](../plugins/@dshfiles/session-controller/README.md#local-delta): history projections stay
  resident for the last 3 viewed Sessions (`RESIDENT_SESSION_STATE_LIMIT`), and since `jj:zrstxszz` a Session instance
  no view subscribes to is released past 4 (`RESIDENT_UNMOUNTED_SESSION_LIMIT`), so its event window and projections
  are dropped and refetched on the next open. The remaining growth is the resident window of threads still mounted or
  recently viewed; a per-thread LRU below that needs a rather different ownership change.

Both asks are drafted in this file for the moment the user decides to file them: the repository has issues disabled,
and publishing is their call. Re-measure the tab after a refresh: open a dozen threads, return to one, settle
110 s, then compare against the 3.3 GB baseline with the same `heapUsed`-after-GC protocol.

Measured composition of a 610 MB Host with the web profile, no client attached. The rows come from different ablation
boots (the sweep measured each owner by booting without it), so they are per-owner costs rather than one additive boot:

| Owner                              | MB                            | Why it is there                                                                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_projcache` storage domain | 252 before pruning, ~15 after | one derived checkpoint per Session; the owned `storage-domain` + `storage-json` forks hydrate a per-record domain one record at a time behind a 64-row LRU, so the heap no longer follows the record count. Only orphans are pruned (see Retention) |
| other JSON storage domains         | 67                            | the same contract for domains that never opt into per-record reads: `backlog_files`, … (`ai_accounts_usage`, 13.5 MB loaded whole, moved to a lazily opened SQLite file in 2026-11)                                                                 |
| plugin SQLite stores               | ~2                            | the shared `sqlite-store` layer defers a store to its first call; opened at activation each cost about 0.5 MB of heap                                                                                                                               |
| Session corpus on disk             | 25                            | 2.9 GB of logs costs little until something decodes them                                                                                                                                                                                            |
| core + 230 plugins + Effect + dshx | 263                           | module graph (~179 MB for 96 Host bundles) and per-activation layers; the SQLite row above sits inside this one                                                                                                                                     |

Effect is only **3.6 %** (~22 MB): schemas are built once per module and 4.1 has no separate compile step to
exploit. The session-log corpus is not the problem either; the _caches_ that hold decoded logs are.

The browser tab is a different shape. One headless-Chromium probe against a scratch Host measured ~126 MB at load
(mostly bytecode and module source across the client bundles), +6.6 MB per distinct thread opened, and 189 MB still
held by a blank tab after 20 threads. Those figures come from that single probe run, not from a checked-in artifact.

## Patterns that keep it bounded

- **Bound by bytes, not by count.** A durable Session event reaches 314 KB; 4,096 of them is over a gigabyte.
  The follower carries an 8 MB budget, the dshx event stream a 1 MB window, and an in-flight assistant attempt
  drops its baseline past 4,096 chunks.
- **A replacement frame needs no history.** A projection or rebuild frame supersedes the older one for the same
  cell, so a queue can coalesce and drop; a client that lags resyncs from a snapshot instead of the Host holding
  what it never read.
- **Derived data gets retention, unless it is the only cheap copy.** Projection checkpoints are kept for every stored
  Session and pruned only when their Session is deleted (`session-search`, once per boot): a 14-day prune deleted the
  checkpoints of idle threads, which never rewrite theirs, so 1,890 of 2,916 cold threads lost their title and list
  metadata and each open read the whole log; a one-time pass rebuilt them. Job
  history (a day), quota history (30 days), usage requests (90 days hot, older rows in a cold archive the reports
  still read), traces (30 k spans, 60 k points). Nothing derived should live forever.
- **Compact what deletes.** FTS5 keeps pruned postings in un-merged segments: 1.82 GB of a 2.01 GB index for
  80 MB of text. `optimize` + VACUUM took it to 182 MB and searches from 15–47 ms to 1–2 ms. `VACUUM` alone only
  frees the page freelist. The index re-bloats as Sessions are archived and pruned again, so the worker compacts at
  most once an hour whenever it holds more than 2 KB per document or a quarter of its pages are free.
- **Bound the write-ahead log.** Without `journal_size_limit`, a store's `-wal` grows beside it: 246 MB next to a
  245 MB database. `sqlite-store` sets 32 MB and an autocheckpoint, and the search worker's own index sets the same
  pair (its log had reached 225 MB beside a 291 MB index).
- **Gate background work on demand.** An index pass is worth running when someone reads its panel. Usage,
  agentsview and the job-history indexer stop after five minutes without a read; the projection-cache orphan prune
  runs once per boot, two minutes in.
- **Workers get their own limits.** A plugin worker inherits the Host's 4 GB ceiling; the search worker declares
  512 MB and the fff worker 256 MB.
- **Open stores on first use.** `sqlite-store`'s `deferred` layer builds the store inside the plugin scope on the
  first call, so a plugin nobody reads costs nothing.

## Lazy Host halves, measured (2026-11-08)

`DshxPlugin.make({ lazy: true })` is now the opt-in dshx primitive: tools, APIs, settings and prompt contributions still
register at activation, but the layer and `main` start on the first call, and every call that arrives while that build
runs waits for the same one. `@dshfiles/agentsview` is the proof row. Measured on a scratch
`dshx dev up --plugin @dshfiles/agentsview` Host (base bundles plus that row, panel never opened, browser attached,
115 s settle, `heapUsed` after `HeapProfiler.collectGarbage` attached to the Host's own child pid, launch URL never
printed):

| Measurement                                             | Eager               | Lazy                         |
| ------------------------------------------------------- | ------------------- | ---------------------------- |
| `heapUsed`, panel never opened                          | 97.1 MB             | 96.9 MB                      |
| that row's layer, same process before → after first use | n/a (built at boot) | 96.9 → 97.8 MB (+0.9 MB)     |
| first `agentsview.list` call                            | 15.4 ms             | 17.1 ms (includes the build) |
| warm `agentsview.list` call                             | 4.2 ms              | 10.1 ms                      |

The row's activation costs **0.9 MB of heap and a few ms**; the boot-to-boot difference (0.2 MB) is inside the ±15 MB
boot-to-boot noise, so the per-row cost is measured in-process. Two costs layer deferral cannot remove explain the
remaining distance to the 80 MB lever: the **module graph** (importing `agentsview/dist/index.js` into a process that
already loaded Effect, dshx and `@effect/platform-node` adds 3.0 MB of heap; 29.6 MB including those shared modules) and
what an activation **enables downstream** (`session-search` registers the `sessionQuery` service at activation, 90 MB
above). A facade row that imports the real bundle on first use would defer the module graph, but keeping tool and API
registration static then needs a split build: a manifest module with tool names, schemas and API contracts separate from
the layer's module graph. dshx emits one Host artifact per plugin, so that facade is a further primitive, not a flag on
this one.

## Levers still open

| Lever                                          | Measured                         | Needs                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lazy storage-domain hydration                  | 67 MB                            | the `storage-domain`/`storage-json` forks hydrate per record with an LRU; the remaining cost is the core contract's `loadAll` for domains that do not declare lazy reads                                                                                                                                                                                      |
| Lazy Host halves for panel rows                | 0.9 MB / 7 ms per unopened row   | the opt-in `lazy` mode keeps the layer out (§ above); the remaining 80 MB is each row's module graph (3.0 MB marginal) and the services an activation enables downstream, which need a facade row with a split manifest artifact                                                                                                                              |
| Per-session client state LRU                   | 100–110 MB per tab at 20 threads | the session-controller client fork keeps every opened thread resident                                                                                                                                                                                                                                                                                         |
| One shared Effect `HostContext` per activation | 20–40 (est.)                     | dshx builds a fresh tracer/host layer per plugin                                                                                                                                                                                                                                                                                                              |
| Byte-bounded prepared-session cache            | up to ~1.4 GB at count 5         | core `SessionQueryEngine` (Host gap 102); `profiles/web` caps the count at 1 meanwhile                                                                                                                                                                                                                                                                        |
| `memory` / `backlog` retention and VACUUM      | disk: 113 MB / 12 MB + 8 MB WAL  | measured 2026-11-11: memory 312 free pages (1.2 MB of 119 MB), backlog none, so a VACUUM is not worth it; traces 3,585 (14.7 MB of 64.7 MB). `sqlite-store` files are now created `auto_vacuum = INCREMENTAL` with bounded passes; older files convert only through a user's Reclaim ([sqlite-store](../plugins/@dshfiles/sqlite-store/README.md#free-space)) |
| Projection-cache size cap                      | disk: 45 MB (317 MB before)      | the native projection cache owns `storages/session_projcache`; only orphans are pruned here, a cap is a core change                                                                                                                                                                                                                                           |
| Legacy `storages/ai_accounts_usage.json`       | disk: 14 MB                      | quota history moved to SQLite on 2026-11-10; the JSON document is no longer written (last write 2026-11-09) but stays on disk                                                                                                                                                                                                                                 |

## Ruled out

- Effect schema "precompilation" (4.1 parsers already are functions; the win would be CPU, not RAM).
- More transcript virtualisation: the DOM is already windowed to ~24 rows per thread.
- Hidden plugin panels: they replace content (externally measured, 300–700 nodes each; no artifact in this repo).
- Age-based retention on the Session logs: by file mtime about 2.5 GB of the 2.9 GB is more than a week old, and
  only 21 MB more than 30 days, so an age cutoff deletes most of the history to reclaim little of the recent bulk.

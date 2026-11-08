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

## What the memory is

Measured composition of a 610 MB Host with the web profile, no client attached:

| Owner                              | MB                            | Why it is there                                                                                                 |
| ---------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `session_projcache` storage domain | 252 before pruning, ~15 after | one derived checkpoint per Session, and `@deepseek-ai/dsh-storage-json` materializes a whole domain at `open()` |
| other JSON storage domains         | 67                            | same contract: `backlog_files`, `ai_accounts_usage`, …                                                          |
| plugin SQLite stores               | 61                            | opened and hydrated at activation, before any read                                                              |
| Session corpus on disk             | 25                            | 2.9 GB of logs costs little until something decodes them                                                        |
| core + 230 plugins + Effect + dshx | 263                           | module graph (~179 MB for 96 Host bundles) and per-activation layers                                            |

Effect is only **3.6 %** (~22 MB): schemas are built once per module and 4.1 has no separate compile step to
exploit. The session-log corpus is not the problem either; the _caches_ that hold decoded logs are.

The browser tab is a different shape: ~126 MB at load is mostly bytecode and module source (110 bundles,
24.8 MB), and each distinct thread opened adds **~6.6 MB** that was never evicted.

## Patterns that keep it bounded

- **Bound by bytes, not by count.** A durable Session event reaches 314 KB; 4,096 of them is over a gigabyte.
  The follower carries an 8 MB budget, the dshx event stream a 1 MB window, and an in-flight assistant attempt
  drops its baseline past 4,096 chunks.
- **A replacement frame needs no history.** A projection or rebuild frame supersedes the older one for the same
  cell, so a queue can coalesce and drop; a client that lags resyncs from a snapshot instead of the Host holding
  what it never read.
- **Derived data gets retention.** Projection checkpoints (14 days, pruned hourly by `session-search`), job
  history (a day), quota history (30 days), usage requests (90 days hot, older rows in a cold archive the reports
  still read), traces (30 k spans, 60 k points). Nothing derived should live forever.
- **Compact what deletes.** FTS5 keeps pruned postings in un-merged segments: 1.82 GB of a 2.01 GB index for
  80 MB of text. `optimize` + VACUUM took it to 182 MB and searches from 15–47 ms to 1–2 ms. `VACUUM` alone only
  frees the page freelist.
- **Bound the write-ahead log.** Without `journal_size_limit`, a store's `-wal` grows beside it: 246 MB next to a
  245 MB database. `sqlite-store` sets 32 MB and an autocheckpoint.
- **Gate background work on demand.** An index pass is worth running when someone reads its panel. Usage,
  agentsview and the job-history indexer stop after five minutes without a read; the projection-cache prune runs
  hourly and no-ops when nothing is stale.
- **Workers get their own limits.** A plugin worker inherits the Host's 4 GB ceiling; the search worker declares
  512 MB and the fff worker 256 MB.
- **Open stores on first use.** `sqlite-store`'s `deferred` layer builds the store inside the plugin scope on the
  first call, so a plugin nobody reads costs nothing.

## Levers still open

| Lever                                          | Measured                         | Needs                                                                                                                                                                    |
| ---------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lazy storage-domain hydration                  | 67 MB                            | the `storage-domain`/`storage-json` forks hydrate per record with an LRU; the remaining cost is the core contract's `loadAll` for domains that do not declare lazy reads |
| Lazy Host halves for panel rows                | 80 MB                            | dshx builds every plugin layer at activation; a lazy mode (or the plugin-manager facade) would keep a panel's module graph out of a Host nobody opened it in             |
| Per-session client state LRU                   | 100–110 MB per tab at 20 threads | the session-controller client fork keeps every opened thread resident                                                                                                    |
| One shared Effect `HostContext` per activation | 20–40 (est.)                     | dshx builds a fresh tracer/host layer per plugin                                                                                                                         |

## Ruled out

- Effect schema "precompilation" (4.1 parsers already are functions; the win would be CPU, not RAM).
- More transcript virtualisation: the DOM is already windowed to ~24 rows per thread.
- Hidden plugin panels: they replace content, 300–700 nodes each.
- Age-based retention on the Session logs: only 212 MB of 2.9 GB is older than a week, so it buys little and
  loses history.

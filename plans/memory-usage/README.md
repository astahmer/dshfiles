# Memory usage: Host resident heap and the on-disk stores

Resume here: **M04** (session-search FTS) for disk, and **M01b** (a sampling heap profile started at boot, after the user's restart) for RAM. M01 already ruled the corpus and the stores out: a scratch Host with the identical corpus, stores and profile held 519 MB after GC against the live 3,156 MB, so ~2.6 GB comes from live runtime activity that a scratch cannot reproduce.

## Context

The live GUI's Host has grown to a resident heap that is close to its own V8 limit, and `~/.dsh` holds 11 GB of stores.
Both were measured on the running instance on 2026-11-08 (Host `pid 44684`, started 12:58, DSH 0.2.1-rc.2, 286 plugins /
230 active, 2,820 Sessions, checkout on `jj:main`), read-only, without restarting anything.

### Measured Host memory (live inspector, read-only)

| Probe                                                                       | Result                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `process.memoryUsage()` as found                                            | heapUsed 3,226 MB / heapTotal 3,486 MB, external 55 MB, rss 2,219 MB   |
| after `HeapProfiler.collectGarbage`                                         | heapUsed **3,151 MB** / heapTotal 3,286 MB, external 53 MB            |
| after 60 s idle, then another full GC                                       | heapUsed 3,152 MB — flat, so this is retention, not allocation churn  |
| V8 heap limit                                                               | 4,144 MB → the live heap sits at **~76 % of the limit**                |
| heap spaces                                                                 | old_space 3,115 MB used, large_object_space 180 MB, new_space 4 MB     |
| sampling heap profile, 60 s window                                          | only 9 MB of *new* allocations: nothing is growing while idle          |

So the problem is 3.1 GB of long-lived objects/strings established earlier (at boot, or by the first Session listing),
not a leak that keeps growing. `external`/`arrayBuffers` are small (55 MB), so this is parsed JS data and strings, not
buffers.

A full heap snapshot was **not** taken on the live Host on purpose: serialising a 3.1 GB heap inside a 4.14 GB limit can
OOM the process, and that process serves every open Session.

### Measured disk (`~/.dsh`, 11 GB)

| Store                          | Size                                                      | Note                                                                    |
| ------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `plugins/session-search`       | **3.8 GB** (`index.sqlite`)                               | FTS index with 1,236,334 session documents + 344,493 conversation documents, and its `_content` tables duplicate the text |
| `sessions/`                    | 2.9 GB                                                    | 2,820 Session logs, zstd JSONL (the corpus the indexes are built from)   |
| `plugins/session-query-sqlite` | 874 MB                                                    | cold-Session query store                                                 |
| `plugins/fff-search`           | 584 MB                                                    | file index                                                              |
| `plugins/usage`                | 356 MB (274 MB db + **82 MB WAL**)                        | WAL far above the 4 MB autocheckpoint: checkpoints are being blocked    |
| `plugins/optmem`               | 334 MB                                                    | unexamined                                                              |
| `storages/session_projcache`   | 317 MB                                                    | projection cache, unexamined                                            |
| `plugins/traces`               | 271 MB (218 MB db + **50 MB WAL**)                        | 99,999 spans / 200,000 metric points retained                           |
| `plugins/memory`               | 120 MB (96 MB db + 6 MB WAL)                              |                                                                          |

Detached leftovers from another thread's e2e run were also found and left alone (bitwarden `clients serve` 93 MB,
`fake-ssh` 30 MB, `secret` keepalive 6 MB); they are processes, not stores.

## Goal

Cut the Host's resident heap and the on-disk store footprint substantially, with no UX loss: same search results, same
history, same panels, same latency. Every change is measured before and after on the same data, lands as one described
revision, and is reversible.

## Non-goals

- No restart of the live Host by an agent; the user restarts.
- No deleting user history, Session logs, attachments, Backlog items or memory digests.
- No weakening of search completeness, retention guarantees or durability to win a number.

## Method

1. Measure on the live Host read-only (inspector `Runtime.evaluate`, `HeapProfiler.collectGarbage`, `heap space`
   statistics) — cheap and safe. A **heap snapshot only on a scratch Host** that holds an isolated copy of the corpus,
   where an OOM costs nothing.
2. Attribute before optimising: name the owner of each GB (a plugin, a core service, or a store), with numbers.
3. Change the owner; bound by construction (caps, external-content FTS, checkpoint policy), not by dropping data.
4. Prove with the same probe on the same corpus; keep the table in [`docs/performance.md`](../../docs/performance.md).

## M01 result (2026-11-08)

| Host                                   | heapUsed after full GC | external | note                                                    |
| -------------------------------------- | ---------------------- | -------- | ------------------------------------------------------- |
| live, 80 min uptime                    | 3,156 MB / 4,144 limit | 96 MB    | flat over 40 min: retention, not churn                  |
| scratch, identical corpus + all stores | 519 MB                 | 53 MB    | same 2,820 Sessions, 6.2 GB plugin stores, same profile |
| scratch, corpus only (no plugin stores) | 293 MB                | 54 MB    | so the stores cost ~226 MB resident                     |
| scratch, after one GUI page load       | 312 MB                 | 86 MB    | the client/sidebar path is cheap                        |
| live, after six thread switches        | 3,168 MB (+13 MB)      | 89 MB    | the switch path is not the owner                        |

A live heap snapshot is not safe: `v8.setFlagsFromString('--max-old-space-size=8192')` does not raise the limit at
runtime (measured), and serialising 3.1 GB inside a 4.14 GB limit can kill every open Session. The safe route is a
sampling heap profile started at boot (heap ~500 MB) and stopped after the workload that grows it — that names the
retaining allocation sites without a snapshot.

## M01b result: the sampling profile named one site (2026-11-08, after the user's restart)

The Host booted at ~500 MB; after a normal workload (one page load, eight thread switches, `thread_list`, `find_threads`,
`traces_list_services`, `usage_report`, `memory_search`, `list_thread_questions`) the heap was 3,045 MB and flat. A
sampling heap profile running across that window reported 1,470 MB of live objects in the top sites, of which
**1,376.6 MB at `@deepseek-ai/dsh-session-persistence-jsonl` `SessionLogScanner.write`** — the session-log restore path.
The rest was noise under 2 MB.

So the retained memory is decoded session-log content held by the native `SessionQueryEngine`'s prepared-session cache
(`preparedSessionCacheSize`, default 5). Each prepared Session holds that Session's whole decoded log, and the biggest
logs here are 283 / 199 / 157 MB uncompressed, so five entries account for the GB. The owned backend can only lower the
entry count: `profiles/web` now sets `preparedSessionCacheSize: 1` (Host gap 102 records the byte-bounded fix that needs
the core engine).

## Work packages

| ID  | Work                                                                                                   | Evidence so far                                                                 |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| M01 | Attribute the 3.15 GB live heap on a scratch Host with an isolated corpus copy (boot heap, then after the first Session listing and sidebar load; snapshot there if it still fits) | Heap is flat when idle; external is only 55 MB; a snapshot on the live Host is unsafe |
| M02 | Bound whatever M01 names (leading hypothesis: the Session list materialising per-Session state for thousands of Sessions — the same class of cost the plugin sweep fixed for titles and question targets) | `session/list` folds every stored log (p50 8.2 s, recorded as Host gap `b:17rs`); 2,820 Sessions |
| M03 | Traces store: lower the retained span/metric window, checkpoint the 50 MB WAL on idle, VACUUM after a trim | 218 MB db + 50 MB WAL, 99,999 spans retained                                    |
| M04 | **Done (archived tier)**: archived Sessions are cold — their documents are dropped and only a targeted search indexes them back. Age is not the cutoff (2,294 of 2,406 logs are within 30 days), but 2,079 of 2,820 Sessions are archived, so the index only needs the hot ~740 | 2,336 MB content + 1,312 MB index for 1,236,466 documents before; the cold prune runs on the next pass |
| M04b | Session-search index 3.8 GB (remaining, optional): the FTS `_content` tables are **not** a duplicate of the `_data` index — 2,336 MB content + 1,312 MB index for 1,236,466 documents is normal FTS sizing. Two real levers: (a) contentless FTS (`content=''`) and read snippets back from the Session log by `(session, seq)`, worth ~2.3 GB, at the cost of a log read per snippet; (b) drop the `conversation_documents` table (344,544 rows, 810 MB) that indexes the same messages a second time, at the cost of the filtered-search fast path its comment describes | `dbstat`: session_documents_content 1,836 MB, session_documents_data 1,002 MB, conversation_documents_content 500 MB, conversation_documents_data 310 MB; 2,817 indexed Sessions vs 2,813 logs, so there is no stale-Session win |
| M05 | Usage store: 82 MB WAL next to a 274 MB db — find the long-lived reader blocking checkpoints, set an explicit checkpoint policy, trim the retention window | WAL is 20× the 4 MB autocheckpoint                                              |
| M06 | `optmem` 334 MB is an **orphan**: `optmem.db` was last written 2026-10-16 and no `plugins/@dshfiles/optmem` package exists any more (only a `optmem-full` profile and a 1.2 MB `optmem.stage3-backfill`). Deleting it is the user's call, not an agent's. `storages/session_projcache` 317 MB is one JSON checkpoint per Session (2,819 files, ~115 KB each) owned by the native projection cache: a derived cache that a cap/eviction policy could bound, but the owner is core, so record it as a Host gap | `file`/`ls` on both stores |
| M06b | M01 measured: the stores cost only ~226 MB resident (519 MB scratch heap with stores vs 293 MB without), so store work is disk-only | scratch boot A/B |
| M07 | **Done**: fff-search records each store's root path (`root.txt`) and prunes stores whose root no longer exists at worker start; 2,099 of 2,152 stores (558 MB) were dead and are gone | 584 MB → 15 MB |
| M08 | `memory` 96 MB + `backlog` 38 MB: retention and VACUUM after pruning                                   | unexamined                                                                      |
| M10 | **Done (demand gate)**: the usage indexer (30 s, 413 s of CPU per 90 min) and agentsview catch-up loop (2-30 s, 167 s per 90 min) now run only while something reads them — a read marks demand for 5 minutes, so a closed panel costs nothing | traces: 164 and 172 passes in 90 min with no panel open |
| M09 | Report the detached process leftovers to the user (never kill another thread's processes)               | 129 MB across three processes                                                   |

## Acceptance

- Host live heap after GC and a full Session listing is materially below today's 3,151 MB, with the same visible
  behaviour (thread switch, sidebar list, search, panels).
- `~/.dsh` is materially smaller, with every Session still searchable and readable.
- No WAL grows past a documented bound; no store loses rows it should keep.
- Each package has a before/after row in `docs/performance.md` and its own focused regression test.

## Decisions log

| Date       | Decision                                                                     | Rationale                                                          |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 2026-11-08 | Measure live read-only; snapshot only on a scratch copy                      | A 3.1 GB snapshot inside a 4.14 GB limit can kill every open Session |
| 2026-11-08 | RAM first, disk second                                                       | The heap is at ~76 % of its limit; disk is large but not fatal      |

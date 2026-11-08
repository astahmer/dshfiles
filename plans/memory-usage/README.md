# Memory usage: Host resident heap and the on-disk stores

Resume here: **M01** (attribute the 3.15 GB live Host heap on a scratch Host, where a crash costs nothing). Everything
else waits on it.

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

## Work packages

| ID  | Work                                                                                                   | Evidence so far                                                                 |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| M01 | Attribute the 3.15 GB live heap on a scratch Host with an isolated corpus copy (boot heap, then after the first Session listing and sidebar load; snapshot there if it still fits) | Heap is flat when idle; external is only 55 MB; a snapshot on the live Host is unsafe |
| M02 | Bound whatever M01 names (leading hypothesis: the Session list materialising per-Session state for thousands of Sessions — the same class of cost the plugin sweep fixed for titles and question targets) | `session/list` folds every stored log (p50 8.2 s, recorded as Host gap `b:17rs`); 2,820 Sessions |
| M03 | Traces store: lower the retained span/metric window, checkpoint the 50 MB WAL on idle, VACUUM after a trim | 218 MB db + 50 MB WAL, 99,999 spans retained                                    |
| M04 | Session-search index: 3.8 GB for a 2.9 GB corpus — external-content FTS instead of duplicated `_content`, drop documents of deleted/archived Sessions, cap per-Session documents | 1,236,334 + 344,493 documents; index is 1.3× the corpus it indexes              |
| M05 | Usage store: 82 MB WAL next to a 274 MB db — find the long-lived reader blocking checkpoints, set an explicit checkpoint policy, trim the retention window | WAL is 20× the 4 MB autocheckpoint                                              |
| M06 | `optmem` 334 MB and `storages/session_projcache` 317 MB: what they hold, whether it is derivable and prunable | unexamined                                                                      |
| M07 | `fff-search` 584 MB index: prune roots that no longer exist, bound the per-root file list               | unexamined                                                                      |
| M08 | `memory` 96 MB + `backlog` 38 MB: retention and VACUUM after pruning                                   | unexamined                                                                      |
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

# Native-waste fixes

Resume here: run the P0 measurement first — nothing else is worth doing until the 2.82 GB live heap is attributed to an
owner. Every item below names the measured cost, the native package that owns it, the delta a vendor fork would make,
and the check that proves it. Fork procedure and the manifest rules are in
[native plugin overrides](../native-plugin-overrides.md) and [native forks](../native-forks.md); the first item done
this way is [`@dshfiles/agent-loop`](../../plugins/@dshfiles/agent-loop/README.md).

| Item                   | State              | Owner                                               | Cost                                                                            | Next step                                                                         |
| ---------------------- | ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| P0 heap copies         | Investigating      | unknown (native session/store + our client fan-out) | 2.82 GB live heap; 12.2 M strings / 2.03 GB for a corpus of 10 k events / 47 MB | Take one snapshot, walk retainer chains to the owning array, then pick the fix    |
| P1 request headers     | Investigating      | native writer of `request/header`                   | 8.87 MB in one Session (34 events × ~260 KB, 455-tool catalog each time)        | Find writer + readers; store the catalog once per Session behind the same readers |
| P2 session list        | Blocked on restart | native `session-query` reconcile                    | live p50 8.7 s / p95 10 s (6 samples)                                           | Instrumented spans already landed; attribute after the Host restart               |
| P3 browser tab         | Partly shipped     | owned session-controller client fork                | 3.3 GB in one renderer                                                          | Per-thread LRU below the resident-instance limit; measure after refresh           |
| P4 storage list paging | Open               | `dshx` `plugin-storage.list`                        | 20 ms / 7 500 keys, 15 pages per read                                           | Index or point read, only if a real caller needs it                               |
| P5 Effect duplication  | Open               | `dshx` client build                                 | +166 KB gzip for the tested supplier + 2 consumers                              | Full-profile counterfactual before any change                                     |
| P6 mark batches        | Open               | `diff-viewed` + storage                             | one file toggle ~16 ms at 7 k marks                                             | Only with a real batch workload; the confirmed-prefix failure is b:2ksz           |

## P0 — attribute the 2.82 GB, then bound the copies

Facts: a restarted Host with six attached clients reaches 2.82 GB `heapUsed` after `HeapProfiler.collectGarbage`; the
snapshot holds 12.2 M string nodes over 3.06 M distinct values, and the thread's eleven live Session logs are only
**10 081 events / 47 MB** of JSON. Ten thousand events cannot produce two gigabytes unless they are held **6–10× over**,
so the hypothesis is copies: per-client fan-out, per-projection snapshots, per-attempt frames.

1. Snapshot again (`HeapProfiler.takeHeapSnapshot`, streamed to disk — the 2 GB join failed on string length, so stream
   it), then walk parents by edge index to group strings by **rooting chain**, not by constructor. The scripts are
   throwaway; rewrite them under `/tmp` from the recipe in [RAM usage](../ram-usage.md#what-the-memory-is).
2. Name the array or map that holds them. Expected candidates, in order: a per-client event buffer in the owned
   `session-controller` fork (`follow`/control queues), a session projection snapshot per client, the raw chunk list the
   loop keeps while streaming.
3. Fix at that owner only:
   - owned plugin → bound it in place (bytes budget + drop-after-settle), with a test that asserts the bound;
   - native package → vendor fork with the smallest delta, one row swap, a recorded `native-fork.json`, and a
     behaviour test like `tests/agent-loop.integration.test.ts`.
4. Prove it: same workload, 110 s settle, `heapUsed` after forced GC, before/after in
   [RAM usage](../ram-usage.md). Target ≤ 1.5 GB.

Gate: no fix ships until the retainer is named. A guess here costs another day.

## P1 — store the tool catalog once per Session

`request/header` is the largest event type in a real log: 8.87 MB of a 19 MB Session, ~260 KB per event, almost all of it
the 455-tool catalog, repeated for every request group.

1. Locate the writer in the installed `@deepseek-ai/dsh-*` packages and list every reader (projections, history paging,
   Requests/Trajectory views, repair/replay, export).
2. If the readers can resolve "the catalog in force for this request" from a Session-level record, fork the writer and
   store `{ catalogRef }` instead of the catalog, keeping one catalog event per change.
3. Test: replay a Session, page its history, export it, and open the Requests view; all must render identical tool lists.
   Also assert the on-disk log shrinks and an older log still parses.

Risk: history/export readers that assume the payload is inline; solve with a fallback reader in the same fork.

## P2 — session list attribution

Instrumented spans are already on `main` (`jj:usllsyzy`, tests `jj:nytvtqqr`), and the live Host has not restarted with
them. After a restart: read `session list read` spans, separate `corpus_cache` hit/shared/miss from `session corpus read`
cost, and only then choose between a narrowed cold read, a bounded query, or a native `session-query` fork. Scratch
600-session JSONL measurement (`initial 110 ms`, `warm 3.6 ms`, `after attach 74 ms`, `after detach 61 ms`) is the
baseline for any cache change, not proof of the live 8 s.

## P3 — browser per-thread bound

Shipped: history projections stay for the last 3 viewed Sessions, and an unsubscribed Session instance is released past
4 (`jj:zrstxszz`). Remaining: the window of still-mounted or recently viewed threads. Fix inside the same owned fork,
measure with the same settle + forced-GC protocol, target ≤ 1.5 GB for the tab.

## P4–P6 — only with a caller

Each of these is measured but unproven as a user-visible cost: `pluginStorage.list` paging (P4), Effect in every client
bundle (P5), and `diff-viewed` batch writes (P6). They stay open until a real workload shows the cost; the decision rule
and current evidence are in [backlog-improvement-sweep](../backlog-improvement-sweep/README.md).

## Order

P0 → (owner fix) → P1 → P3 → P2 → P4–P6. P0 and P1 are the only ones with a measured multi-megabyte target today; P3 is
the only one whose owner we already control end to end.

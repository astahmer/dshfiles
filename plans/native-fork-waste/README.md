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

Measured on the decompressed log of `session-6b9ec57a` (19.39 MB, zstd 5.43 MB): **34 `request/header` events = 9.30 MB
= 48 % of the log**; reasons `initial` 1, `resume` 1, `change` 1, **`series` 31**; the `tools` JSON is 9.29 MB of those
bytes; every one of the 34 catalogs is **byte-identical** (455 tools). About 8.5 MB is pure repetition.

Writer: `buildRequest` in the vendored [`agent.ts`](../../plugins/@dshfiles/agent-loop/src/native/agent.ts) (installed
`lib/index.js:1217-1240`). It emits `initial`/`resume` once, `change` only when `headerEquals` fails, and `series` on
every request-series start **with the unchanged full header** — that is the repetition.

No reader wants a per-group catalog: `dsh-session` keeps tools per header seq for `headerSeq` lookups and resets on
`series`; `tool-history` feeds `requestHeader()` and `dsh-llm`'s tool-update projection; the timed ask-user question and
token-meter recompute from the latest tools. The browser receives the **full** copy (`history.ts:610`; our
[`browser-event.ts`](../../plugins/@dshfiles/session-controller/src/browser-event.ts) strips only assistant replay),
where conversation and trajectory diff it with `JSON.stringify` and chat reads only `reason`/`startsSeries`.

Ranked options:

1. **Storage dedupe, no reader change.** Fork `@deepseek-ai/dsh-session-persistence-jsonl` (844 KB, row not yet
   overridden): write the catalog once per Session plus a per-event reference, rehydrate inline on read. Every reader and
   the browser stay untouched, the log loses ~8.5 MB of 19.4 MB. Risk: `session-log-download` (profile row 245) and
   older harnesses must not read the new artifact.
2. **Browser-boundary strip for `series` only.** Our session-controller fork can drop the repeated catalog from `series`
   events; needs client fallbacks in the forked chat/conversation plus a new trajectory fork. Cuts traffic and client
   RAM, log unchanged.
3. **Format v5 catalog reference.** Writer plus a `dsh-session` fork (408 K, 30 importers, no Loader row, and the
   ref shape forces `SESSION_FORMAT_VERSION` 5), migrations and trajectory. Biggest win, worst replay/export risk.

Plan: option 1 first, option 2 second, option 3 only if the first two leave a measured gap. Confirming metric: header
bytes ÷ log bytes (now 48 %, distinct catalog arrays = 1) on a regenerated Session, plus page-open bytes and client heap.

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

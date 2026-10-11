# OptMem — Stage 2 benchmarks

`pnpm --dir plugins/@dshfiles/optmem-sqlite bench` (`bench/run.ts`), run 2026-10-09 with
`fnm exec --using=22.23.3 node --no-warnings bench/run.ts 10000 100000` on darwin/arm64.

Dataset: synthetic, deterministic PRNG. 4 projects × 5 conversations, user/assistant turns of
8–48 words, 5 % tool results of ~300 words. Those are larger than 512 B, so they need a leaf summary.
Every event goes to its conversation stream and its project stream.

Summarizer: the fake instant summarizer from the tests. The numbers measure engine and SQLite overhead
only, with no model latency.

| metric                           | 10,000            | 100,000             |
| -------------------------------- | ----------------- | ------------------- |
| append (store, 1 event/tx)       | 15,174 ev/s       | 11,536 ev/s         |
| build tree+views from scratch    | 1.8 s             | 24.9 s              |
| summarizer calls / clips         | 13,583 / 0        | 139,076 / 0         |
| merge-batch line merges          | 9,802             | 196,647             |
| steady append+drain p50 / p95    | 1.84 ms / 6.97 ms | 2.00 ms / 8.70 ms   |
| search p50 / p95                 | 2.12 ms / 2.99 ms | 19.18 ms / 37.47 ms |
| zoom p50 / p95                   | 0.01 ms / 0.05 ms | 0.01 ms / 0.05 ms   |
| context p50 / p95                | 0.02 ms / 0.03 ms | 0.02 ms / 0.04 ms   |
| snapshot p50 / p95               | 0.32 ms / 0.40 ms | 0.34 ms / 0.45 ms   |
| project view bytes (max) / lines | 124,587 / 400     | 125,759 / 395       |
| database file                    | 29.5 MB           | 247.3 MB            |
| process RSS                      | 220.9 MB          | 168.0 MB            |

## Reading the numbers

- **Build from scratch** is the recovery or backfill path: `start()` over an existing event log with no
  nodes. It builds every leaf and parent and then the views. At 100k events that is about 400k nodes
  across 24 streams. The cost is dominated by one autocommit per `saveNode`, so it is I/O bound. A real
  model call takes 10²–10³× longer than a save, which makes this overhead negligible next to
  summarization.
- **Steady append+drain** is one event appended and fully processed: leaf, parents, view tail-append
  and an occasional merge batch. The p95 is the merge batch plus the ~128 KB view rewrite.
- **Search** p50 mixes a common-word query (thousands of matches in scope) with a one-off
  `unique-N` query. Ranking happens before `snippet()`; snippeting every match first cost about 250 ms
  at 10k.
- The view stays in the 64–128 KB sawtooth at both sizes (≈ 400 lines). The snapshot cost does not
  depend on history size.
- Summarizer calls ≈ 5 % of events (oversized leaves) plus every internal node whose children no longer
  concatenate within 512 B. That is the model-call budget to expect per stream.

## Fixes the benchmark forced

1. `planMergeBatch` rescanned every pair for every merge, which is O(V²) with string-key lookups.
   It is now a heap plus a linked list in O(V log V). A test checks it against the naive scan.
2. FTS: `snippet()` ran over all matches before `LIMIT`. Search now ranks first and snippets the
   survivors. `node:sqlite` binds JS numbers as REAL, which an FTS5 `rowid = ?` constraint silently
   ignores, so the query now uses `CAST(? AS INTEGER)`.
3. `PRAGMA cache_size = -32768` (32 MB). The default 2 MB page cache thrashed on the 250 MB database.
4. The view runner waits one macrotask before it runs, so a burst of finished leaves lands in one view
   commit instead of one ~128 KB rewrite per leaf.

Not measured yet: cache-read %, prompt size per turn, real-model compaction cost. These belong to
Stage 3/5 on DSH.

## Compat vs full mode, live (Stage 4, 2026-10-09)

Same 4 prompts, fork Host, `codex-emialex/gpt-6-luna` effort low (see runtime-evidence.md Stage 4). Input = total −
output tokens from `assistant/message.usage`; cache = `cacheReadTokens`.

| Conv/turn/step | full input | full cache | compat input | compat cache |
| -------------- | ---------- | ---------- | ------------ | ------------ |
| A 1/1          | 11,109     | 0 %        | 11,014       | 0 %          |
| A 2/1          | 11,165     | 96 %       | 11,073       | 97 %         |
| A 2/2          | 11,447     | 94 %       | 11,373       | 95 %         |
| A 3/1          | 11,398     | 94 %       | 11,402       | 94 %         |
| B 1/1          | 11,457     | 0 %        | 11,179       | 0 %          |
| B 1/2          | 11,795     | 91 %       | 11,516       | 93 %         |

Reading: ~10.7k tokens are the stable system prompt + tool schemas, cached identically in both modes (the provider
cache key is per session, so a new conversation starts cold). With three short turns the raw history is smaller than
the view header, so full mode costs ~50–300 tokens more per request; at A 3/1 they meet (full sends 6 messages vs 11).
Full mode's benefit — per-request history bounded by the view instead of the whole conversation — needs long
conversations to show; not measured yet (Stage 5).

## Long conversation: stock vs compat vs full (Stage 5 S1, 2026-10-09)

`scenario-long.json` (24 turns of build-up with code, an obscure fact, a 2.5 KB paste, tool use and recall, then a
2-turn conversation B in a new session), `codex-emialex/gpt-6-luna` effort low, isolated scratch home per run (memory
starts empty). stock = published core (no fork) + OptMem compat; compat = fork core + compat; full = fork core + full.
Per-turn input sums every step of the turn (`inputTokens + cacheReadTokens`). Run JSONs stay in `/tmp`.

## /tmp/optmem-stock.json (compat)

| session | turn | input tok (incl. cache) | cache read | msgs orig→sent | bytes orig→sent | end       |
| ------- | ---- | ----------------------- | ---------- | -------------- | --------------- | --------- |
| 732a87  | 1    | 5690                    | 0          | -              | -               | completed |
| 732a87  | 2    | 5749                    | 0          | -              | -               | completed |
| 732a87  | 3    | 5802                    | 0          | -              | -               | completed |
| 732a87  | 4    | 11948                   | 11264      | -              | -               | completed |
| 732a87  | 5    | 6248                    | 5632       | -              | -               | completed |
| 732a87  | 6    | 12855                   | 11264      | -              | -               | completed |
| 732a87  | 7    | 6767                    | 5632       | -              | -               | completed |
| 732a87  | 8    | 6819                    | 4608       | -              | -               | completed |
| 732a87  | 9    | 6870                    | 6656       | -              | -               | completed |
| 732a87  | 10   | 36592                   | 32256      | -              | -               | completed |
| 732a87  | 11   | 8866                    | 7680       | -              | -               | completed |
| 732a87  | 12   | 8907                    | 6656       | -              | -               | completed |
| 732a87  | 13   | 38082                   | 32768      | -              | -               | completed |
| 732a87  | 14   | 10070                   | 9728       | -              | -               | completed |
| 732a87  | 15   | 10151                   | 8704       | -              | -               | completed |
| 732a87  | 16   | 10194                   | 9728       | -              | -               | completed |
| 732a87  | 17   | 31431                   | 28160      | -              | -               | completed |
| 732a87  | 18   | 10890                   | 9728       | -              | -               | completed |
| 732a87  | 19   | 10930                   | 10752      | -              | -               | completed |
| 732a87  | 20   | 34339                   | 30208      | -              | -               | completed |
| 732a87  | 21   | 12004                   | 10752      | -              | -               | completed |
| 732a87  | 22   | 12063                   | 10752      | -              | -               | completed |
| 732a87  | 23   | 24645                   | 23552      | -              | -               | completed |
| 732a87  | 24   | 25407                   | 23552      | -              | -               | completed |
| 863f72  | 1    | 15839                   | 7680       | -              | -               | completed |
| 863f72  | 2    | 18463                   | 15360      | -              | -               | completed |

total input 387621, cache read 323072 (83.3%), output 3750

## /tmp/optmem-compat.json (compat)

| session | turn | input tok (incl. cache) | cache read | msgs orig→sent | bytes orig→sent | end       |
| ------- | ---- | ----------------------- | ---------- | -------------- | --------------- | --------- |
| 5a145a  | 1    | 5690                    | 0          | -              | -               | completed |
| 5a145a  | 2    | 5740                    | 4608       | -              | -               | completed |
| 5a145a  | 3    | 5793                    | 5632       | -              | -               | completed |
| 5a145a  | 4    | 5850                    | 5632       | -              | -               | completed |
| 5a145a  | 5    | 6011                    | 5632       | -              | -               | completed |
| 5a145a  | 6    | 6066                    | 0          | -              | -               | completed |
| 5a145a  | 7    | 6287                    | 5632       | -              | -               | completed |
| 5a145a  | 8    | 6339                    | 5632       | -              | -               | completed |
| 5a145a  | 9    | 6390                    | 5632       | -              | -               | completed |
| 5a145a  | 10   | 6550                    | 5632       | -              | -               | completed |
| 5a145a  | 11   | 7272                    | 5632       | -              | -               | completed |
| 5a145a  | 12   | 7313                    | 6656       | -              | -               | completed |
| 5a145a  | 13   | 7360                    | 6656       | -              | -               | completed |
| 5a145a  | 14   | 7559                    | 6656       | -              | -               | completed |
| 5a145a  | 15   | 7654                    | 6656       | -              | -               | completed |
| 5a145a  | 16   | 7699                    | 6656       | -              | -               | completed |
| 5a145a  | 17   | 7847                    | 5632       | -              | -               | completed |
| 5a145a  | 18   | 8048                    | 7680       | -              | -               | completed |
| 5a145a  | 19   | 8089                    | 7680       | -              | -               | completed |
| 5a145a  | 20   | 8143                    | 6656       | -              | -               | completed |
| 5a145a  | 21   | 8344                    | 7680       | -              | -               | completed |
| 5a145a  | 22   | 8403                    | 7680       | -              | -               | completed |
| 5a145a  | 23   | 26038                   | 23040      | -              | -               | completed |
| 5a145a  | 24   | 8952                    | 7680       | -              | -               | completed |
| b03987  | 1    | 6738                    | 0          | -              | -               | completed |
| b03987  | 2    | 6789                    | 3584       | -              | -               | completed |

total input 202964, cache read 160256 (79.0%), output 2008

## /tmp/optmem-full.json (full)

| session | turn | input tok (incl. cache) | cache read | msgs orig→sent       | bytes orig→sent                                 | end       |
| ------- | ---- | ----------------------- | ---------- | -------------------- | ----------------------------------------------- | --------- |
| e57906  | 1    | 5785                    | 0          | 3→4                  | 7620→8209                                       | completed |
| e57906  | 2    | 5846                    | 5632       | 5→4                  | 8555→8439                                       | completed |
| e57906  | 3    | 5901                    | 5632       | 7→4                  | 9440→8634                                       | completed |
| e57906  | 4    | 5961                    | 0          | 9→4                  | 10352→8856                                      | completed |
| e57906  | 5    | 6133                    | 5632       | 11→4                 | 11692→9518                                      | completed |
| e57906  | 6    | 6191                    | 5632       | 13→4                 | 12607→9743                                      | completed |
| e57906  | 7    | 6311                    | 5632       | 15→4                 | 14171→10228                                     | completed |
| e57906  | 8    | 6366                    | 5632       | 17→4                 | 15047→10416                                     | completed |
| e57906  | 9    | 6421                    | 5632       | 19→4                 | 15939→10620                                     | completed |
| e57906  | 10   | 26489                   | 16896      | 21→4 23→6 25→8 27→10 | 17591→11254 18537→12200 19587→13250 20536→14199 | completed |
| e57906  | 11   | 7379                    | 5632       | 29→4                 | 24569→14794                                     | completed |
| e57906  | 12   | 6864                    | 5632       | 31→4                 | 25416→12440                                     | completed |
| e57906  | 13   | 6917                    | 6656       | 33→4                 | 26325→12661                                     | completed |
| e57906  | 14   | 7068                    | 5632       | 35→4                 | 27542→13206                                     | completed |
| e57906  | 15   | 7172                    | 6656       | 37→4                 | 28686→13662                                     | completed |
| e57906  | 16   | 7221                    | 6656       | 39→4                 | 29546→13834                                     | completed |
| e57906  | 17   | 7384                    | 5632       | 41→4                 | 30837→14443                                     | completed |
| e57906  | 18   | 7577                    | 6656       | 43→4                 | 32375→15155                                     | completed |
| e57906  | 19   | 7518                    | 6656       | 45→4                 | 33223→14931                                     | completed |
| e57906  | 20   | 15202                   | 13312      | 47→4 49→6            | 34071→15091 35111→16131                         | completed |
| e57906  | 21   | 7733                    | 6656       | 51→4                 | 36545→15658                                     | completed |
| e57906  | 22   | 7791                    | 6656       | 53→4                 | 37451→15876                                     | completed |
| e57906  | 23   | 15912                   | 13312      | 55→4 57→6            | 38339→16076 39961→17698                         | completed |
| e57906  | 24   | 8103                    | 7680       | 59→4                 | 40864→16989                                     | completed |
| d8224e  | 1    | 25279                   | 18944      | 3→4 5→6 7→8          | 7658→17188 9110→18640 11971→21501               | completed |
| d8224e  | 2    | 8410                    | 7680       | 9→4                  | 12844→18179                                     | completed |

total input 234934, cache read 186368 (79.3%), output 2070

True no-OptMem baseline (stock core, `enabled: false` under `dshfiles-optmem.config` in a scratch copy of
`drive.mjs`): total input 349,526, cache read 285,696 (81.7 %), output 4,241; single-step turns grow 5,690 (t1) →
12,231 (t22) → 12,397 (t24).

### Reading

- **Totals are dominated by agent behaviour, not memory.** On the stock core the model used workspace tools on the
  code turns (t4 write, t6 read, t10 glob/grep/read/edit ×5 steps, t13, t17, t20, t24 write), so both stock rows carry
  multi-step turns and a history with tool results; on the fork core (compat and full) it mostly answered inline.
  Totals: stock 387,621 / baseline 349,526 / compat 202,964 / full 234,934 — compare per step, not per run.
- **Per-step growth (single-step turns, t1 → t22/t24):** baseline 5.7k → 12.2k → 12.4k, stock 5.7k → 12.1k, compat
  5.7k → 8.4k → 9.0k, full 5.8k → 7.8k → 8.1k. ~5.6k is system prompt + tool schemas. Full stays nearly flat
  (+2.3k over 24 turns, mostly the growing view); compat grows with raw history plus the injected view.
- **Full-mode request bytes:** original history 7.6 KB (t1) → 40.9 KB (t24); sent 8.2 KB → 17.0 KB (−58 % at t24).
  Per-turn the message count stays at 4 (system + contexts + view + current turn) instead of 3 → 59. In tokens the
  saving at t24 is 8,103 vs compat 8,952 (−9 %) because the fixed system/tool block dominates at this length.
- **Cache-read %:** stock 83.3, baseline 81.7, compat 79.0, full 79.3. Full mode keeps the prefix cacheable (system +
  view are stable between view versions); misses appear when the view version changes (t4) and at new sessions.
  Full-mode B t1 is expensive (25.3k over 3 steps) because the first step of a new session is cold and it then called
  memory_search + memory_context.
- **Recall (t21 codename+on-call, t22 data file+threshold, t23 memory_search citation, t24 README, B1 codename/file/
  error code, B2 on-call):**
  - stock: 6/6 correct; t23 and B1/B2 used memory_search; t24 wrote the README to a file (write tool) instead of
    printing it.
  - compat: 5/6 — t21–t24 correct (t23 memory_search + memory_context); **B1 partial**: codename and file right,
    error code answered "Not in persistent memory" without calling a tool (the compat view did not carry
    `KV_TOO_LARGE`); B2 correct.
  - full: 6/6 correct; t23 memory_search, B1 memory_search + memory_context found `KV_TOO_LARGE`, B2 from the view.
  - baseline: t21, t22, t24 correct from raw history; t23 could not cite (tool reports OptMem disabled); B1/B2 failed
    ("persistent memory is unavailable") — cross-session recall exists only with OptMem.

## Re-run after Stage 5 hardening (2026-10-09)

Same command and dataset, after the compact view (Stage 3), full mode (Stage 4) and the S5 fixes.
Machine was busy (49 % CPU for the bench process, other DSH hosts running), so wall-clock rows are
noisier than the first run.

| metric                           | 10,000             | 100,000              |
| -------------------------------- | ------------------ | -------------------- |
| append (store, 1 event/tx)       | 4,840 ev/s         | 5,972 ev/s           |
| build tree+views from scratch    | 5.5 s              | 97.5 s               |
| summarizer calls / clips         | 13,583 / 0         | 139,172 / 0          |
| merge-batch line merges          | 29,606             | 396,463              |
| steady append+drain p50 / p95    | 4.24 ms / 13.96 ms | 5.41 ms / 19.92 ms   |
| search p50 / p95                 | 3.02 ms / 5.51 ms  | 46.14 ms / 292.14 ms |
| zoom p50 / p95                   | 0.04 ms / 0.29 ms  | 0.03 ms / 0.31 ms    |
| context p50 / p95                | 0.04 ms / 0.19 ms  | 0.26 ms / 0.95 ms    |
| snapshot p50 / p95               | 0.82 ms / 1.11 ms  | 1.15 ms / 2.74 ms    |
| project view bytes (max) / lines | 124,587 / 400      | 124,408 / 395        |
| database file                    | 29.6 MB            | 247.6 MB             |
| process RSS                      | 184.3 MB           | 101.1 MB             |

- Merge-batch line merges roughly double (×3 at 10k): every stream now maintains a `compact` view next
  to `main`, and the compact view (8 KB upper bound) merges far more often. Summarizer calls are unchanged.
- Build-from-scratch and append throughput are 3–4× slower than the first run; the view bytes, file size
  and call counts match, so the gap is mostly load on the machine plus the second view per stream. Re-run
  on an idle machine before treating it as a regression.

## 100k re-run, three passes (2026-10-11)

`fnm exec --using=22.23.3 node --no-warnings bench/run.ts 100000`, three runs back to back, darwin/arm64. Waited
20 minutes for the 1-minute load average to fall under 6; it stayed between 17 and 38. The runs went ahead anyway,
so this is still not a quiet-machine baseline.

| run | 1-min load (start → end) | build from scratch | append        |
| --- | ------------------------ | ------------------ | ------------- |
| 1   | 16.9 → 18.3              | 62.4 s             | 5,072 ev/s    |
| 2   | 18.3 → 16.5              | 70.4 s             | 6,018 ev/s    |
| 3   | 16.5 → 12.9              | 47.2 s             | 6,080 ev/s    |

Median of the three runs, each value taken separately:

| metric                           | 100,000             |
| -------------------------------- | ------------------- |
| append (store, 1 event/tx)       | 6,018 ev/s          |
| build tree+views from scratch    | 62.4 s              |
| summarizer calls / clips         | 139,076 / 0         |
| merge-batch line merges          | 396,457             |
| steady append+drain p50 / p95    | 2.71 ms / 11.33 ms  |
| search p50 / p95                 | 21.94 ms / 36.83 ms |
| zoom p50 / p95                   | 0.01 ms / 0.26 ms   |
| context p50 / p95                | 0.05 ms / 0.61 ms   |
| snapshot p50 / p95               | 0.41 ms / 2.84 ms   |
| project view bytes (max) / lines | 125,759 / 395       |
| database file                    | 247.4 MB            |
| process RSS                      | 374.0 MB            |

- Deterministic counts (summarizer calls, merges, view bytes, file size) match across all three runs.
- Under similar load, the median build time (62.4 s) and search p95 (36.8 ms) beat the 2026-10-09 busy run
  (97.5 s, 292 ms). Search p50 matches the first run (19.2 ms). Run 3 had a search and snapshot p95 spike
  (120 ms, 36 ms), so the median hides some tail noise. RSS varied a lot (255 to 747 MB).

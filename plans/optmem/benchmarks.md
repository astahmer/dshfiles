# OptMem — Stage 2 benchmarks

`pnpm --dir plugins/@dshfiles/optmem-sqlite bench` (`bench/run.ts`), run 2026-10-09 with
`fnm exec --using=22.23.3 node --no-warnings bench/run.ts 10000 100000` on darwin/arm64.

Dataset: synthetic, deterministic PRNG. 4 projects × 5 conversations, user/assistant turns of
8–48 words, 5 % tool results of ~300 words. Those are larger than 512 B, so they need a leaf summary.
Every event goes to its conversation stream and its project stream.

Summarizer: the fake instant summarizer from the tests. The numbers measure engine and SQLite overhead
only, with no model latency.

| metric | 10,000 | 100,000 |
|---|---|---|
| append (store, 1 event/tx) | 15,174 ev/s | 11,536 ev/s |
| build tree+views from scratch | 1.8 s | 24.9 s |
| summarizer calls / clips | 13,583 / 0 | 139,076 / 0 |
| merge-batch line merges | 9,802 | 196,647 |
| steady append+drain p50 / p95 | 1.84 ms / 6.97 ms | 2.00 ms / 8.70 ms |
| search p50 / p95 | 2.12 ms / 2.99 ms | 19.18 ms / 37.47 ms |
| zoom p50 / p95 | 0.01 ms / 0.05 ms | 0.01 ms / 0.05 ms |
| context p50 / p95 | 0.02 ms / 0.03 ms | 0.02 ms / 0.04 ms |
| snapshot p50 / p95 | 0.32 ms / 0.40 ms | 0.34 ms / 0.45 ms |
| project view bytes (max) / lines | 124,587 / 400 | 125,759 / 395 |
| database file | 29.5 MB | 247.3 MB |
| process RSS | 220.9 MB | 168.0 MB |

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
|---|---|---|---|---|
| A 1/1 | 11,109 | 0 % | 11,014 | 0 % |
| A 2/1 | 11,165 | 96 % | 11,073 | 97 % |
| A 2/2 | 11,447 | 94 % | 11,373 | 95 % |
| A 3/1 | 11,398 | 94 % | 11,402 | 94 % |
| B 1/1 | 11,457 | 0 % | 11,179 | 0 % |
| B 1/2 | 11,795 | 91 % | 11,516 | 93 % |

Reading: ~10.7k tokens are the stable system prompt + tool schemas, cached identically in both modes (the provider
cache key is per session, so a new conversation starts cold). With three short turns the raw history is smaller than
the view header, so full mode costs ~50–300 tokens more per request; at A 3/1 they meet (full sends 6 messages vs 11).
Full mode's benefit — per-request history bounded by the view instead of the whole conversation — needs long
conversations to show; not measured yet (Stage 5).

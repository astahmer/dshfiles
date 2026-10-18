# @dshfiles/session-search

Owns the `sessionQuery` search backend for this profile. The stock
`@deepseek-ai/dsh-session-query-sqlite` backend reconciles its derived index **on the read path**, and on every search
it re-materialises every loaded session (clone all events, hash them, rebuild all documents, delete and re-insert
them). Measured on this machine: one content search blocked the Host event loop for **290 s** with a stale index and
still **43.5 s** on a fully warm index, while a plain FTS5 `MATCH` answers in 27-70 ms. That is a design property, not
a tunable, so this plugin replaces the backend and inverts the split.

## How it works

- **Search is a pure read.** `SessionSearchEngine` extends core's exported `SessionQueryEngine` and implements only
  `searchSessions` / `searchEvents`; the inherited reads (list, read, titles, filters, traces, observations) stay
  core's own code. The search methods forward to a worker and never touch the index file from the Host.
- **The worker owns the index.** `src/search-worker.ts` runs in a `worker_thread` with its own SQLite connection: no
  decode, parse, or FTS5 work happens on the Host's thread. Measured: 200 000 documents (~800 MB of text) indexed in a
  worker cost the Host loop a worst gap of 109.5 ms and zero gaps over 250 ms.
- **Ingest is incremental and resumable.** A session log is a container of concatenated, checksummed Zstandard frames
  (one-shot decoding stops at the first frame — measured 208 bytes for a 26 MB log, which is why this plugin decodes
  frame by frame). Each pass stores a per-log cursor and decodes only appended frames, commits per session in bounded
  batches, and resumes after a crash instead of restarting the corpus.
- **Documents are bounded.** Text is capped per event type (conversation 64 KB, tool traffic 8 KB); the untruncated
  text stays in the session log. The giant 49.5 MB log in this corpus holds 157 MB of decoded events in 34 869 events.
- **The profile has one owner.** `cordis.patch.yml` inserts this row and the seed disables the stock
  `session-query-sqlite` row, because one process may own the `sessionQuery` service and each index path.

## Measured

Bench: `pnpm bench:owned` (gated on `OWNED_BENCH=1`; it copies a byte-bounded subset of the newest logs the stock index
also knows into a temporary root, so the live corpus is only read). Runs on 2026-10-18 with the machine already at load
20-40 from other work:

| Signal | Owned backend | Stock backend (same corpus, same day) |
|---|---|---|
| Host event-loop gaps over 250 ms while indexing | **0** (worst gap 171-240 ms) | 24 gaps, worst 290 000 ms |
| Worst external ping round trip | 249-395 ms | 290 490 ms |
| Content search during the build | p50 5-34 ms, p95 25-148 ms | 43 500 ms on a warm index |
| Ingest cost in isolation | 8.7 s for a 49.5 MB log (23 853 documents, ~2 700 docs/s) | — |
| Stock recall (queries whose matches the stock index also held) | **1.0** on every query | 1.0 by definition |

The ingest time above is measured with the machine otherwise idle-ish; under the load 20-40 of that day a first build
takes minutes of wall clock in the worker, which is exactly the point: it is background work the Host never waits on.
The bench deliberately polls at 1 s because the worker is single-threaded: a per-150 ms poll competes with the ingest
it is measuring.

## Development

```sh
pnpm build     # emits dist/index.js (Host) and dist/search-worker.js (worker)
pnpm test      # needs dist/search-worker.js: the worker runs from the built file
pnpm typecheck
```

Two gotchas worth knowing before editing:

- **A Cordis service is proxied.** Fields declared with `#private` are unreachable through the service proxy
  (`Cannot read private member … from an object whose class did not declare it`). Service classes use plain
  underscore-prefixed properties, as core's engines do.
- **Node cannot resolve `.js` specifiers inside a `.ts` module.** The worker therefore runs from the built
  `dist/search-worker.js`; `resolveWorkerEntry` also looks for `../dist/search-worker.js` from the source tree.

## Current limitations

- Session and event **filters are refused** with `SESSION_QUERY_INVALID_FILTER` rather than silently ignored, so a
  caller never gets results that do not match its request. The palette and the `@dshfiles/memory` finder issue no
  filters; add filter translation when a real caller needs it.
- **Live sessions are indexed from their appended log frames.** A live session's newest events become searchable once
  they reach the log; a dedicated live-event feed is not wired yet.
- No embeddings, no ranking changes: the ranking mirrors the stock shape (strongest match per session, shorter
  documents first, newest first) over `bm25`.

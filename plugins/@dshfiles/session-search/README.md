# @dshfiles/session-search

Owns the `sessionQuery` search backend for this profile. The stock
`@deepseek-ai/dsh-session-query-sqlite` backend reconciles its derived index **on the read path**, and on every search
it re-materialises every loaded session (clone all events, hash them, rebuild all documents, delete and re-insert
them). Measured on this machine: one content search blocked the Host event loop for **290 s** with a stale index and
still **43.5 s** on a fully warm index, while a plain FTS5 `MATCH` answers in 27-70 ms. That is a design property, not
a tunable, so this plugin replaces the backend and inverts the split.

The freeze, the baseline and the decisions behind this backend are in [Host loop freezes](docs/host-loop-freezes.md).

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
- **Filters are translated, not dropped.** Core's own `materializeSessionEventResultFilters` validates the clauses and
  this backend maps `type`, `surface`, `seq` and `time` onto SQL predicates applied before ranking. `text` (a literal
  scan over untruncated documents) and the session filters it cannot serve are still refused with
  `SESSION_QUERY_INVALID_FILTER` rather than silently ignored. Both real callers — the palette/session controller and
  the `@dshfiles/memory` finder — send `type: ['user/message', 'assistant/message']` + `surface: ['current']`.
- **The profile has one owner.** One process may own the `sessionQuery` service, and the stock row registers first
  (base bundle), so while it stays enabled it wins and content search silently lands back on the read path that
  freezes the Host. `plugins/@dshfiles/session-search/cordis.patch.yml` therefore disables it inside this bundle, and
  `profiles/web/cordis.patch.yml` repeats that disable **inside the managed region** — an existing profile only
  reconciles that region, so a top-level seed row never reaches it. `session_search_health` reports `ownsService`:
  false plus zero counters when another backend holds the service, and the Host logs the conflict instead of building
  an index nothing reads.

## Measured

Bench: `pnpm bench:owned` (gated on `OWNED_BENCH=1`; it copies a byte-bounded subset of the newest logs the stock index
also knows into a temporary root, so the live corpus is only read). Runs on 2026-10-18 with the machine already at load
20-40 from other work:

| Signal                                                                  | Owned backend                                             | Stock backend (same corpus, same day) |
| ----------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------- |
| Host event-loop gaps over 250 ms while indexing                         | **0** (worst gap 171-240 ms)                              | 24 gaps, worst 290 000 ms             |
| Worst external ping round trip                                          | 249-395 ms                                                | 290 490 ms                            |
| Content search during the build                                         | p50 5-34 ms, p95 25-148 ms                                | 43 500 ms on a warm index             |
| Ingest cost in isolation                                                | 8.7 s for a 49.5 MB log (23 853 documents, ~2 700 docs/s) | —                                     |
| Stock recall (match-level, sampled stock hits asked back by session id) | **1.0** (15/15, 15/15, 15/15, 3/3)                        | 1.0 by definition                     |

The ingest time above is measured with the machine otherwise idle-ish; under the load 20-40 of that day a first build
takes minutes of wall clock in the worker, which is exactly the point: it is background work the Host never waits on.
One 300 MB round at load 20-27 recorded two Host gaps of ~306 ms and search p50 236 ms while the worker was saturated,
so the 250 ms budget holds on quiet rounds and is only marginally exceeded under extreme load.
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

- Refused filters are `text` event predicates and the session filters other than `id`; they raise
  `SESSION_QUERY_INVALID_FILTER` rather than silently returning results that do not match the request. `type`,
  `surface`, `seq` and `time` are served.
- **Live sessions are indexed from their appended log frames.** A committed `session/event` nudges the worker
  (coalesced to 500 ms), so a live session's newest events become searchable once they reach the log, not before.
- No embeddings, no ranking changes: the ranking mirrors the stock shape (strongest match per session, shorter
  documents first, newest first) over `bm25`.

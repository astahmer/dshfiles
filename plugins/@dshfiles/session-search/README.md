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
  worker cost the Host loop a worst gap of 109.5 ms and zero gaps over 250 ms. The connection comes from
  `@dshfiles/sqlite-store` (`SqliteClient`, one serialized connection, WAL and the 32 MB log limit the plugin used to
  set by hand), so `PRAGMA user_version` becomes the store's own `effect_sql_migrations` table and an existing index is
  adopted without rewriting a row.
- **A pass stages outside the transaction and commits a bounded group inside one.** File reads, frame decode and header
  parsing happen before any write; sessions are staged until 64 of them, 250 ms or 8 MiB of document text, then one
  `sql.withTransaction` re-reads each cursor (and the archived set) and writes the whole group. A stale cursor — a
  targeted search or archive change landed while the pass was staging — is skipped instead of overwriting newer state,
  and a failed write rolls back every session in the group.
- **Searches never wait behind a transaction for long.** The single connection serializes, so the group bound is also
  the longest a search can queue: one group of at most 64 sessions or 8 MiB, not a whole pass.
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

## Find in one thread

`sessionQuery.searchEvents` ranks and keeps the best event per Session, which suits a palette but not a find bar that
walks one thread top to bottom. The `findInThread` method of this plugin's `session-search` API (agent tool
`thread_find`, read-only) returns every current-surface event of one Session whose indexed text has all the typed words,
in seq order, with a short snippet:

- Each word is quoted, so punctuation and FTS5 operators stay literal; the last word matches as a prefix, so results
  follow typing. Text with no letter or digit returns nothing.
- The default limit is 200 and the most is 1 000; `hasMore` says when a thread has more.
- An archived Session is indexed for that request, as a targeted search is.
- A match is one event: several hits inside one tool output count once. Core's text extraction leaves model thinking
  out of the index, and tool payloads are capped at 8 KB per event, so neither a thought nor a hit past that cap is
  found.
- `ownsService: false` means another plugin owns `sessionQuery` and this index is not built.

Clients import the contract from `@dshfiles/session-search/search-api`; the Chat find bar is its first caller
([Chat: find in thread](../chat/README.md#find-in-thread)).

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

### Copy-based index check (2026-11-11)

`DatabaseSync` → `@dshfiles/sqlite-store` was proved on a copy, never the live file: a read-only SQLite online backup of
`plugins/session-search/index.sqlite` (346 MiB including its WAL) into private scratch, then a fresh copy per run. The
corpus is 120 frozen session logs (36.3 MiB) the backup already indexed, so each run re-indexes them by replacement
(the copied inode differs), 121 batches and 25,214 documents. Queries are the real `SearchIndex.searchSessions` over
five terms, unfiltered and conversation-filtered, 5 warm-up requests then 10 rounds (100 samples), and every response
digest matched the pre-migration one. Node 22.23.3; the machine carried load 27–37 on 10 CPUs from unrelated work, so
CPU time is reported beside wall time.

| Signal                                  | Before (`DatabaseSync`) | After (`SqliteStore`) |
| --------------------------------------- | ----------------------- | --------------------- |
| Replacement ingest, wall                | 6.39 s                  | 5.92 s                |
| Replacement ingest, process CPU         | 5.11 s                  | 5.42 s                |
| Replacement ingest throughput           | 3,946 docs/s            | 4,259 docs/s          |
| Search p50 / p95                        | 10.7 / 24.7 ms          | 10.0 / 21.7 ms        |
| Search p50 / p95 (second pair, load 36) | 10.4 / 30.5 ms          | 9.9 / 22.6 ms         |
| Response digests over the 10 requests   | baseline                | identical             |

A naive first port — one statement per document and one delete per mapped rowid — cost 3.7× the CPU and 3–7× the wall
time of `DatabaseSync`. The write path now batches 100 documents per `INSERT ... VALUES`, derives contiguous FTS5
rowids from `last_insert_rowid()`, writes the rowid map and conversation rows with multi-row inserts, and deletes a
replaced session's documents in 100-rowid chunks. That is what brings ingest back to parity; the numbers above are that
version.
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

## Archived Sessions are cold

A Session the user archived is dropped from the index: the ingest pass deletes its documents and keeps no cursor, so
archived history costs neither disk nor page cache. A **targeted** search (`sessionIds`) still works — the worker indexes
just those Sessions for that request, which is the slow path back into cold history. Broad searches cover the hot set
only. On this machine 2,079 of 2,820 Sessions were archived, so the index only has to hold the ~740 the user still
works with.

Age is not the cutoff: every log here is younger than 60 days (2,294 of 2,406 within 30 days), so an age window would
prune almost nothing while archived state is the user's own statement about what is cold.

## Projection checkpoints

The Host's projection cache keeps one checkpoint per Session under `storages/session_projcache/sessions/` and is the
zero-I/O source of a cold Session's list metadata and title. Two minutes after boot this plugin removes only orphans
(checkpoints whose Session persistence no longer stores), then runs a one-time rebuild for Sessions whose checkpoint a
former 14-day prune deleted: one cold log of at most 8 MB at a time through the cache's own `coldSnapshot`, two seconds
apart, skipping live Sessions. Progress lives in `plugins/session-search/checkpoint-rebuild.json`, so a restart resumes;
once a pass completes it never runs again. Larger logs get their checkpoint when someone opens them.

## Current limitations

- Refused filters are `text` event predicates and the session filters other than `id`; they raise
  `SESSION_QUERY_INVALID_FILTER` rather than silently returning results that do not match the request. `type`,
  `surface`, `seq` and `time` are served.
- **Live sessions are indexed from their appended log frames.** A committed `session/event` nudges the worker
  (coalesced to 500 ms), so a live session's newest events become searchable once they reach the log, not before.
- No embeddings, no ranking changes: the ranking mirrors the stock shape (strongest match per session, shorter
  documents first, newest first) over `bm25`.

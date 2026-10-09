# OptMem reuse review: Najar ERP agent harness (multi-user, Postgres)

Scope: read-only review of `plugins/@dshfiles/optmem-core`, `optmem-sqlite` and `optmem` (DSH adapter) at the
current revision. Suites pass (core 29, sqlite 32, dsh 28). Paths below are relative to `plugins/@dshfiles/`.
Legend: **OK** already supported · **ADAPT** requires adaptation · **NO** not supported / unknown.

Short verdict: reuse `optmem-core` (tree, views, bounded summaries, snapshot, zoom/context/search). Write a Kysely
`MemoryStore` + `MemorySearch`, an AI SDK `Summarizer`, and do context composition and authorization in the harness.
Two small core changes are needed to avoid hacks: extra target streams per event, and a per-stream resume.
Do not port `optmem` (DSH plugin) beyond copying the summarizer prompt and the capture filtering ideas.

## 1. Multi-user isolation

- **OK** Streams are the isolation unit, and store queries are keyed by stream (`optmem-sqlite/src/sqlite-memory.ts:223-293`).
  An event is stored once and referenced per stream (`stream_entries`, `optmem-sqlite/src/migrations.ts:23-28`).
- **NO (single-user assumptions)**:
  - Ids have no tenant. `StreamId` is `conversation:${string} | project:${string} | 'global'`
    (`optmem-core/src/types.ts:5`). `event_key` is globally `UNIQUE` (`migrations.ts:8`).
  - `global` is one stream for the whole DB, and every caller can read it (`optmem-core/src/scopes.ts:17`).
  - `all-projects` search passes `stream: null`, which searches every event in the DB
    (`scopes.ts:11-12`, `sqlite-memory.ts:375-376`).
  - Events have no author. The leaf text is `${role}: ${text}` (`optmem-core/src/engine.ts:362`), so in a shared
    thread the summarizer cannot tell Alice from Bob unless the text carries the name.
  - `Scopes.canRead` encodes DSH project semantics. A conversation stream is readable when its *first* event's
    `project_id` equals `access.projectId` (`scopes.ts:21`, `sqlite-memory.ts:259-262`).
  - `MemoryAccess` holds one `projectId` (`types.ts:190-194`). It cannot express "member of team X and user U".
  - `snapshot` and `readView` do no access check (`engine.ts:613`, `engine.ts:652`). Only `zoom`, `context` (via
    `assertReadable`, `engine.ts:576-579`) and `search` (via `Scopes.stream`) do. The DSH tool even accepts any
    `conversationId` (`optmem/src/tools.ts:48`) and relies on `assertReadable`.
- **ADAPT, minimum change (no core edit)**:
  - Namespace every id by org: `conversation:<org>:<thread>`, `project:team:<org>:<team>`, `project:user:<org>:<user>`,
    and `eventKey = najar:<org>:<thread>:<messageId>:<partIdx>`.
  - Never expose the `global` or `all-projects` scopes.
  - Do authorization (CASL thread or team membership) in the use case *before* calling the engine. Then build a
    `MemoryAccess` per call with exactly one readable non-thread stream, and call `search` once per scope.
  - Prefix user text with the author's display name at capture time.
  - Keep raw thread events at `projectId: null` (see §2). The first-event heuristic then cannot open a thread to a
    whole team.

## 2. Memory scopes and promotion

- **Today**:
  - `normalizeEvent` computes the streams. Every event gets `conversation:<id>`, plus `project:<id>` when it has a
    project, plus `global` only when `input.global === true` (`optmem-core/src/stream-ids.ts:21-27`,
    `normalize-event.ts:33`).
  - DSH maps a session to a conversation and its cwd/workspace to a project (`optmem/src/runtime.ts:198-236`). It
    never sets `global` (the field appears only in tools).
  - Nothing is auto-promoted, as documented (`design.md` §5).
- **OK** One event in several streams without duplicating content: yes, but only at append time and at most for
  {conversation, one project, global}.
  - Leaf summaries are reused across streams by event id (`engine.ts:367`, `findLeafByEvent`), so a leaf costs one
    LLM call.
  - Parents are per stream (separate trees), so merges are paid per stream.
- **NO** Adding an existing event to another stream later. Re-appending the same `eventKey` is a no-op that returns
  `entries: []` (`sqlite-memory.ts:208-211`). `moveStream` moves a whole stream and deletes the source
  (`sqlite-memory.ts:238-252`), so it is not a promotion primitive.
- **ADAPT** Thread / user / team with explicit promotion:
  - thread = `conversation:` stream, automatic, all finalized messages.
  - team and personal = `project:team:…` / `project:user:…` streams fed **only** by promotion. A promotion appends a
    new `role: 'note'` event (distilled text, its own `eventKey = promo:<org>:<scope>:<id>`, `meta.sourceEventId`)
    with `projectId` set to that scope.
  - This duplicates by design: a promoted note is curated text, not a pointer. That is what you want for team
    memory, because raw shared-thread content should not leak into personal or team trees. Without a core change the
    note also lands in its thread stream (conversation is always added).
  - The "no copy" alternative needs a small core change: an optional `extraStreams` on `MemoryEventInput` plus
    widened `StreamIds.forEvent`, about 10 lines. Its only use is putting the same raw event in thread + user + team
    at ingest time, which Najar should avoid. Recommendation: do not do it in v1.

## 3. Concurrent writes and crash recovery

- **What SQLite assumes**:
  - Positions are allocated as `MAX(pos)+1` inside `BEGIN IMMEDIATE` (`sqlite-memory.ts:175-176`, `189-221`). The
    SQLite write lock serializes all writers, across connections and processes.
  - This is tested: two connections in one process (`optmem-sqlite/src/store.test.ts:40`) and 3 worker threads on
    one file (`store.test.ts:80`).
  - Docs vs code: `design.md` §5/§7 says "serialized per process / single writer connection per process". The code
    is stronger (cross-process via file lock), but the tests never run separate OS processes or two live engines.
- **OK in the interface**:
  - `MemoryStore` is fully async (`types.ts:99-134`). Each method is its own atomic unit, and position allocation is
    the adapter's job inside `appendEvents`.
  - Idempotency is in the contract: `appendEvents` dedupes by `eventKey`, `saveNode` is first-write-wins, and
    `commitView` is a version CAS (`engine.ts:468-473`, `sqlite-memory.ts:307-335`).
  - A Kysely adapter can satisfy all of this with no core change:
    - `stream_heads(stream PK, length)`. In `appendEvents`, `INSERT … ON CONFLICT DO UPDATE SET length = length + 1
      RETURNING length - 1` per stream, with the streams in sorted order to avoid deadlocks, in the same transaction
      as the event insert. That gives gapless positions. Plain `MAX(pos)+1` under READ COMMITTED would collide on
      the PK.
    - `UNIQUE(event_key)`, `ON CONFLICT DO NOTHING`.
    - `commitView`: `UPDATE … WHERE version = $expected`, plus the `leaf` cursor in the same transaction.
    - `readSnapshot`: one REPEATABLE READ transaction or one statement.
    - `moveStream`: throw "unsupported" (DSH-only).
- **ADAPT (search)**: do not port the FTS cursor. `indexPending` reads `id > cursor` (`sqlite-memory.ts:356`). In
  Postgres, concurrent transactions commit bigserial ids out of order, so the cursor permanently skips events. Use a
  generated `tsvector` (or `pg_trgm`) column with a GIN index, make `indexPending` a no-op, and filter by stream
  through `stream_entries` like `sqlite-memory.ts:377-381`. `ftsQuery` is FTS5-specific.
- **NO / ADAPT (engine is single-process)**:
  - Job queues, the `queued` set, the `failed` map, the retry timer, `leafTexts` dedupe, the view cache and barrier
    waiters are all in memory (`engine.ts:247-269`, `299-311`, `537-556`).
  - There is no lease or claim. Every worker's `start()` scans **every stream in the DB** (`engine.ts:581-592`):
    `listStreams` and then 2 queries per stream.
  - Two workers on the same thread are *safe* (first-write-wins nodes, CAS views, and a loser just forgets its cache
    at `engine.ts:470`) but waste LLM calls on duplicate summaries. No test covers two live engines maintaining the
    same view.
  - **Crash gap**: worker A appends, then dies before its leaves are built. Worker B's `snapshot()` only pumps its
    *own* queue and marks the view dirty (`engine.ts:617-621`). It never enqueues A's missing leaves.
  - The result is not data loss: positions past the view render as clipped `[pending summary]` lines
    (`engine.ts:558-559`), with older ones collapsed to a marker past 16 KB (`engine.ts:562-573`).
  - The thread stays degraded until some engine runs `start()`. The barrier also times out, because waiters only
    hear commits made in their own process (`engine.ts:483-489`, `537-556`).
- **Resumable compaction**:
  - OK at the data level: nodes and views are persisted, and `start()` rebuilds from `listMissingLeaves` and
    `listBuildableParents`. Tested in-process: `optmem-sqlite/src/engine.test.ts:195`, `215`.
  - NO at the scheduling level: no durable queue, no per-stream resume. Smallest fix is a ~10-line core addition,
    `resume(stream)` (the body of the `start()` loop for one stream), called before `snapshot` and by a BullMQ
    sweeper. Without it, run a periodic `engine.start()` in one worker, which is fine for low stream counts.
- **Crash during an agent run**:
  - Ingestion is idempotent, so re-ingesting after restart is safe.
  - First write wins (`ON CONFLICT DO NOTHING`), so ingest only **finalized** message parts (AI SDK `onFinish` /
    persisted UI message parts), never streaming partials.
  - The turn boundary (`endPos`) lives in a process map in DSH (`runtime.ts:174`, `332`). Najar must persist it with
    the run.

## 4. Context assembly

- **How it works today (DSH full mode)**: `[system + carried instruction contexts] + [one user message: preamble +
  snapshot(stream).text] + [current turn]` (`optmem/src/runtime.ts:428-498`).
  - `snapshot` = the persisted `main` view rendered byte-for-byte + a pending tail of positions past the view, cut at
    `endPos` (the stream length at turn start) (`engine.ts:613-650`).
  - The stream is the project stream, else the conversation stream (`runtime.ts:464`). That means **one stream**.
  - The view is computed once per turn and reused across steps (`runtime.ts:457-476`).
  - The compat path instead injects the `compact` view, dropping lines that cover only the reading conversation
    (`optmem/src/injection.ts:44-71`).
- **NO** Multi-stream composition does not exist in core. There is no per-stream budget either: `viewUpperBytes`
  and `compactUpperBytes` are engine-wide (`engine.ts:427-428`), and the unit is bytes, not tokens.
- **ADAPT (it composes fine in the harness)**: build the request most-stable-first.
  1. system + tools
  2. team block = `readView(team, 'compact')`, ≤ `compactUpperBytes` (8 KB default)
  3. personal block = `readView(user, 'compact')`, ≤ 8 KB
  4. thread block = `snapshot(thread, endPos = start of raw tail)`, ≤ `viewUpperBytes` + `pendingTailBytes`
     (128 + 16 KB default; lower `viewUpperBytes` to ~32 KB for an ERP)
  5. the last K raw turns + the current turn

  The worst case is the sum of those bounds, so it is bounded but byte-based. Validate it against the model's
  tokenizer.
- **Caching caveats**:
  - The view only grows at its tail until a merge batch rewrites it (`engine.ts:430-473`).
  - That helps automatic prefix caches (OpenAI/DeepSeek). With Anthropic `cache_control`, any change inside a block
    invalidates that block and everything after it, so give each memory block its own message or breakpoint.
  - The team block changes whenever anyone in the team promotes, so it can sit before the thread block only if
    promotions are rare. Otherwise put it after the thread block.
  - The compat "drop lines of this conversation" filter makes the text reader-specific. Do not reuse it for shared
    threads.
- **Privacy**: the run is triggered by one user inside a shared thread, and its answer is visible to all
  participants. Injecting the *invoking* user's personal memory there can leak it. Decide a rule, e.g. personal
  memory only in single-participant threads or behind an explicit toggle.

## 5. Correctness and evidence

- **Tested** (unit/integration, fake summarizer, single process):
  - contiguous positions under 2 connections and 3 worker threads (`store.test.ts:40`, `80`)
  - idempotent re-ingest (`store.test.ts:17`, `optmem/src/optmem.test.ts:41`)
  - bounded summaries: retry, then clip (`optmem-core/src/bounded-summary.test.ts`, `engine.test.ts:59`)
  - deterministic views and merges (`engine.test.ts:84-150`, `view-math.test.ts`)
  - recovery after restart and orphan leaves (`engine.test.ts:195`, `215`)
  - retry backoff and summarizer timeout (`engine.test.ts:268`, `287`)
  - scope rules for project/global/all-projects (`search.test.ts:86-106`)
  - redaction before storage (`search.test.ts:109`)
  - snapshot `endPos` (`engine.test.ts:178`)
  - stable full-mode prefix (`optmem/src/full-mode.test.ts:82`, `142`)
- **Documented / live only**: cache-read %, token savings and recall. These are single runs, and byte-identical
  prefixes at runtime are "tests only" (`runtime-evidence.md:121`).
- **Untested**: two live engines on one stream, separate OS processes, real-model summary quality beyond one run,
  multi-user anything.
- **26-turn benchmark limits** (`benchmarks.md:79-216`, `README.md:42-57`):
  - n = 1 per configuration, one model (gpt-6-luna, effort low), one synthetic script, 66 events.
  - The main view peaked at 9.9 KB (`runtime-evidence.md` S2 table), far below `viewLowerBytes` 64 KB. Full mode
    snapshots the **main** view, so the full-mode 6/6 never exercised hierarchical main-view merges. It tested
    verbatim leaves + a few leaf summaries + the search tools.
  - "stock" (published core + OptMem compat) also scored 6/6. compat scored 5/6: B1 missed `KV_TOO_LARGE` because
    the compact view had dropped it and the model did not search. The baseline's 3/6 is the cross-session items
    only, which it cannot have by construction.
  - In-thread recall was therefore equal everywhere. No summary-plus-tail baseline was run.
  - Full mode used more total tokens than compat (234,934 vs 202,964). Its cache-read % (79.3) is below the
    no-memory baseline (81.7).
  - The defensible claim is flat per-step growth (+2.3k tokens over 24 turns), not better recall.
- **Where OptMem loses or degrades facts**:
  - Normalization truncates the *stored* event middle: tool results over 16 KB, other events over 256 KB
    (`normalize-event.ts:12`). That is unrecoverable even by zoom.
  - Every event over `maxNodeBytes` (512 B) becomes a ≤512 B LLM note (`engine.ts:361-373`).
  - Full mode replaces *all* earlier turns, including the immediately previous answer, so "edit the table you just
    gave me" depends on the model calling `memory_zoom`. Summary-plus-tail keeps that raw, and OptMem is worse
    there. The fix is to keep a raw tail and use `endPos`.
  - Overshooting summaries are hard-clipped after retries (`bounded-summary.ts:42-49`).
  - Pending (unsummarized) lines are clipped to 512 B and collapse beyond 16 KB (`engine.ts:558-573`).
  - Merges compress older history exponentially (2×512 B → 512 B).
  - Backfilled history lands *after* newer events (`runtime.ts:551`), which breaks chronology.
- **Duplication**:
  - In compat mode, view lines that mix several conversations are injected again next to raw history. Only lines
    that cover just the reading conversation are filtered (`injection.ts:55`).
  - In the Najar composition, a promoted note appears in the thread block and the team block.
  - Parents are summarized separately per stream, which is cost duplication, not context duplication.
- **Docs vs code**:
  - `design.md` §6 says compat drops nodes "still present in the live context". The code drops them whether or not
    they are still present (`injection.ts:44-55`).
  - `design.md` §5/§7 understate cross-process write safety (see §3).
  - `runtime-evidence.md` Stage 4 says real summaries in full mode were "not exercised". The Stage 5 S2 section
    later proves 54 LLM nodes, so read the later section.

## 6. Integration recommendation

- **Reuse unchanged**: `optmem-core` (engine, `TreeMath`, `ViewMath`, `Utf8`, `Redaction`, `boundedSummary`,
  `MemoryError`). Its tests are the contract, and the sqlite tests are templates for adapter tests.
- **Adapters to write (Najar-side)**:
  1. `KyselyMemoryStore` + `PostgresMemorySearch`, about 300 lines and 6 tables mirroring `migrations.ts` + `stream_heads`.
     Port `store.test.ts` and `engine.test.ts` against TestContainers Postgres, plus one 2-engine test.
  2. AI SDK `Summarizer`: `generateText` with the prompt from `optmem/src/summarizer.ts:6-22` reworded for an ERP,
     a cheap model, and `maxOutputTokens`. The core already wraps it with a timeout and the byte-bound retry.
  3. Capture: AI SDK finalized messages → `MemoryEventInput`. Author name in the text, tool results bounded, and
     context/system injections skipped (the same idea as `optmem/src/capture.ts:16-20`).
  4. Context builder (§4) and 3 tools (`memory_search`, `memory_zoom`, `memory_context`) whose `MemoryAccess`
     comes from CASL, not from model arguments.
  5. Promotion use case: append a `note` to the team or user stream, with an explicit user action or an agent tool
     that needs confirmation.
- **Ignore (DSH-only)**:
  - the DSH plugin wiring: `optmem/src/host.ts`, `runtime.ts`, `settings.ts`, `cordis.patch.yml`, `dshx.config.ts`
  - the `requestMessages` fork waterfall and the `Capabilities` / `HarnessCapabilities` modes (`capabilities.ts`).
    Najar owns its request, so it is always "full".
  - prompt-context injection cache and `{{` neutralizing (`injection.ts`)
  - path→workspace `moveStream` folding, file-based backfill, the summarizer route resolver
  - the `global` and `all-projects` scopes

## Concrete blockers

1. **No tenant or author in the model.** It must be encoded in ids and text by the adapter (§1). This is not a code
   blocker, but forgetting it leaks across orgs.
2. **Engine has no per-stream resume.** In multi-worker Postgres, a crashed worker's missing leaves are not rebuilt
   until a full-DB `start()` (§3). Needs a ~10-line core `resume(stream)`, or a periodic sweeper as a stopgap.
3. **The SQLite FTS cursor pattern is wrong under Postgres concurrency** (§3). Use a tsvector column instead.
4. **No raw tail in "full" composition.** The previous turn exists only as ≤512 B leaves, so the harness must keep
   the last K turns raw via `endPos`.
5. **`normalizeEvent` is not exported** (`optmem-core/src/index.ts`). That is fine if every process runs an engine.
   It is a one-line core change if API processes should append without owning compaction.

## Minimal integration plan (priority order)

1. Kysely store + Postgres search + migrations. Port the sqlite store/engine tests, and add 2 engines × 1 stream and
   concurrent `appendEvents` from 2 connections.
2. AI SDK summarizer + thread-only capture (finalized messages, author-prefixed, org-namespaced keys). One engine per
   worker process, `start()` at boot.
3. Context builder for the thread only: system → `snapshot(thread, endPos)` → raw last K turns → current turn, with
   `endPos` persisted on the run row. Measure tokens and cache hits against your current summary+tail on real
   threads.
4. Core PR: `resume(stream)` (plus export `normalizeEvent` if needed). Call it before `snapshot`, and from a BullMQ
   sweeper for streams with `view.throughPos < length`.
5. Memory tools with CASL-derived `MemoryAccess`.
6. Explicit promotion → team / personal `note` streams. Inject their `compact` views as separate cache blocks, with
   the personal-memory privacy rule.

## Assumptions to validate before implementing

1. Thread length: do Najar threads routinely exceed ~64 KB of history? If not, the main view never merges and plain
   summary+tail may be enough.
2. Provider caching: which model/provider, and whether it uses automatic prefix caching or `cache_control`. This
   decides the block layout.
3. Finalized-message hook: is there one per message part, and do message ids survive retries? These give stable
   `eventKey`s.
4. Concurrent turns on one thread from two users: what defines "current turn" and `endPos`?
5. Personal memory policy: is it allowed in shared threads, who can promote to the team, and are notes editable or
   deletable? Deletion is unsupported: append-only streams, and no delete in `MemoryStore`.
6. Summarizer cost/latency budget. Summary calls run at about 5 % of events plus merges per stream
   (`benchmarks.md:42-43`).
7. Search language: French/English mixed. Pick the `tsvector` config, or use `pg_trgm`.
8. Data retention / GDPR: user offboarding needs stream deletion, which is not in the interface.

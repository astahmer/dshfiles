# OptMem backlog and recovery

## What the counters mean

OptMem persists each captured event once in `events`, then stores stream entries separately for the conversation tree and its project tree. An event included in both is **two missing-leaf positions but one unique event**. Thus the Settings panel's legacy `pendingSummaries` is not a count of model calls: it mixes in-memory leaf, parent, running and failed jobs and does not describe persisted work that has not been enqueued yet.

The Pipeline view and Host diagnostics now distinguish:

- stored unique events from stream entries;
- missing level-0 nodes per stream from distinct missing events;
- estimated unique oversized events requiring a leaf summary from pending stream positions;
- ready merge pairs, oldest pending event, stored summary nodes and recent throughput.

The leaf-call estimate excludes verbatim-sized events and deduplicates events already represented by a leaf in any stream. It is an estimate, not a promise that one call will succeed. Parent merges are separate work; views can be pending without a new model call. Counts are read from SQLite and can change while the engine is active.

## Stalled project summary pipeline (root cause, measured 2026-10-12)

The big project stream `project:workspace:7ab07f52-…` had 59,407 entries and 6,038 level-0 nodes. Both persisted views sat at `through_pos = 468` for roughly 38 hours while capture continued (821 events in one hour), and no project leaf node was written after 2026-10-11T09:51Z, even though conversation streams kept building.

What was actually wrong, in order of impact:

1. **A contiguous view cannot advance past one failed position.** `maintainView` only appends leaves that continue from `view.throughPos`, so a single leaf that never gets a node freezes the whole view. Position 468 (event 611, a 1,858-byte `tool_result`) had never been built while its neighbours 466, 467 and 469–6,157 existed. The cost was not one node: **filling that one hole advanced the view from 468 to 1,238 using nodes that already existed** — about 770 events of already-summarized memory were hidden from prompt injection behind a single missing leaf.
2. **Recovery ran only in `start()`.** Missing leaves were enumerated once, at engine start. A long-lived process therefore never re-scanned: backlog created after boot (backfill, stream move, or a provider outage) was never enqueued, and `append()` only queued the entries it was handed. Measured: zero project nodes per hour for 38 hours in a running process.
3. **No per-stream fairness.** `start()` pushed every missing leaf of every stream into one global FIFO — 94,984 positions on this database. Streams were served in enqueue order, so a stream whose jobs fail slowly at the back of a 94k queue can be starved indefinitely, and there was no ceiling on how much one stream could queue.
4. **Retry amplification.** `retryFailed()` was called on every `append()` _and_ on every barrier `snapshot()`. While one stream was stuck, each turn and each capture batch re-submitted thousands of already-failed model calls. A controlled reproduction with an always-failing summarizer produced **208,945 model calls for 21,066 oversized leaves** — roughly 10× amplification.

This was **not** a structural throughput problem. Running the same engine against a copy of the live database with a working summarizer drained all 53,028 missing project leaves in under a second (40,323 model calls). The stall was the four defects above, and its visible symptom was `health: degraded` with `0.0` summary nodes per minute.

## Fixes

- **Poisoned positions can no longer freeze a view.** Once a leaf or an internal node is explicitly non-retryable, or has burned `leafFallbackAfterAttempts` attempts, it is materialized from clipped head _and_ tail text and marked `model: 'unsummarized'`. The event is preserved, provenance is kept (`event_id` set for leaves), the tree continues, and the view is never blocked by one bad position again.
- **Bounded continuous recovery.** The engine now runs a periodic catch-up sweep (`catchUpIntervalMs`, default 15 s) that re-scans every stream for missing leaves and buildable parents and queues at most `catchUpBatchPerStream` per stream per sweep. Backlog that appears after boot is discovered without a restart, and no single sweep can dump a whole backlog into memory.
- **Per-stream fair scheduling.** Jobs live in per-stream queues served round-robin, with `maxQueuedPerStream` as a ceiling, so a large or failing stream cannot starve the others.
- **Retry hygiene.** The blanket `retryFailed()` calls on append and on the turn barrier are gone; retries are owned by the backoff timer and the catch-up sweep.
- **Cost controls.** `summaryCallsPerMinute` (default 60) caps model calls across all streams, and merges stop retrying after the first overshoot because two at-ceiling nodes cannot be fused by asking again with a slightly tighter budget. The measured cost audit attributed 53.7 % of remaining calls to exactly that retry loop.

## Diagnosed output-budget failure

For a 512-byte summary node the previous DSH adapter fixed `maxTokens` at 1,024. DSH reports exhausted output as `finish.kind === 'max-tokens'`; a response with no text was treated as an empty-summary error. The byte-size retry therefore could not help when the model needed a larger output token budget: it repeated the same capped request and left the leaf missing.

The adapter now requests a bounded output budget derived from node size (`max(2,048, maxBytes × 4)`, capped at 16,384), then makes at most one retry at twice that budget when DSH explicitly reports output-budget exhaustion. Repeated exhaustion is surfaced as a non-retryable `OutputBudgetError`. That error no longer parks a job forever: it now triggers the clipped-text fallback, so the position is filled and the view advances. There is no historical per-request `max-tokens` telemetry in the live database, so this remains a code-proven failure mode rather than a measured share of the backlog.

## Operator recovery

`MemoryEngine.retryFailures()` still re-enqueues every retained failed job and is invoked when summaries are resumed after a pause. It is no longer the only way out of a failure: automatic fallback and the catch-up sweep recover a stalled stream on their own. Recovery remains read-only with respect to source history — derived nodes and views may be added, but event rows and stream relationships are never moved or deleted.

## Read-only live snapshot (historical, approximate)

A bounded, read-only inspection of `~/.dsh/plugins/optmem/optmem.db` found approximately 53.9k unique events, 107.8k stream entries, 94.7k missing leaf positions, 48.4k unique events missing leaves, and 19.7k unique oversized missing events. These values are one changing snapshot, not a current invariant. The count gap demonstrates why a raw stream-position total must not be reported as model calls.

No production database write, schema migration, stream move, summarization drain, service restart or process termination was performed as part of that inspection. The Explorer endpoints remain read-only; Context Preview uses the committed compact view and in-memory injection assembly only.

## Project identity and isolation

Explorer requests resolve the selected project against either the Host workspace registry or an existing `project:<id>` stream; node, search, context preview and pipeline reads are then scoped to that exact project stream. Search pagination retains the project filter. No browser-side SQLite access or cross-project search is used. DSHX authenticates Host API calls, but this plugin adds no per-workspace ACL: a peer already authorized to access this Host can request any project exposed by the picker. This is not an unauthenticated bypass, but deployments that treat connected Host peers as mutually untrusted need a Host-level workspace authorization boundary before exposing the Explorer.

Current memory identity remains workspace-based (`workspace:<id>`) with historical path-hash identities (`path:<hash>`). Two Jujutsu workspaces can belong to one repository but currently have distinct workspace IDs. The Explorer makes no silent joins or stream moves. A repository-level identity change needs an explicit, tested compatibility plan that preserves raw events, node provenance and stream references; none is included here.

## Validation limits

Unit suites cover output-budget retry behavior, bounded retry scheduling, the clipped-text fallback for leaves _and_ internal nodes, per-stream catch-up without another append, the rolling-minute call cap, persisted backlog accounting, project-scoped pagination, data-preserving recovery, and rejection of malformed Explorer requests by their Standard Schema boundaries. The isolated Playwright journey seeds a scratch user event, finds and opens it through project search, verifies it appears in Context Preview, and visits Pipeline; it does not touch the live profile.

The fix was reproduced against a **copy** of the live database, never the live one: with a working summarizer the frozen view advanced from 468 to 1,238 (3 nodes, 60 model calls) and a full catch-up drain was measured separately. Cost and retrieval claims are backed by the two snapshot audits in this directory; the live `web` process was not restarted, synced, or written to, so the running Host still executes the previous build until the user restarts it. The wider plugin build/typecheck/test gates remain partly blocked by the unrelated `agent-communication` package using stale Host contracts.

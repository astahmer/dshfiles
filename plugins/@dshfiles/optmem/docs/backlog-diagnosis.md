# OptMem backlog and recovery

## What the counters mean

OptMem persists each captured event once in `events`, then stores stream entries separately for the conversation tree and its project tree. An event included in both is **two missing-leaf positions but one unique event**. Thus the Settings panel's legacy `pendingSummaries` is not a count of model calls: it mixes in-memory leaf, parent, running and failed jobs and does not describe persisted work that has not been enqueued yet.

The Pipeline view and Host diagnostics now distinguish:

- stored unique events from stream entries;
- missing level-0 nodes per stream from distinct missing events;
- estimated unique oversized events requiring a leaf summary from pending stream positions;
- ready merge pairs, oldest pending event, stored summary nodes and recent throughput.

The leaf-call estimate excludes verbatim-sized events and deduplicates events already represented by a leaf in any stream. It is an estimate, not a promise that one call will succeed. Parent merges are separate work; views can be pending without a new model call. Counts are read from SQLite and can change while the engine is active.

## Diagnosed output-budget failure

For a 512-byte summary node the previous DSH adapter fixed `maxTokens` at 1,024. DSH reports exhausted output as `finish.kind === 'max-tokens'`; a response with no text was treated as an empty-summary error. The byte-size retry therefore could not help when the model needed a larger output token budget: it repeated the same capped request and left the leaf missing.

The adapter now requests a bounded output budget derived from node size (`max(2,048, maxBytes × 4)`, capped at 16,384), then makes at most one retry at twice that budget when DSH explicitly reports output-budget exhaustion. Repeated exhaustion is surfaced as a non-retryable `OutputBudgetError`, avoiding an unbounded automatic loop. Other failures remain eligible for capped exponential retries (at most five attempts total per job before waiting for operator/user activity).

This is a code-proven failure mode and a plausible backlog contributor. There is no historical per-request `max-tokens` telemetry in the live database, so the evidence does **not** establish that it caused all, or even a measured fraction, of the existing backlog. Route unavailability, timeouts, process interruptions and ordinary queue throughput remain possible contributors.

## Bounded recovery

A permanent output-budget failure is retained in the engine's failed-job set and does not auto-loop. When an operator resumes summaries after pausing, OptMem explicitly retries failed jobs once through `MemoryEngine.retryFailures()`. This is still read-only with respect to source history: new summary nodes/views may be derived, but event rows and stream relationships are not moved or deleted. On process restart, recovery scans persisted cursors and missing leaves as before.

## Read-only live snapshot (historical, approximate)

A bounded, read-only inspection of `~/.dsh/plugins/optmem/optmem.db` found approximately 53.9k unique events, 107.8k stream entries, 94.7k missing leaf positions, 48.4k unique events missing leaves, and 19.7k unique oversized missing events. These values are one changing snapshot, not a current invariant. The count gap demonstrates why a raw stream-position total must not be reported as model calls.

No production database write, schema migration, stream move, summarization drain, service restart or process termination was performed as part of that inspection. The Explorer endpoints remain read-only; Context Preview uses the committed compact view and in-memory injection assembly only.

## Project identity and isolation

Explorer requests resolve the selected project against either the Host workspace registry or an existing `project:<id>` stream; node, search, context preview and pipeline reads are then scoped to that exact project stream. Search pagination retains the project filter. No browser-side SQLite access or cross-project search is used. DSHX authenticates Host API calls, but this plugin adds no per-workspace ACL: a peer already authorized to access this Host can request any project exposed by the picker. This is not an unauthenticated bypass, but deployments that treat connected Host peers as mutually untrusted need a Host-level workspace authorization boundary before exposing the Explorer.

Current memory identity remains workspace-based (`workspace:<id>`) with historical path-hash identities (`path:<hash>`). Two Jujutsu workspaces can belong to one repository but currently have distinct workspace IDs. The Explorer makes no silent joins or stream moves. A repository-level identity change needs an explicit, tested compatibility plan that preserves raw events, node provenance and stream references; none is included here.

## Validation limits

Unit suites cover output-budget retry behavior, capped retry scheduling, explicit failed-job recovery, persisted backlog accounting, project-scoped pagination, data-preserving recovery, and rejection of malformed Explorer requests by their Standard Schema boundaries. The isolated Playwright journey seeds a scratch user event, finds and opens it through project search, verifies it appears in Context Preview, and visits Pipeline; it does not touch the live profile. A build or typecheck alone is not runtime evidence. The wider plugin build/typecheck/test gates and full-profile stylesheet journey are currently blocked by the unrelated `agent-communication` package using stale Host contracts (`intent`/`dedupeKey` missing from linked types). The live `web` process was not restarted or synced.

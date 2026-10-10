# OptMem — technical design (Stage 1 output)

Inputs: [requirements.md](requirements.md), [research-optmem.md](research-optmem.md), [research-dsh.md](research-dsh.md).
Clean-room: the gist has no licence — no prompts, templates or code are copied; algorithms are re-derived.

## 1. Confirmed DSH extension points (see research-dsh.md for citations)

- Capture: `session/event` (every committed append: user/assistant/tool/call/result/turn events) + backfill via
  `ctx.sessionQuery`. Session id, cwd, parentSession from the session header; project via cwd realpath.
- Tools: `defineTool` in `defineHost({ tools })`; `exec.agent.id` = session id, `exec.signal` for cancellation.
- Injection: `definePromptContext` (durable user-role snapshot, re-emitted only when its text changes).
- Full replacement: **no stock hook replaces request messages**. Options: (A) fork waterfall
  `agent/request-messages` after `buildRequest` (≈10 lines in `tooling/dsh-core/agent-loop`, active only under
  `dsh-core-runtime`, i.e. scratch profiles); (B) durable `surfaceOp:'replace'` from `agent/pre-step` (stock, but
  rewrites the session surface, i.e. the user's history view of the model context); (C) `llm/stream`
  short-circuit (stock, but the session log no longer matches what was sent). **Chosen: A**, B as documented
  fallback; C rejected.
- Storage: `node:sqlite` `DatabaseSync` + FTS5, verified on Node v22.23.3 (DSH runtime). DB at
  `dshHomePath('plugins', 'optmem', 'optmem.db')`. WAL mode, one writer per process, `busy_timeout`.

## 2. Limitations to accept up front

- Full mode works only where the fork agent-loop is active (probe/scratch profile via dsh-core-runtime) until the
  waterfall is upstreamed. Stock `web` runs compatibility mode only; startup validation reports this.
- Runtime drivers (cursor-acp) get no system prompt/tools from DSH → OptMem can capture their events but cannot
  inject or replace context there.
- deepseek caches server-side by prefix; pi-ai routes need `cacheRetention` ≠ none. Cache-read % is observable
  only through `usage.cacheReadTokens`.

## 3. Data model

### Events (source of truth, append-only)

`events(id INTEGER PRIMARY KEY, event_key TEXT UNIQUE, harness TEXT, conversation_id TEXT, project_id TEXT NULL,
 parent_conversation_id TEXT NULL, role TEXT, created_at INTEGER, text TEXT, bytes INTEGER, truncated INTEGER,
 meta TEXT)`

- `event_key` = harness-stable id (DSH: `dsh:<sessionId>:<seq>`) → idempotent ingestion (`INSERT … ON CONFLICT DO
NOTHING`).
- `role` ∈ `user | assistant | tool_call | tool_result | note`. Text is normalized, **redacted**, bounded
  (tool results capped, default 16 KB, with an explicit `…[truncated N bytes]` marker).
- `id` is a global insertion order, never reused.

### Memory streams (the OptMem trees)

`stream_entries(stream TEXT, pos INTEGER, event_id INTEGER, PRIMARY KEY(stream, pos))`

- A stream is a dense, contiguous, chronological sequence (pos 0..T−1) — the tree invariant.
- Streams: `conversation:<id>` (always), `project:<id>` (when the conversation has a project), `global` (only
  events explicitly scoped global; nothing is auto-promoted). Events are stored once and referenced per stream.
- Positions are assigned in the same transaction as the event insert (append is serialized per process; streams
  are append-only, so concurrent conversations interleave deterministically in the project stream).

### Tree nodes (derived)

`nodes(stream TEXT, level INTEGER, idx INTEGER, text TEXT, bytes INTEGER, model TEXT, created_at INTEGER,
 PRIMARY KEY(stream, level, idx))`

- Node (l, i) covers positions [i·2^l, (i+1)·2^l). Address string `"<start>+<len>"` (e.g. `128+64`).
- Level 0: event text if ≤ `maxNodeBytes` (512), else a model summary. Level ≥1: summary of the two children,
  ≤ 512 bytes, built only when both children exist and are complete (len = 2^l fully present).

### Views (derived, persisted byte-for-byte)

`views(stream TEXT PRIMARY KEY, through_pos INTEGER, nodes TEXT /* JSON [[l,i],…] */, rendered TEXT, bytes INTEGER,
 version INTEGER)`

- A view is an ordered partition of [0, through_pos) into nodes. Rendering = one line per node:
  `<start>+<len>| <text>` (newlines escaped). The rendered string is stored and only ever extended at the tail
  (append) or rewritten by a merge batch — never re-serialized otherwise.

### Cursors (independent pipelines)

`cursors(name TEXT, stream TEXT, pos INTEGER, PRIMARY KEY(name, stream))` with names `leaf` (leaf summaries done),
`fts` (search indexed), `view` (= views.through_pos). Each pipeline resumes from its cursor after a crash.

### Search (derived)

`events_fts` FTS5 (`text`, content=events, content_rowid=id, tokenize unicode61) maintained by the `fts`
pipeline, not by triggers, so an FTS failure never blocks ingestion.

### Migrations

`PRAGMA user_version` + ordered SQL migrations in `optmem-sqlite`.

## 4. Algorithms (clean-room from research-optmem.md)

1. **Append** (transaction): insert event, assign stream positions, return positions. Nothing else on the hot path.
2. **Leaf pipeline** (background, bounded concurrency): for each stream pos ≥ cursor `leaf`, create level-0 node
   (verbatim if ≤512 B, else `Summarizer`). Advance cursor only over a contiguous completed prefix.
3. **Parent pipeline** (background): when both children of (l,i) exist, enqueue (l+1, ⌊i/2⌋). Ready nodes are
   queued, not scanned. Summaries are clipped to ≤512 B: ask for ≤N bytes, verify, retry up to 3× with a stricter
   budget, keep the shortest; final fallback = deterministic UTF-8-safe truncation + `…` (logged).
4. **View append**: after the leaf cursor advances, append lines for new leaves to the view (tail only).
5. **Merge batch** when `view.bytes > upper (128 KB)`: repeatedly pick the adjacent sibling pair in the view
   (both same level l, siblings of the same parent, parent node built) with the greatest
   `due = (T − last)/2^l` (T = through_pos, last = last position covered by the pair), ties → oldest; replace the
   pair by its parent; stop when `bytes ≤ lower (64 KB)` or nothing mergeable. One write per batch. Deterministic.
6. **Zoom** `(start+len)`: return the two children's lines (or the full event text for len=1, paginated at 8 KB).
7. **Snapshot**: `{stream, through_pos, view.version, rendered}` read in one read transaction → consistent.
8. **Recovery**: on open, cursors + views are authoritative; replay stream positions ≥ view.through_pos whose leaves
   exist; restart pipelines from cursors. No step deletes events.

## 5. Next-turn consistency barrier (full mode)

Before building turn N+1's context: (1) previous-turn events flushed + appended (DSH flushes at pre-step);
(2) wait up to `barrierMs` (default 5 s) for `leaf` cursor ≥ T; (3) any position still without a leaf node is
rendered with its raw text clipped to 512 B and an explicit `[pending summary]` tag — **recent events are never
omitted**; (4) snapshot. Deviation from the gist (unbounded wait), recorded deliberately.

## 6. Modes and lifecycle

### Compatibility mode (stock DSH)

- Capture every committed session event → `append`.
- Tools: `memory_search`, `memory_zoom`, `memory_context`, `memory_status`.
- Injection: one `definePromptContext` "Persistent memory" ≤ `injectBytes` (8 KB): the top of the **project** view
  excluding nodes that only cover the current conversation's events still present in the live context (no
  duplication); changes only when the view changes (cache-friendly). Background compaction as above.

### Full mode (fork waterfall)

Per user turn (first step of `turn/start`): messages = `[system node 0 (unchanged)]` + `[memory view message]` +
`[messages of the current turn only]`. Later steps of the same turn keep the identical prefix. The view message is
the project view (fallback: conversation view) rendered byte-for-byte; between turns it only grows at the tail
except after a merge batch → stable prefix. The DSH session/log stays untouched (no new user-visible session,
no history replay). Tools/permissions/streaming/cancellation are DSH's own.

### Capabilities

`HarnessCapabilities { captureEvents, registerTools, injectContext, replaceContext, resetPerTurn }`.
DSH stock = {T, T, T, F, F}; DSH + fork waterfall = all T. Mode startup validates and reports missing ones.
Producers (capture) and consumers (tools/injection) are separate adapter parts.

## 7. Scopes and multi-conversation

- Every conversation has its own stream; same-project conversations share the project stream; global only by
  explicit scope. New conversation = new conversation stream + the existing project view.
- Retrieval tools take `scope: conversation | project | global | all-projects` (default project);
  `all-projects` must be enabled in settings (explicit, permission-aware).
- Concurrency: single writer connection per process (serialized appends), readers use WAL snapshots.

## 8. Packages (inside the plugins pnpm workspace, extractable)

- `plugins/@dshfiles/optmem-core` — types, tree math, view render/merge, engine orchestration, interfaces
  (`MemoryStore`, `Summarizer`, `MemorySearch`, `Clock`). No deps.
- `plugins/@dshfiles/optmem-sqlite` — `node:sqlite` store + FTS search + migrations. Depends on core.
- `plugins/@dshfiles/optmem` — the DSH plugin (adapter): capture, tools, prompt context, summarizer over `ctx.llm`,
  settings (mode, budgets, model, exclusions). Depends on core + sqlite.
- Benchmarks/evals: `optmem-sqlite/bench` (10k/100k synthetic) + retrieval eval fixtures; promote to an
  `optmem-evals` package only if it grows.
- Fork change for full mode: `tooling/dsh-core/agent/src/runtime-types.ts` + `agent-loop/src/agent.ts`.

## 9. Security

Redaction before persistence (API-key/token/JWT/private-key/password patterns + configured secret aliases),
excluded tools/paths (config), bounded tool results, history labelled as untrusted data in the injected block,
DB file mode 600, no network listener.

## 10. Risks / trade-offs

- `node:sqlite` is experimental in Node 22 (works; DSH already uses it).
- Summaries cost model calls ≈ one per event + one per internal node; mitigated by the 512 B verbatim rule and a
  cheap model; budget visible in `memory_status`.
- Project-stream interleaving of concurrent conversations is chronological but mixes topics; acceptable by spec.
- Full mode depends on the fork; upstreaming the waterfall is the long-term fix.

## 11. Stage plan

2 core + sqlite (tests + bench, no DSH) → 3 DSH compat plugin, verified in `probe` → 4 fork waterfall + full mode,
runtime-proven in `probe` → 5 evals (plain vs compat vs full) + hardening.

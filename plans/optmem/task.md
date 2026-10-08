# OptMem — task brief (verbatim requirements, condensed)

Source: user request 2026-10-09. Keep this file as the requirement of record; progress lives in [README.md](README.md).

Build **OptMem**: a harness-agnostic persistent AI-agent memory system inspired by Victor Taelin's OptChat/OptMem
(<https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449>), first integrated with DSH, inside
`dshfiles` with package boundaries that allow later extraction.

## 1. Research first (no code from assumptions)
- DSH: install/config/extension/launch; repo nature; installed version; plugin hooks; how model context is built and
  sessions managed; persistence of messages, tool calls/results, subagents; whether context can be replaced per user
  turn; compaction, prompt caching, streaming, cancellation, tool permissions. Read real source/docs.
- Gist: append-only history; binary chronological memory tree; node addressing + zoom; summary generation and byte
  limits; persisted views; incremental compaction; 64–128 KB view strategy; background summarization; stable-prefix
  caching; per-turn context reset; failure recovery + concurrency. Separate confirmed behaviour from assumptions.
  Check licence before reusing code.

## 2. Architecture (TypeScript, strict)
- **core**: harness-agnostic; no DSH/Claude/Codex/SQLite imports. Event ingestion/normalization, append-only
  history, binary tree, hierarchical summaries, persisted views, zoom, incremental compaction, retrieval
  orchestration, snapshots, compaction scheduling, crash recovery.
- **storage-sqlite**: SQLite + FTS5, simplest reliable driver for the runtime. Transactions, indexed lookup, tree
  retrieval, FTS, persisted views, migrations, idempotent ingestion, projection cursors, recovery, concurrent reads +
  serialized writes. Small interface, no ORM, no PGlite, no vectors (search interface only).
- **adapter-dsh**: event capture, session/turn ids, project scope, memory tools, context injection, full replacement
  if supported, lifecycle, config, errors. Core never depends on DSH types.

## 3. Modes (same engine + data)
- **Compatibility**: keep DSH loop; add capture, search/zoom tools, bounded injection (~8 KB, configurable),
  background compaction, project-aware retrieval; no duplication of live session context.
- **Full OptChat**: per user turn — persist previous events durably; resolve consistent snapshot; build fresh
  context = stable instructions + tool defs + persisted view + current message; run turn normally (tools, streaming,
  approvals, cancellation); persist results; discard transient context. No new user-visible session, no history
  replay, stable prefixes, no needless view regeneration or per-turn compaction, explicit next-turn consistency
  barrier, never silently drop recent events, keep DSH tools/permissions. If plugins can't do it: context-assembly
  adapter or minimal loop extension; do not claim it works without runtime proof.

## 4. Capabilities
`HarnessCapabilities { captureEvents, registerTools, injectContext, replaceContext, resetPerTurn }`, validated at
startup per mode; report unsupported full mode clearly. Separate producers from consumers.

## 5. Core interfaces (illustrative)
`MemoryStore { append, read, getNode, saveNodes, getSnapshot, commitSnapshot }`, `Summarizer { summarize }`,
`MemorySearch { search }`. Refine; avoid over-engineering.

## 6. Tools
`memory_zoom`, `memory_search` (FTS5, original event ids, navigable into the tree), `memory_context`
(surrounding messages), `memory_status`. Concise results, progressive disclosure.

## 7. Scopes
Global, project/repository, conversation(session) origin. Separate logical views/trees where apt; no duplicated
events; preserve chronological + contiguous-id tree assumptions; explicit, permission-aware cross-project retrieval;
no automatic global promotion. Simple scope model first.

## Multi-conversation (mandatory)
Multiple independent DSH conversations from day one, both modes. Separate identities/histories; same-project
conversations share memory; global/project/conversation scopes; full mode resets per turn without merging
sessions; new conversation keeps memory; cross-conversation search/zoom within scope permissions; chronological
order per stream; concurrent conversations via transactions + consistent snapshots; no unrelated history injected;
test cross-conversation recall in both modes. "A new conversation = fresh workspace with access to everything
relevant previously learned."

## 8. Compaction + caching
Node summary ≈ 512 UTF-8 bytes; view upper 128 KB, lower 64 KB; background compaction with a cheap configurable model;
bounded concurrency; views persisted byte-for-byte; incremental, crash-safe; explicit projection cursors;
compaction and FTS indexing are independent pipelines; index failure never blocks the engine; compaction failure
never discards history.

## 9. Security/reliability
History and tool results are untrusted data; secret redaction before persistence; configurable tool/file exclusions;
stable ids + dedupe; transactions; safe cancellation; recovery; bounded tool-result capture with truncation markers;
scope-aware retrieval; failure isolation from DSH; don't change DSH permissions; no network exposure.

## 10. Layout (suggested)
`optmem/packages/{core,storage-sqlite,adapter-dsh,evals}`, `optmem/examples/dsh`. Dependencies flow inward. No MCP
server / HTTP daemon / dashboard / extra adapters yet, but don't block them.

## 11. Tests + benchmarks
Correctness (append/replay, tree, addressing, zoom, thresholds, summary limits, snapshots, restart), retrieval
(exact keyword, code snippets, one-off facts, hit context, distant related events), DSH integration (no duplicate
capture, compat injection, full-mode reset, tools, streaming/cancel, continuity, plugin compatibility), performance
(10k/100k synthetic, query latency, memory, compaction cost, prompt size, cache-read %). Compare plain DSH vs
compat vs full; measure, don't assume.

## 12. Stages
1 research + concise design (extension points, limits, data model, interfaces, schema, lifecycle, boundaries,
risks; blockers before invasive changes) → 2 core engine + tests → 3 DSH compat adapter verified on the real runtime
→ 4 full mode (prefer extension points; minimal documented loop changes) → 5 evaluation + hardening.

## 13. Principles
Simplicity; harness-agnostic core; performance over purity; no RPC initially; few deps; strict TS; deterministic
algorithms, explicit state transitions; original history is truth, indexes/summaries derived; observable; don't
replace DSH features; not an agent framework.

## 14. Deliverables
Core; SQLite + FTS5; DSH compat plugin; full mode if verified; config examples for both modes; tests + benchmarks;
architecture/extension docs; honest account of what works, what's experimental, verified limits.

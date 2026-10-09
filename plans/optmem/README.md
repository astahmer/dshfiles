# OptMem — progress

Requirements: [task.md](task.md). Research: [research-optmem.md](research-optmem.md), [research-dsh.md](research-dsh.md).
Design: [design.md](design.md).

## Status (2026-10-09)

| Stage | State | Notes |
|---|---|---|
| 1 Research + design | done | Gist: no licence → clean-room only. DSH: no per-request message-replace hook; compat mode needs no fork; full mode = fork waterfall `agent/request-messages` (preferred) or durable `agent/pre-step` replace |
| 2 Core engine | done | `@dshfiles/optmem-core` (zero deps) + `@dshfiles/optmem-sqlite` (`node:sqlite`, FTS5); 53 tests green on Node 22.23.3; 100k-event bench in [benchmarks.md](benchmarks.md) |
| 3 DSH compatibility adapter | done | `@dshfiles/optmem`: capture, 4 tools, compact-view injection, `/optmem-backfill`, `ctx.llm` summarizer (default `gpt-6-luna`, effort low, no session-route fallback), live settings `dshfiles-optmem`. Core: `compact` view kind, retry backoff, parents-first while a merge waits, 16 KB pending-tail cap. Live turns in `probe` proved capture, tools, injection and real summaries — [runtime-evidence.md](runtime-evidence.md) |
| 4 Full mode | not started | |
| 5 Evaluation + hardening | not started | |

## Resume here
1. Stage 4 prerequisites: fork waterfall `agent/request-messages` in `tooling/dsh-core/agent` (design §1 option A),
   a `replaceContext`/`resetPerTurn` capability the plugin can detect, and the `dsh-core-runtime` path active in
   `probe`. Settings `mode: full` is accepted and reported unsupported until then.
2. Known gaps: every injected-view change appends a new `runtime-context` message to the session (DSH contexts are
   durable); a project id switches from `path:<hash>` to `workspace:<id>` when the workspace is registered later;
   backfill appends old sessions after newer live events in the project stream; the probe DB keeps two legacy
   injected-context rows captured before the allowlist fix.

## Rules
- dshfiles is a jj repo; one described revision per chunk; never restart the live DSH (`web`); verify in `probe`.

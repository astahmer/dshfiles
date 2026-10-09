# OptMem — progress

Requirements: [task.md](task.md). Research: [research-optmem.md](research-optmem.md), [research-dsh.md](research-dsh.md).
Design: [design.md](design.md).

## Status (2026-10-09)

| Stage | State | Notes |
|---|---|---|
| 1 Research + design | done | Gist: no licence → clean-room only. DSH: no per-request message-replace hook; compat mode needs no fork; full mode = fork waterfall `agent/request-messages` (preferred) or durable `agent/pre-step` replace |
| 2 Core engine | done | `@dshfiles/optmem-core` (zero deps) + `@dshfiles/optmem-sqlite` (`node:sqlite`, FTS5); 53 tests green on Node 22.23.3; 100k-event bench in [benchmarks.md](benchmarks.md) |
| 3 DSH compatibility adapter | done | `@dshfiles/optmem`: capture, 4 tools, compact-view injection, `/optmem-backfill`, `ctx.llm` summarizer (default `gpt-6-luna`, effort low, no session-route fallback), live settings `dshfiles-optmem`. Core: `compact` view kind, retry backoff, parents-first while a merge waits, 16 KB pending-tail cap. Live turns in `probe` proved capture, tools, injection and real summaries — [runtime-evidence.md](runtime-evidence.md) |
| 4 Full mode | done | M1 fork waterfall `agent/request-messages` + `request/messages-override` log event (FORK.md); M2 `agentLoop.forkFeatures` marker → `replaceContext`/`resetPerTurn` detected by the plugin, shown in `memory_status`; M3 plugin full mode: `[system + instruction/skill contexts] + [memory view] + [current turn]`, view = project snapshot as of the turn start (`snapshot({endPos})`, barrier + `[pending summary]`), reused for later steps and across turns while unchanged; compat context suppressed; tests in `optmem/src/full-mode.test.ts`; M4 live turns through the fork Host proved replacement, view recall, tools and cross-conversation recall ([runtime-evidence.md](runtime-evidence.md) Stage 4); M5 compat-vs-full table in [benchmarks.md](benchmarks.md) |
| 5 Evaluation + hardening | not started | |

## Resume here
1. Stage 5: long-conversation compat vs full token comparison; exercise real summaries in full mode; byte-level
   request capture (only counts are logged today). Running the fork Host: rebuild `tooling/dsh-core/{session,agent,
   agent-loop}` and `plugins/@dshfiles/dsh-core-runtime`, scratch profile + `sessionPersistenceRoot` overlay (Stage 4
   evidence). An isolated `DSH_HOME` gives empty Codex replies — keep the real home, scratch sessions root.
   Full-mode rules: user, agent-message, subagent-settled, compact-checkpoint messages are per-turn; instructions,
   skill catalog, goal and the latest runtime context are carried ahead of the view; subagents are never rewritten.
2. Known gaps: full-mode turns write fork-only `request/messages-override` events (stock DSH cannot read those logs);
   every injected-view change appends a new `runtime-context` message to the session (DSH contexts are
   durable); a project id switches from `path:<hash>` to `workspace:<id>` when the workspace is registered later;
   backfill appends old sessions after newer live events in the project stream; the probe DB keeps two legacy
   injected-context rows captured before the allowlist fix.

## Rules
- dshfiles is a jj repo; one described revision per chunk; never restart the live DSH (`web`); verify in `probe`.

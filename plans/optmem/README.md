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
| 5 Evaluation + hardening | in progress — follow [stage5-runbook.md](stage5-runbook.md) | oxfmt applied to all optmem packages; 29 + 32 + 24 tests, typecheck, build, dist import and workspace contract green (2026-10-09). Remaining items below |

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

## Post-Stage-4 notes (2026-10-09)
- Fork-only `request/messages-override` events are now written with `ignorable: true`, so stock DSH can still
  read session logs produced in full mode (fork session package + dsh-core-runtime rebuilt).
- Remaining (Stage 5): long-conversation token/cache comparison compat vs full; real summaries in full mode;
  capture actual request bytes; why the codex route returns empty replies from an isolated DSH_HOME. (oxfmt: done.)

## Stage 5 report (S1–S2, 2026-10-09)

Long scenario (24 + 2 turns), `codex-emialex/gpt-6-luna` effort low, isolated scratch homes. Details:
[benchmarks.md](benchmarks.md) "Long conversation", [runtime-evidence.md](runtime-evidence.md) "Stage 5".

| Metric | stock | compat | full | no-OptMem baseline |
|---|---|---|---|---|
| total input tokens (24+2 turns) | 387,621 | 202,964 | 234,934 | 349,526 |
| cache-read % | 83.3 | 79.0 | 79.3 | 81.7 |
| input tokens at turn 24 | 25,407 (2 steps; 12,578 first step) | 8,952 | 8,103 | 12,397 |
| sent bytes at turn 24 (S3) | n/a | n/a | 16,989 (original 40,864, −58 %) | n/a |
| recall correct (turns 21–24, B) | 6/6 | 5/6 (B1 missed the error code) | 6/6 | 3/6 (no citation, B fails) |
| summaries written / max node bytes | n/a | 18 / 498 | 54 / 512 | n/a |

Caveat: the stock core made the model use workspace tools on code turns (multi-step turns, tool results in history),
the fork core mostly did not, so run totals are not a like-for-like memory comparison; per-step growth is (full
+2.3k tokens over 24 turns vs baseline +6.7k).

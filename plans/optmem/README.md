# OptMem — progress

Requirements: [task.md](task.md). Research: [research-optmem.md](research-optmem.md), [research-dsh.md](research-dsh.md).
Design: [design.md](design.md).

## Status (2026-10-09, paused at 91% of the 5h usage window)

| Stage | State | Notes |
|---|---|---|
| 1 Research + design | done | Gist: no licence → clean-room only. DSH: no per-request message-replace hook; compat mode needs no fork; full mode = fork waterfall `agent/request-messages` (preferred) or durable `agent/pre-step` replace |
| 2 Core engine | done | `@dshfiles/optmem-core` (zero deps) + `@dshfiles/optmem-sqlite` (`node:sqlite`, FTS5); 53 tests green on Node 22.23.3; 100k-event bench in [benchmarks.md](benchmarks.md) |
| 3 DSH compatibility adapter | not started | |
| 4 Full mode | not started | |
| 5 Evaluation + hardening | not started | |

## Resume here
1. Stage 3: DSH compatibility adapter `plugins/@dshfiles/optmem` (design §6): capture via `session/event`, the four
   memory tools over `createMemoryEngine`, `definePromptContext` injection, a summarizer over `ctx.llm`. Verify in `probe`.

## Rules
- dshfiles is a jj repo; one described revision per chunk; never restart the live DSH (`web`); verify in `probe`.

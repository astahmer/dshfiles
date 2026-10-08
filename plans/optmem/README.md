# OptMem — progress

Requirements: [task.md](task.md). Design (Stage 1 output): [design.md](design.md) (pending).

## Status

| Stage | State | Notes |
|---|---|---|
| 1 Research + design | in progress | DSH internals agent + OptMem gist agent running (2026-10-09) |
| 2 Core engine | not started | |
| 3 DSH compatibility adapter | not started | |
| 4 Full mode | not started | depends on Stage 1 finding a per-turn context-replacement point |
| 5 Evaluation + hardening | not started | |

## Resume notes
- Research outputs land in `research-dsh.md` and `research-optmem.md` in this folder.
- Work happens in the `dshfiles` jj repo; one described revision per stage chunk.
- Never restart the live DSH (`web` profile); verify against a scratch profile (`probe`) per AGENTS.md.

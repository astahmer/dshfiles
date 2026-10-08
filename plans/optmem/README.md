# OptMem — progress

Requirements: [task.md](task.md). Research: [research-optmem.md](research-optmem.md), [research-dsh.md](research-dsh.md).
Design: [design.md](design.md) (NOT WRITTEN YET — next step).

## Status (2026-10-09, paused at 91% of the 5h usage window)

| Stage | State | Notes |
|---|---|---|
| 1 Research + design | research done, design pending | Gist: no licence → clean-room only. DSH: no per-request message-replace hook; compat mode needs no fork; full mode = fork waterfall `agent/request-messages` (preferred) or durable `agent/pre-step` replace |
| 2 Core engine | not started | |
| 3 DSH compatibility adapter | not started | |
| 4 Full mode | not started | |
| 5 Evaluation + hardening | not started | |

## Resume here
1. Write `design.md` from the two research files + task.md: data model (events with global append order per
   stream; contiguous ids per memory stream — one stream per scope: global / project / conversation, events stored
   once and referenced by stream position), SQLite schema (`node:sqlite`, FTS5, migrations, projection cursors for
   tree/summaries and FTS separately), core interfaces, tree/merge rule from research-optmem.md (due =
   (T-last)/2^l, merge batch when view > 128 KB down to ≤ 64 KB, 512 B summaries, view persisted byte-for-byte),
   per-mode lifecycle, HarnessCapabilities, package layout (`optmem/packages/{core,storage-sqlite,adapter-dsh,evals}`
   as a pnpm workspace inside dshfiles — check how plugins/ workspace is wired before choosing), risks.
2. Ask the user to approve the design, then Stage 2 (core + storage tests, runnable without DSH).
3. A leftover background research agent may still finish and overwrite `research-dsh.md`; diff and keep the richer one.

## Rules
- dshfiles is a jj repo; one described revision per chunk; never restart the live DSH (`web`); verify in `probe`.

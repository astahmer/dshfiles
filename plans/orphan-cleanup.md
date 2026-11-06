# Orphaned processes, workspaces and threads

Goal: nothing an agent, a test run or a scratch DSH starts outlives its owner by more than a few minutes, without
anyone running `pkill` by hand.

Resume here: nothing started. Do P1 first; it removes the largest source (orphaned E2E Hosts).

## What leaked (2026-11-06)

- **51 orphaned `dsh --profile dshx-boot` Hosts** (parent PID 1, 10 h to 25 h old) from thread-d1e967, thread-578520,
  fu-shell, fu-usage, fu-workbench, fu-agents, fu-traces. Load average stayed at 70–100 and scratch boots needed a
  10-minute timeout. They were E2E fixtures: `tooling/dshx/e2e/support/boot.ts` stops its Hosts only from `close()`
  and a `process.once('exit')` handler (`killPrewarmedHostsOnExit`). Neither runs when the Playwright worker is
  SIGKILLed (a turbo or bash timeout, a cancelled agent turn, `job_kill`), so the Host is reparented to launchd.
- **17 `$TMPDIR/dshx-dev/<name>` state dirs** from `dshx dev up`. `dshx dev` already has a lease, a detached
  watchdog and a reaper (`src/scratch/{watchdog,reaper}.ts`), and none of the leaked Hosts came from it; the state
  dirs and their evidence are what stays.
- **Thread JJ workspaces** created by subagents (`ism-wp1`, `ade-quick`, `data-fetch`, `df-*`) with `jj workspace add`
  outside `@dshfiles/jj-integration`, so its cleanup (`jj_thread_cleanup`) never sees them as thread workspaces, and
  their `node_modules` stay on disk after their work landed.
- **Background bash jobs** a turn started and never collected (a `caffeinate -w`, a long `pnpm check:e2e`), and
  test-run temp output (`.dshx-host-tool-schemas-*` snapshotted into a JJ working copy when the run was killed).
- **Subagent threads** that finished long ago stay live in the sidebar and keep their scratch processes.

## Phases

| Phase | What                                                                                                                                                                                                                                                                                                                                                                                                                                      | Owner                             | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------ |
| P1    | **Parent-death guard for every scratch/E2E Host.** Spawn `dsh` through a tiny guard that holds a pipe from the parent and kills its own process group when the pipe closes (EOF = parent died, whatever the signal). Use it in `boot.ts` (E2E) and `scratch/up.ts`. Test: SIGKILL the parent of a booted fixture, assert the Host is gone within 5 s.                                                                                     | dshx (e2e support, scratch)       | todo   |
| P2    | **Ownership marker + sweeper.** Every scratch Host gets `DSHX_SCRATCH_OWNER=<pid>:<startedAt>:<workspace>` in its env and a pidfile under one root (`$TMPDIR/dshx-scratch/`). `dshx dev up`, `pnpm check:e2e` and `bootPluginProfile` first sweep entries whose owner is gone (pid dead or recycled), with SIGTERM then SIGKILL on the process group. A `dshx scratch sweep [--dry-run]` command and an agent tool expose the same sweep. | dshx                              | todo   |
| P3    | **Scratch state retention.** `dshx dev down` and the sweeper delete state dirs older than 24 h that have no live process; evidence goes to one capped `evidence/` root (newest N runs).                                                                                                                                                                                                                                                   | dshx scratch                      | todo   |
| P4    | **Workspaces agents create.** Subagent prompts and the skills use `jj_thread_isolate` (or a `dshx workspace add` helper that registers the workspace with jj-integration) instead of raw `jj workspace add`, so `jj_thread_cleanup` covers them: integrated + idle → forgotten, `node_modules` removed by the memory plugin's cleanup script. Document the rule in AGENTS.md.                                                             | jj-integration, AGENTS.md, skills | todo   |
| P5    | **Jobs and threads at turn end.** Background jobs a turn started that are still running when the thread settles or archives are listed in the thread's Jobs facet with Stop; jobs older than a cap with no reader are stopped (opt-out per job). Finished subagent threads auto-settle after N hours idle (existing auto-settle), which stops their jobs.                                                                                 | background-jobs, thread-sidebar   | todo   |
| P6    | **Guard against snapshotting temp output.** Test temp dirs (`.dshx-host-tool-schemas-*`, Playwright `test-results/`) go under `$TMPDIR` or are gitignored, so a killed run never lands in a JJ working copy.                                                                                                                                                                                                                              | dshx tests                        | todo   |
| P7    | **Visibility.** Worktree memory (`worktree_memory_snapshot`) labels scratch Hosts by owner and flags orphans (owner gone), with one Stop-orphans action; the status strip shows a warning item when orphans use more than a threshold of CPU or RAM.                                                                                                                                                                                      | worktree-memory, frame-layout     | todo   |

## Decisions to keep

- Kill by process group and verify the command line before signalling, as `scratch/lifecycle.ts` does; never `pkill
dsh`, never touch the live Host (its profile is not `dshx-boot` and it has no scratch owner marker).
- The parent-death pipe is the primary fix; sweeping is the backstop for anything started before P1 or by other tools.

## Verify

- P1: a test that boots a fixture, SIGKILLs the worker, and polls `ps` until the Host and its children are gone.
- After P1–P3: one day of normal agent work, then `ps -eo ppid,command | grep -- '--profile dshx-boot'` shows no
  PPID 1 rows and `$TMPDIR/dshx-dev` holds only live instances.

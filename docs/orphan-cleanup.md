# Orphaned processes, workspaces and jobs

Nothing an agent, a test run or a scratch DSH starts outlives its owner by more than a few minutes, and no one has to
run `pkill` by hand. Each layer below has an owner; the first one is the fix, the others are backstops.

Why it exists: on 2026-11-06, 51 E2E scratch Hosts (`dsh --profile dshx-boot`) were still running 10–25 h after
their tests, with launchd as parent, and kept the load average at 70–100. `tooling/dshx/e2e/support/boot.ts` stopped
its Hosts only from `close()` and a `process.once('exit')` handler, and neither runs when a Playwright worker is
SIGKILLed (a turbo or bash timeout, a cancelled agent turn, `job_kill`). Busy Hosts also ignored SIGTERM for minutes.

## Scratch and E2E Hosts (dshx)

- **Parent-death guard.** `tooling/dshx/packages/dshx/src/scratch/parent-guard.ts` starts every E2E Host and every
  `dshx dev up` Host, Chromium helper and fake provider. It leads the process group and stops it when its owner's pipe
  closes or the owner process is gone (dead, or a recycled pid): SIGTERM, then SIGKILL after 3 s. The owner is the
  Playwright worker for E2E Hosts and the instance's watchdog for `dshx dev`.
- **Registry.** Each guarded Host carries `DSHX_SCRATCH_OWNER=<ownerPid>:<ownerStartedAtMs>:<workspace>` and a record
  `$TMPDIR/dshx-scratch/<hostPid>.json` (mode 600, removed on a clean stop; `DSHX_SCRATCH_REGISTRY_DIR` overrides the
  folder). Other plugins read it through the `@dshfiles/dshx/scratch-registry` module (`ScratchRegistry.readRecords`,
  `ScratchRegistry.isOrphan`). Stop a Host by its process group: the guard leads it.
- **Sweep.** `dshx scratch sweep [--dry-run] [--json]` stops recorded Hosts whose owner is gone, and unrecorded
  `--profile dshx-boot` processes with parent pid 1 older than 2 h. It re-reads the command line before signalling, so
  the live DSH (another profile, no owner marker) is never touched. It runs at the start of `dshx dev up`,
  `pnpm check:e2e` and each E2E worker's first boot; `DSHX_SCRATCH_SWEEP=0` turns it off (the boot unit tests set it).
- **Retention.** The sweep and `dshx dev down` delete `$TMPDIR/dshx-dev/<name>` state dirs untouched for 24 h with no
  live process, and keep the newest 20 evidence runs per instance.
- **Temp output.** Test temp dirs live under `os.tmpdir()`; the two writers that must stay in the repository to resolve
  their imports (`host-tool-schema-snapshot.spec.ts`, `effect-schema-codemod.test.mjs`) write gitignored dirs, so a
  killed run never lands in a JJ working copy.

Known residue: `tooling/dshx/e2e/support/loopback-sshd.mjs` still starts a detached `sshd` outside the guard.

## Agent workspaces (jj-integration)

Agents and subagents call `jj_thread_isolate` before their first edit instead of a raw `jj workspace add`. The managed
thread workspace is guarded by its Session while it works and removed with its `node_modules` once its work lands on
`main` (see AGENTS.md and the [jj-integration README](../plugins/@dshfiles/jj-integration/README.md)). A raw named
workspace under the threads directory has no owning Session: cleanup keeps its unlanded work, but a short manual
`jj_thread_cleanup` window can list it while an agent still works in it.

## Jobs and threads (background-jobs, thread-sidebar)

- A running job whose thread is no longer running a turn shows **outlived its turn** beside Stop (Observe › Processes,
  the thread's Jobs facet, `background_jobs_board`). The Host stops it after `stopOutlivedAfterMinutes`
  (`dshfiles-background-jobs`, default 120, 0 turns it off); this also stops a long-running dev server whose thread has
  been idle that long.
- Host auto-settle settles subagent threads idle for `subagentSettleHours` (default 24, 0 turns it off) and stops their
  jobs. `thread_auto_settle_status` reports them; Unsettle reverses the settle (stopped jobs are not restarted).

## Visibility (worktree-memory)

Observe › Processes › RAM lists scratch DSH Hosts with their owner, flags orphans, and offers **Stop orphans**
(`worktree_memory_stop_orphans` with `confirm: true`). A status-strip item appears while orphans use more than the CPU
or memory threshold in `dshfiles-worktree-memory`.

## Verify

```sh
pnpm --dir tooling/dshx/packages/dshx exec vitest run tests/scratch-orphans.spec.ts   # SIGKILLs an owner, the SIGTERM-ignoring child is gone in ~3 s
node tooling/dshx/packages/dshx/dist/cli/bin.js scratch sweep --dry-run
ps -eo ppid,etime,command | grep -- '--profile dshx-boot' | grep -v grep           # no PPID 1 rows after a day of agent work
```

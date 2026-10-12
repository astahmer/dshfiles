# Isolation rollout report — 2026-10-12

Scope: the `jj` workspace isolation rollout, prepared but **not executed**. The
coordinator hardening (repository-scoped locking, bookmark concurrency, crash-safe
staging, duplicate leaks) is a separate change stack and is reported separately.

## Status

| stage | state |
| --- | --- |
| root cause identified and reproduced | done — 20/20 runs destroy 18 unsnapshotted files (isolation.test.mjs "S3 control") |
| guard, shim, preflight, fence, migrator built | done, in the independent clone |
| regression tests | 34 pass (guard 5, isolation 21, migration 8) |
| rollout patch applies to a pristine `main` and passes there | verified — 20 files, 3417 insertions, 34/34 |
| existing jj-integration plugin suite still passes | verified — 15/15 plus `tsc` clean |
| shim installed | **no** — nothing installed; nothing enabled |
| live migration | **no** — not started |
| live profiles restarted | **no** |
| bookmarks, sweeps, operation log | untouched |

The live store was read only: every jj call used `--ignore-working-copy`, no
workspace was created, `main` and `integration-spine` are still `a6cedcdf9a51`,
and the workspace set is unchanged.

## The change stack

Contiguous on top of live `main` (`a6cedcdf9a51`), in the clone
`~/dev/dshfiles-jj-isolation`:

| revision | what |
| --- | --- |
| `c2e0abb417e3` | `feat(jj-isolation)`: the guard, the `jj` shim, per-repository opt-in |
| `29ee0ce4fda2` | `fix(jj)`: stop monitors, the coordinator and the sweep writing to workspaces they observe |
| `b453535f4e37` | `docs(jj)`: the incident report |
| `915db2943352` | `feat(jj-isolation)`: preflight, maintenance fence, migrator |
| `aa5387859b17` | `feat(jj-isolation)`: graft classification and attribution |
| `a893556199e3` | `docs(jj)`: exactly which invocation paths are fenced |
| `6da5f9956a5c` | `docs(jj)`: the live migration plan |
| `726302a6490a` | `test(jj-isolation)`: folded-slot migrations move nothing above them |

Patch: `/private/tmp/jj-isolation-rollout.patch`.

Landing as one revision instead of eight is a single `jj squash` away, but that
rewrites these commits, so it is left as the operator's choice rather than done
unasked.

## Rollout sequence

Each step is independently reversible and none rewrites history.

1. **Land the stack.** No behaviour change on its own: the guard is inert until a
   repository opts in, and the `fix(jj)` commit only stops unintended snapshots.
2. **Install the shim into the DSH process environment.**
   `pnpm run jj:isolation:install --bindir <dir>`, then put `<dir>` ahead of the
   real jj in the environment that launches `dsh` (a devshell/Nix change, not a
   shell rc — see `jj-guard-coverage.md`). Confirm with
   `jj-isolation preflight`: it reports every long-running jj process.
3. **Enable per repository, not globally.** `{"version":1,"base":"integration-spine"}`
   at `<workspace>/.jj/jj-isolation.json` or once at the store level
   `<store>/jj-isolation.json` (the store file covers every added workspace — a
   gap the tests found). Refusals arrive on stderr with a code and a documented
   override; a false positive here is a bug report, not a wall.
4. **Restart is required for the `jujutsu` host only**, because it memoizes the
   resolved jj path per process (`host.ts:52`). That restart is the user's call.
   Until then the old host is unaffected and unfenced.
5. **Migrate the live workspaces** with the plan in
   `migration-plan-live-2026-10-12.md`, under an armed maintenance fence, one
   workspace at a time, verifying the printed digest and head report after each.
6. **Verify and keep the rails:** `pnpm run test:jj-isolation` in the repo's gate
   lane (CI cannot run it — the workflows have no jj), and `preflight` before any
   future history work.

## Safety status

Fenced today, once steps 1–3 are done and the host has restarted: every jj
invocation that resolves through the DSH process `PATH` — the agent bash tool,
managed background jobs, `@dshfiles/jujutsu`, `@dshfiles/jj-integration`,
`@dshfiles/project-checks`, the core workspace-restore controller, and the repo
scripts.

Not fenced, and must be treated as live writers:

- the **VisualJJ `jj branching server`** (two processes were running throughout
  this investigation; absolute path to its own bundled jj);
- **`jjw`**, whose Nix wrapper hard-prepends the real jj — this is why the
  sweep's `--prove-clean` snapshot is guarded only by the sweep's own gate;
- VS Code terminals, where VisualJJ prepends its own bin ahead of any shim;
- `jj-view` (absolute `binaryPath`), other VS Code jj extensions, pre-existing DSH
  instances on other ports, and any absolute-path invocation.

Also unfenced until the host restarts: the live `@dshfiles/jujutsu` panel.

The migrator deliberately does not depend on the shim: it re-derives the fence,
the foreign-descendant precondition, the graft and the dirt signal itself, and
verifies the directory digest, the foreign heads and the leaf property afterwards.

## Test evidence

- **34/34** jj-isolation tests, real jj repositories, multi-process for every
  concurrency case, no mocks: guard 5, isolation 21, migration 8.
- **The bug, unfixed, loses all 18 files** in the "S3 control" test, so the
  refusal is proven load-bearing rather than assumed.
- **15/15** existing `@dshfiles/jj-integration` vitest tests, `tsc --noEmit` clean.
- **The rollout patch applies to a pristine checkout of live `main` and 34/34
  pass there**, so it does not depend on this clone's state.
- Four defects were found and fixed by these tests during preparation: a refusal
  that still executed; `-m` message text parsed as a revset target; a workspace
  "repin" that appended a second `--revision` (which would have created a merge);
  and per-workspace enablement that never covered added workspaces.

## The action that needs approval

**Approve or reject running the live migration**, specifically: install the shim
into the environment that launches `dsh`, arm the maintenance fence, and run the
four per-workspace migrations in `migration-plan-live-2026-10-12.md`.

Two decisions inside that:

1. `agent-comm-audit` — accept the single grafted path
   (`docs/jj-history-consolidation.md`, attributed to `83bbf929`) with
   `--accept-graft`, or discard the slot's content with `--mode reset-to-base`.
2. Whether to restart the live `dsh` instance so the `jujutsu` host picks up the
   shim. Without it, the panel stays an unfenced writer; the migration itself does
   not need the restart.

Nothing in this rollout touches `main`, `integration-spine`, another agent's
workspace, or the operation log, and none of it runs until that approval.

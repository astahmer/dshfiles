# Unified spine closeout — 2026-10-11

Objective: collapse every revision above `xspqskqt/0` (`main`) into a single
line of descendants, keeping live work and dropping only empty revisions and
duplicates.

Result: `main` → this commit → `integration-spine`. One head, no conflicts,
all 30 workspaces on the line, merged tree installs, typechecks, builds and
tests green.

## How it was built

- Canonical set = descendants of `main` that are ancestors of a live workspace
  working-copy commit (26 workstreams). Everything else was a stale copy: the
  `duplicate 163 commit(s)` explosion, its rebased twins, and the divergent
  `xspqskqt/4` subtree.
- Each kept change was re-created on the growing tip with `jj duplicate`, so
  hole-filling rewrites by earlier steps (and concurrent writers) could not
  invalidate the plan. Workspace working-copy commits were rebased so every
  workspace rides the unified line instead of being reset.
- 20 conflict roots were resolved: unions where the two sides added distinct
  content (Gherkin scenarios, catalogue failure modes), `:ours` where the line
  already carried a newer implementation of the same change, and one hand merge
  in `tooling/dshx/packages/dshx/src/project/boot-profile.ts`
  (`PrepareBootProfilesOptions` gained `additionalBundleIds` alongside
  `includeSourceProfileBundles`).

## Final state

- `main` = `xspqskqt/0` (`e4cf4d45…`), divergence resolved.
- `integration-spine` = tip of the line; the `default` workspace sits on it.
- All 30 workspaces sit on the line.
- `heads(xspqskqt/0::)` = 1, `conflicts()` = 0.

## Merged-tree wiring fixed after the collapse

- `@deepseek-ai/dsh-api-session-controller` is local-linked again in
  `plugins/pnpm-workspace.yaml`, `plugins/@dshfiles/dsh-core-runtime`, and
  `tooling/dshx` (+ `tooling/dshx/packages/dshx`): the checkout's client
  contract (`attention`, `updateAttention`, workspace restore) is newer than
  the published `0.2.0-rc.2`, and the plugins type against it.
- `plugins/pnpm-lock.yaml` and `tooling/dshx/pnpm-lock.yaml` regenerated;
  `--frozen-lockfile` installs pass.
- `@dshfiles/thread-sidebar` header-action fixture cast fixed for the merged
  props type.
- `@dshfiles/shared-runtime` gained the `test` script (+ `vitest`) the
  workspace contract requires, and the junk self-referential symlink
  `tooling/dsh-core/api-session-controller/lib` that the merge carried is gone.

## Verification (on the merged tip)

- `pnpm --dir plugins run contract` — pass.
- `pnpm --dir plugins run typecheck` — pass.
- `pnpm --dir plugins run build` — pass (all 30 bundles).
- `pnpm --dir plugins run test` — pass, exit 0.
- `pnpm run lint` and `pnpm run fmt:check` — fail at the repository baseline
  (270 lint files / 148 unformatted files; only 19 and 13 respectively sit
  inside this merge).

## Machine-local artifact caveat

`tooling/dsh-core/api-session-controller/lib` is untracked build output of the
vendored core package. It was still the Oct 7 build, so its `.d.ts` lacked the
merged `SessionListMetadata.lastTurnFailureAt`; the local copy was refreshed by
hand for that field. Regenerate it properly — types and the runtime bundle —
with `DSH_SOURCE_ROOT=<canonical deepseek-harness checkout> pnpm run
sync:core-api-session-controller` before relying on the turn-failure projection
at runtime.

## Dropped (recoverable from the op log)

- 331 revisions that were not ancestors of any live workspace: the
  `duplicate 163 commit(s)` copies, their rebased twins, the `xspqskqt/4`
  subtree, and the discarded first-pass line from this cleanup.
- Conflicting duplicate variants whose content the line already carried.

## Recovery

- Before any of this surgery: `jj op restore 75d87622239f…`
- After the first-pass line, before the collapse: `jj op restore 3b5778e64dcf…`
- Abandoned revisions stay reachable from the operation log until GC.

## Post-closeout fork cleanup and revision split

The `jj describe` pass that named the workspace checkpoints forked the line
above `7f349f07` (`command-palette-enhance` `@`) into three parallel chains.
Two of them were content-identical duplicates of the default-`@` chain: every
matching change-id pair (`ylsslysq`, `vxuzkuwo`, `rzttvvtu`, `lsmwnqww`,
`mvtzprwu`, `vukyuxtm`) diffed to 0 files. Collapsed 2026-10-11:

- Abandoned the 17 revisions in `xspqskqt/0:: & ~::9c018344…` (the two duplicate
  chains plus an extra empty `wip` slot); no workspace `@` sat on any of them,
  so no working copy was invalidated.
- Resolved the three-way `integration-spine` bookmark conflict to a single
  target; the hidden divergent copy `vukyuxtm/39` is now unreferenced.
- Split the single tip revision into five logical revisions, bottom to top:
  local `api-session-controller` relink + regenerated lockfiles;
  `shared-runtime` test script; `thread-sidebar` fixture cast; removal of the
  stale self-referential `api-session-controller/lib` link; this closeout.
- Tree-equality gate before this record was appended: `jj diff --from
  9c018344… --to <split tip>` = 0 files, so the merged-tree verification above
  describes the code tree exactly; only this README differs from it now.

Recovery: `jj op revert c3578c66203d` plus the following ops undoes this cleanup
step by step; `jj op restore ca737a5c7b5f…` returns to the three-chain state
(before the cleanup, 19:19:19 — also discards any other agent's ops since then).
`jj op revert 8b2ba8af6db5` and later restores the single unsplit tip revision.

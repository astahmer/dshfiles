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

## Second consolidation — 2026-10-11 (late session)

The line forked again after the closeout above. Two whole copies of the trunk
existed above `main` — one clean and one carrying `.jjconflict-*` materialized
conflict artifacts in every commit — plus 13 strand heads and 215 stale copies,
for 501–732 visible descendants of `main` and 36–83 heads.

Result: one line, one head, zero conflicts, 42 live workspaces on it, no
duplicate change-ids.

### How it was built

- Canonical chain = the single longest path above `main` (139 commits). Every
  other live commit was deduplicated **by change-id** against it; the 145
  off-line change groups reduced to 6, all empty, so no non-empty change was
  dropped.
- 31 unique changes not in the canonical chain were rebased onto its tip with
  `jj rebase -s` (`jj rebase` drops inherited `.jjconflict-*` entries because
  they cancel in the change diff; a git patch of the same commit does not).
- Conflicts resolved by hand, oldest first:
  - `plugins/@dshfiles/thread-sidebar/dshx.features.json` — union: the line's
    newer catalogue plus the restored `thread-list-views` (with the new
    `custom-views`/`viewPresets` entries) and `session-header-actions`
    features that `9f6ce49c` had removed as collateral; also restored
    `session-header-actions-unit-toolbar-placement` and
    `thread-children-and-links-unit-thread-mention-token`.
  - `plugins/@dshfiles/agent-communication/{package.json,dshx.features.json,src/live-agent-directory.ts}`
    — union: both dependency sets and both exports
    (`projectRegisteredWorkspace` + `projectDurableSubagentDescendants`).
  - `tooling/dshx/e2e/support/steps.ts` — kept both the 2- and 3-argument
    `isolated plugin composition` step definitions.
  - `plans/settings-search-native-owner/README.md` and
    `plans/thread-search-host-profile/README.md` — took the newer variant of
    each (the recovery/current-workspace text).
  - `plugins/@dshfiles/thread-sidebar/src/client.tsx` — kept the line's
    `data-testid="thread-sidebar-transient-notice"` block.
- 554 stale/duplicate commits were abandoned in one operation; every workspace
  `@` was then stacked at the tip (head slots with `jj rebase -r`, interior
  markers with `jj new` in their workspace), and the three dead workspaces whose
  directories were gone (`agent-communication-overhaul`, `spine-integration`,
  and the temporary `spine-rebuild`) were forgotten.

### Final state

- `main` = `xspqskqt/0` (`e4cf4d45…`), untouched.
- `integration-spine` = tip of the line (single target; the three-way conflict
  is resolved).
- `heads(main::)` = 1, `conflicts(main::)` = 0, duplicate change-ids = 0.
- 42 workspaces, all on the spine (`pnpm run jj:workspaces`: on spine 42,
  off spine 0, conflicted 0).
- Coverage check: 170 distinct changes that existed above `main` before the
  surgery are all on the line; the only off-line non-empty commits were
  duplicates of line commits.

### Remaining, on purpose

- 85 empty commits remain on the line: one slot per live workspace plus the
  older workspace markers the canonical chain already carried. They are single
  markers, not duplicate checkpoints; `pnpm run jj:sweep --apply
  --abandon-empty` drops the orphans once their workspaces are done.
- The `recovery-*` bookmarks (`recovery-20261005`,
  `recovery/unify-20261007/*`, `recovery-disk-20261007/*`) point at lines that
  forked **below** `main`; they are unrelated pre-base refs and were left
  untouched, so they are not part of this line.
- Concurrent agents committed while this ran; their new work
  (`soqqtyozmnsv` "undo through the transient archive notice", `llrtzuno`,
  `vnqkomlt`, `rqnlkvzzwmrn`) was rebased onto the line rather than dropped.

### Recovery

- Before any of this surgery: `jj op restore e6edba261989…`.
- After the 554-commit prune, before the slot stacking:
  `jj op restore e04890fc8d2b…` (this is also the state the session restored to
  after an intermediate mistake; it discards later ops, including the slot
  stacking).
- The abandoned revisions stay reachable from the operation log until GC.
- One mistake worth recording: moving an *interior* workspace marker with
  `jj rebase -r` re-applies every commit above it onto a different parent and
  re-introduced already-resolved conflicts. The safe move for an interior
  marker is `jj new <tip>` **inside that workspace**; only head slots should be
  moved with `jj rebase -r`.

## Follow-up cleanup (same session)

- Swept the 44 orphan empty markers (the line's empty commits that no live
  workspace holds as `@`): `jj abandon <ids>` rebased 171 descendants and left
  the tree byte-identical, so only markers disappeared. Empty commits on the
  line went 86 → 42 (exactly one slot per live workspace).
- Described the 12 non-empty commits that had no description or were still
  `wip` (thread-sidebar vitest config, workspace-folder-picker plan, agent
  communication lifecycle split + descendant projection, settings-search owner
  plan, native header-utility work, archive-notice journey steps, core
  session-controller refresh, probe-profile docs).
- Folded the concurrent agents' tips back onto the line (`jj rebase -r <tip>`);
  the line is single-headed again after each fold. Live agents keep committing,
  so a new tip can appear at any time — that is new work, not a duplicate.
- Change-id coverage check after the sweep: the six change-ids that vanished
  were the line's *empty* copies; every file they touched is present at the tip
  (verified: no duplicate scenario in `thread-sidebar.feature`, no
  `parented-agent` state left in the agent-communication catalogue, lockfile
  present).

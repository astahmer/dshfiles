# DSH unification ledger — 2026-10-07

This is the continuation record for consolidating the last-day DSH work. Update
this file after each integration milestone. A source thread being complete does
not mean its commits are integrated. Do not mark integration complete until the
source-to-copy tree checks and final branch checks below pass.

## Current checkpoint

### Resume checkpoint — 2026-10-07, evening

This subsection supersedes older IDs/status claims below. Work is in
`/Users/astahmer/dev/dshfiles-unified`, thread
`18ba7fff-942f-4f50-86b5-a9f0e135a2be`. The user confirmed the default writer
finished and authorized moving its workspace. No `main` move, push, workspace
forget, or bookmark cleanup has happened in this resume yet.

Completed:

1. Listed all registered workspaces, captured their statuses, and checked T3:
   only this thread was running. Source directories have not been deleted.
2. Duplicated the entire already-linear `main..3a80becd` chain once. Repaired
   copied Citty conflicts only, with per-target preflights. Clean copied tip
   `24cf34722e8047da0cfae927e38b7192a8ebbeb7` has zero conflicted ancestors and
   **an empty full-tree diff** against source
   `3a80becda0e96a463094f831eee5310665270946`.
3. Captured latest default WIP
   `d84e533fd485e7ca51ede6253c11d39ec70d6a41`, duplicated and rebased only its
   copy. Copy `b8f74cc703d4e1e2a3cf15998cc0e2e6b2805e93` has **an empty
   full-tree diff** against that source. Its 18 paths include Workspace Restore
   UI/controller/store/policy and tests. Default remained untouched.
4. Audited source domains. Plugin UI matched source exactly before formatting;
   Settings has later locale/style changes while preserving Host navigation.
   Roadmap-resume feedback has later parent-error and batch-boundary fixes.
5. Found missing continuation work, rather than treating every nonempty diff as
   harmless: cold-restart feedback validation, its scratch fixture, native row
   config handling, Controller bundle composition, and verifier helpers.
   Duplicated/rebased `42cce768..07101e02` (11 revisions) onto the isolated
   spine. Tail tip `3c4e51a17261c4f25c9130a712983da0c7ef3a66` was conflict-free.
   The core-runtime package, scratch verifier, and Host SDK file matched the
   continuation source exactly at that checkpoint, before subsequent repairs.
6. Regenerated the plugin lockfile from merged manifests and completed frozen
   installs. Restored the truncated scaffold test from CLI source; removed an
   unused bridge variable. Reconciled typed Host config with native row config;
   separated Client setup typing from Host Context; preserved both attention
   call forms; added runtime-peer declarations required by the new guard.
7. Fixed `defineHost` schema inference and added type coverage. Fixed the normal
   core bundle build/typecheck scripts to use their dependency-scope wrapper;
   corrected that wrapper to use the plugin package's dependency directory.
8. Restored README feature index and Project Checks README. Ran repository
   formatter. All formatting changes remain reviewable in the current revision.
9. Reused eight local core compiled packages only after source/build-input
   equality. This alone does **not** prove compiled artifacts are current:
   Workspace Restore artifacts were stale and are being regenerated separately.
10. Prepared isolated native source clone at
    `/private/tmp/dsh-unify-controller-source`, based on the previously used
    pinned `/private/tmp/dsh-api-gen-639ed` workspace. Copied current Controller
    source/build configs there. Fixed five incomplete `finally` blocks, unused
    bindings, and a branded Workspace ID error in the local source. Build only
    this modified TypeScript package; do not build the whole DSH workspace.

Measured checks so far:

- DSHX TypeScript check passed after contract repairs.
- Focused Client/Host/config/attention/E2E-contract tests: 115/115 passed.
- Scaffold tests: 22/22 passed.
- Additional build/config/offline-boot-contract tests: 57/57 passed.
- Browser evidence tests: 4/4 passed after downloading official prebuilt
  Chromium headless shell. No native/browser source compilation was used.
- The first broad DSHX run reported 521 passed, 14 failed, 1 skipped. Failures
  included missing browser executable, stale help/API expectations, missing
  runtime peers in scaffold fixtures, and unprepared boot fixtures. Some are
  repaired above; a final bounded rerun is still required. Do not cite the old
  totals as final results.
- Plugin checks have exposed and driven actual repairs; no full plugin pass is
  claimed yet. Latest blocking package was Jujutsu: API schema lost
  `contentDigest`, and Workspace Restore uses a release Controller dependency
  instead of the local generated package. Both source fixes are now applied;
  generated Controller package remains the next gate.

Remaining for this integration, in order:

1. Finish Controller Host/client compile, Typert generation, bundle, guarded
   sync, and its focused Workspace Restore tests. Never hand-edit generated
   output. The old native source failed the guarded source-equality gate.
2. Run plugin build/typecheck/tests and final DSHX focused/broad checks; record
   exact remaining failures. Avoid repeatedly rerunning unrelated known failures.
3. Verify isolated profile composition/boot; leave the live web process alone.
4. Commit focused repairs and formatting separately; scan the final explicit
   ancestry for conflicts, merges, empty revisions and undescribed revisions.
   Remove empty copied revisions only, and require final-tree equality before
   and after this history cleanup.
5. Recheck default has not changed since `d84e533f`. Preserve all source tips,
   old `main`, current operation and bookmark/workspace inventory. Reduce
   temporary bookmarks; forget only accounted-for workspaces, without deleting
   their directories. A stale old squash process was observed waiting in an
   editor; handle it before final history moves to prevent a delayed rewrite.
6. Move `main` to the proven local tip, then make default a clean empty child.
   Reconcile the integration summary and update this ledger with final IDs.
7. Push only after the validation/preservation gates are satisfied. No push has
   occurred. Product acceptance gaps below must remain explicit.

Product acceptance still separate from history unification:

- Phase 1A/1B/1C: a credentialed provider turn, real Cursor side effects, and
  provider restart/recovery remain distinct from synthetic scratch proofs.
- Phase 1D: active-profile attention API/UI and automatic quota wake remain
  gated; the active profile lacks proven Schedule composition.
- Phase 2: parent/child panel and feedback need full installed Host/browser
  acceptance, including cold restart; do not infer that from unit tests.
- Multi-Host: real SSH/process/PTY/LSP/MCP lifecycle, qualified host/workspace UI
  with offline behavior, and production connection semantics remain acceptance
  gates. Keep Pi local 401 versus reported remote 200 discrepancy parked.
- Project Checks: authenticated/native execution and broad verification gaps
  remain as recorded in the software roadmap; do not claim production pass.
- Phase 7 cosmetics remains deliberately deferred, not unfinished required work.
- Native provider plans, creator mode, and unrelated optional additions are not
  authorized implementation work in this unification pass.

Evidence logs and clone/generator commands are under
`/private/tmp/dsh-unify-20261007/`. Retain compact durable results in this file;
these scratch paths are not a substitute for checked-in status.

### Earlier checkpoints (historical, not current)

- Integration workspace: `/Users/astahmer/dev/dshfiles-unified`.
- The integration workspace is now an empty WIP above the latest ledger
  revision. The README feature index is committed at
  `4a644fcf4259d29d72c4dab48b26fb001b990665`; later ledger revisions record the
  tail mapping and current blockers. These documentation commits remain on the
  unifier candidate, not final `main`.
- `main` was last confirmed parked at
  `450fdaef68af6e53eb38793ae5618387c5735a37`. No push has happened.
- The squash operation `3528a1e43755` targeted
  `848eaa5d44c259894db8a4c78b14c8f9d1f501c0`. JJ reported rebasing 148
  descendants and creating 77 conflicts. The later default-workspace recovery
  surfaced five Citty-chain conflict copies again. Do not assume earlier
  conflict resolutions survived that rewrite.
- The exact pre-rewrite default snapshot is
  `bd5276d384884eb822bd546605e5424db7d15f33` (parent
  `3a80becda0e96a463094f831eee5310665270946`), now pinned by
  `recovery-unify-20261007/default-original-bd5276d3`. The conflicted copy
  `98c3b2645f215c5bd919f73ba1e1b5d74e894ebd` remains pinned separately. The
  default workspace has since advanced again: the latest captured `@` was
  `9ebbe37e6c9be10c002c657c9deda51c6035dcfd`, pinned by
  `recovery-unify-20261007/default-current-9ebbe37e`. Its latest status listed
  eight API-session-controller paths (package, index, types, restore controller
  and policy, remote test, policy test, and host tsconfig). Preserve this newer
  WIP too; the default tree changed during read-only audits, so do not rewrite
  it until its owner confirms it is settled.
- `software-roadmap-resume@` remains at
  `69a2e31feee645bffa1b78fd58445d974a0b9b79`. Its ten-path WIP tree still
  matches that saved snapshot exactly; preserve it for integration.
- The stale `software-roadmap` registration/ref at
  `2f11aaca324e817ff215f1956b5b718dd1f9acea` is preserved. It was previously
  established as an ancestor of roadmap tip `09819c14572bd6a4649fd47b78992c5f8c8a8339`;
  do not integrate it twice or forget its record.
- The OpenCode Go local 401 discrepancy is parked. No more auth diagnosis is in
  this work. The remote 200 report is not a substitute for other acceptance
  evidence.

## Work already completed or preserved

### Source work and recovery

- Source writers reported terminal, clean revisions for the supplied tips
  below. Their implementation and reported focused checks are retained in JJ.
- Foreign-workspace commits were duplicated before integration, and recovery
  bookmarks were made for source tips, candidate checkpoints, and previous
  conflict resolutions. This leaves considerable temporary bookmark noise; do
  not prune it until final proofs pass.
- The earlier Settings Search conflict was semantically resolved in copy
  `715fc82ea61f089c09a8e40102e3d3b3774dc227`, retaining the candidate
  implementation that routes through Host target navigation and the newer
  centralized DSHX slot catalog. The latest rewrite may have reintroduced a
  conflicted descendant; re-check before claiming it is resolved.
- Earlier source-to-copy checks passed for the Settings source
  `a1ba45921f699a75c85d20fd3f27b6da7b6cddce` and copy
  `853ff0cc752c5b81f590c4db0810f36297dd8c92`. Those checks predate the latest
  rewrite and must be repeated on the final copies.
- The DSHX live Inspect plan correction `de75a59201bede42e5f9fb658ce2ea4f204896ad`
  is part of the supplied source set and must remain represented.

### Documentation and profile work already drafted

- README revision `4a644fcf4259d29d72c4dab48b26fb001b990665` now indexes all
  21 owned bundle/shared-library packages plus the local dshx fork, and links
  this ledger. Reconcile it onto final `main` and recheck package claims. A
  branch-integration summary was drafted earlier; find/reconcile its saved
  revision after the candidate chain is stable.
- The web and probe profile manifests were previously observed to include
  `@dshfiles/multi-host` through a local `link:` dependency and a bundle entry.
  The web profile resolves to the repository-local bundle path.
- Node `22.23.3` and pnpm `12.5.1` were previously verified with fnm. The profile
  install, composed-config check, bundle-list check, and scratch-profile boot
  still need a post-integration run.
- The live DSH instance on `127.0.0.1:3080` must not be restarted, reloaded,
  killed, or otherwise interrupted. Use the isolated `probe` profile and a
  separate port for boot evidence.

## Source revisions to account for

For each source tip, record the full integrated-copy tip next to it and run a
**direct** source-to-copy tree comparison. A source status of “complete” is not
proof of integration.

| Workstream | Full source tip | State / required proof |
| --- | --- | --- |
| CLI parsing | `8122ebf0ceeb5e77d1b3d92e37749f6112d1683b` | Source thread terminal; reported focused tests, typechecks, build, lint, and format passed. Re-map and compare after the latest rewrite. |
| Multi-Host | `49d58dd578a15f87ef85fd6a7639fe75923825de` | Source thread terminal and workspace clean at last audit. Re-map and compare; keep acceptance gaps distinct. |
| Main software roadmap | `09819c14572bd6a4649fd47b78992c5f8c8a8339` | Source thread terminal. Includes stale `2f11aaca…` ancestor; compare the full tip. |
| Roadmap continuation | `07101e02c2749e9a851694460e91580aea6bbdb8` | Source workspace had an empty WIP above this tip. Compare the source range and preserve its unique work. |
| Roadmap resume WIP | `69a2e31feee645bffa1b78fd58445d974a0b9b79` | Ten-path WIP, tree preserved. Integrate its exact snapshot; do not discard the WIP. |
| Roadmap core | `74167fd156666d7117c3195985543dc2a61f8e84` | Source workspace clean at last audit. Re-map and compare. |
| Roadmap delivery | `a24ed026812c3417be496264a86de412a33b464c` | Source thread terminal. Re-map and compare. |
| DSHX final docs correction | `de75a59201bede42e5f9fb658ce2ea4f204896ad` | Preserve the exact correction and verify the copied tip. |
| Audit / sidebar | `2cf31e3862ccf23a89e68cd7fc74ba85cd153451` | Source thread terminal. Re-map and compare. |
| Plugin UI mainline | `453be706c051e936588c4fdb0d9d525f1423c8fb` | Source workspace clean at last audit. Re-map and compare. |
| Plugin UI plan | `f5eb1440e7a5deace9b27ed6794632b498036d6b` | Source workspace clean at last audit. Re-map and compare. |
| Settings navigation | `a1ba45921f699a75c85d20fd3f27b6da7b6cddce` | Source workspace clean at last audit. Re-map and compare. |
| Evaluation candidate | `853ff0cc752c5b81f590c4db0810f36297dd8c92` | Preserve candidate and compare directly after the latest rewrite. |
| Default API-session WIP | `bd5276d384884eb822bd546605e5424db7d15f33` | Six-path WIP restored exactly. Duplicate and integrate without changing the source workspace. |

## Latest bounded tree and topology checks (2026-10-07)

- Selected spine: `331462405e5d443cd93b735a303588722a47257f`. It is an ancestor
  of default parent `3a80becda0e96a463094f831eee5310665270946`; the latest
  default WIP is therefore on that spine.
- The two saved tail sources are `eb89f2ba4bf0e14bcbbc355aef5ec693286e5ca7`
  and `50d1b88a60610d27cec40df645aa46695928c7ee`. Their exact-copy snapshots
  are `ed575457cb36c430f2fbcb8838743b05ea78235e` and
  `0102a3336a9c74ae5541a75ce718d7eb6297060e`. Each source-to-exact-copy direct
  `jj diff --ignore-working-copy` was empty.
- Both sources share parent `a26bf3165ec65bffc4eeb96e0a1bc1045531512f`. Their
  nearest common ancestor with the selected spine is
  `5869da962299055dd71376a14bf8c20712875200`. Each base-to-tip range contains
  166 commits, so account for the shared prefix once and do not duplicate both
  full ranges independently.
- Both exact-copy snapshots and integrated WIP
  `91190c3b8d2568b852dbb6e07e033a020f497369` still report a two-sided conflict
  in `tooling/dshx/packages/dshx/src/cli/args.ts`. The narrow ancestry checks
  show `91190…` contains `0102…`, but contains neither `ed575…` nor spine
  `331462…`. It is not a valid unified tip.
- Full-ID preflight on the existing `ed575…`, `0102…`, and `91190…` copies
  showed a large fan-out of divergent descendants across roadmap, plugin UI,
  Multi-Host, and DSHX work. No rebase followed these preflights. Do not rewrite
  those existing copies; isolate a fresh duplicate range after the shared range
  is mapped.
- The latest default snapshot captured immediately after preflight is
  `9ebbe37e6c9be10c002c657c9deda51c6035dcfd` (eight listed WIP paths). It is
  pinned separately from the original `bd5276…` snapshot. No source workspace
  was rewritten after this capture. Recheck only when its owner says it is
  settled.
- Settings source `a1ba45921f699a75c85d20fd3f27b6da7b6cddce` to copy
  `853ff0cc752c5b81f590c4db0810f36297dd8c92` still has an empty direct diff,
  and the copy has no conflicts.
- Plugin-UI mappings are not proven: comparing plan source
  `f5eb1440e7a5deace9b27ed6794632b498036d6b` to guessed copy `6f1ae0c8`
  produced a large non-empty diff and 11 conflicts. Comparing mainline source
  `453be706c051e936588c4fdb0d9d525f1423c8fb` to combined candidate `064406ba`
  also produced a large non-empty tree (714 files); that is not an exact-copy
  proof. Find the exact copied revisions before further claims.

## Remaining work — in order

### 1. Stabilize the candidate without touching source work

- [ ] Take one fresh `jj workspace list` and `jj status` snapshot for every
  registered relevant workspace immediately before the next history edit.
- [ ] Record the current operation ID and exact full candidate/source commit IDs.
- [ ] Identify the latest selected integration spine. An earlier note refers to
  prefix `33146240…`; recover its full ID from the saved integration record
  before using it.
- [ ] For the two default tails, account for their shared 166-commit range
  from `5869…` to parent `a26…` once, then isolate the two tip changes. Do not
  rebase the existing conflicted copies with broad descendant fan-out.
- [ ] Reconfirm each other source range’s common base with a tested expression
  (`ancestors(source) & ancestors(candidate)`); do not use the unsupported
  `common_ancestors()` revset.
- [ ] Run `jj-rewrite-preflight` with full IDs before every history rewrite.
- [ ] Duplicate only unique foreign-workspace ranges. Keep the originals and
  all current recovery bookmarks until equality checks pass.

### 2. Resolve the current Citty conflict chain

The latest reported conflict copies all concern
`tooling/dshx/packages/dshx/src/cli/args.ts`. Resolve oldest-first, preserving
both the accepted metadata-derived CLI implementation and unique source changes.
The affected original full commit IDs are:

1. `848eaa5d44c259894db8a4c78b14c8f9d1f501c0` — derive CLI metadata from Citty
2. `2d75372cc41848f9a4e67ff67329eab75a9b2ce8` — generate CLI usage with Citty
3. `e986977f42951b37937ca62932cba89a31560d44` — Chokidar project watching
4. `9c7d950e3cba9dede67e1270aa8bee1babdd2e00` — Unix JSON-line bridge transport
5. `769ce9ab35cdb5a10b0da21b70cd21ff036d7522` — Citty help and watch events

These IDs are the original commits; the current conflicted copies must be
looked up by full commit ID before resolving. The previous resolution of the
first commit did not survive as a clean final chain. Resolve one oldest commit,
verify it, then re-scan descendants. Do not restart the broad rebase.

### 3. Finish source integration and prove preservation

- [ ] Reconcile the roadmap-continuation and roadmap-resume tails with the
  selected spine, including the unique session/agent-questions work.
- [ ] Integrate the default API-session WIP and all remaining source ranges in
  the table above. Keep the default source WIP recoverable until its copy is
  proven equal.
- [ ] For every source/copy pair, run
  `jj diff --ignore-working-copy --from <full-source-tip> --to <full-copy-tip>`
  and require empty output. Record both IDs and results in this file.
- [ ] Re-scan the candidate for conflicts, including hidden/divergent copies;
  `all() & conflicts()` alone was previously insufficient for hidden commits.
- [ ] Verify every integrated source tip is in the final `main` ancestry.

### 4. Finalize the branch and documentation

- [ ] Prove the candidate is a single linear chain; inspect
  `jj log --ignore-working-copy -r 'main::@' --no-graph`.
- [ ] Only after all source-tree and conflict checks pass, move `main` once to
  the proven tip, then make default `@` an empty, clean child of that tip.
- [ ] Reconcile the README feature index and branch-integration summary onto
  the final branch. Keep the README concise and link detailed material under
  `docs/`.
- [ ] Update the “completed” and “remaining” sections in this ledger with final
  commit IDs and actual validation evidence.

### 5. Verify the Multi-Host web profile

- [ ] Inspect `~/.dsh/profiles/web/package.json` and its diff; retain the local
  `link:` dependency and bundle entry for `@dshfiles/multi-host`.
- [ ] Install using fnm Node `22.23.3` and the profile’s pnpm 12 toolchain.
- [ ] Run the profile’s supported composition/config and bundle-list checks.
- [ ] Boot only `probe` with isolated `DSH_HOME` and a port other than `3080`;
  capture startup output and verify the plugin activation. Do not expose the
  protected credential value.
- [ ] Report that the live `web` profile needs a user-controlled restart only
  if its manifest composition cannot HMR. Do not restart it.

### 6. Clean JJ noise, then push

- [ ] After final ancestry and source-tree proofs, classify every recovery
  bookmark and workspace as: integrated source, necessary recovery point, or
  temporary duplicate. Preserve at least a recovery point for the old `main`
  and the final integrated tip.
- [ ] Forget a source workspace only after it is clean and its source tip’s
  integrated copy has passed tree equality. Keep the stale `software-roadmap`
  registration/ref until its path and ancestry are documented.
- [ ] Delete temporary duplicate/recovery refs only after proving their trees
  and changes are represented in `main`; do not prune commits by change ID.
- [ ] Push the verified linear `main` to `https://github.com/astahmer/dshfiles`
  after integration, documentation, profile validation, and cleanup are done.

## Parked or limited evidence

- Multi-Host’s Pi credential had a reported remote HTTP 200 and loaded-key
  check, while the local alias probe reported HTTP 401. Do not spend time on
  that discrepancy in this integration pass; retain the documented acceptance
  gap and do not mutate Secret values.
- The roadmap thread reported that Project Checks did not start and broad
  `pnpm check` stopped on two existing Knip smoke-script findings. Do not claim
  those checks passed or invent live acceptance.
- Multi-Host P4/P5 acceptance and any live profile activation not proven on the
  isolated probe remain unverified.

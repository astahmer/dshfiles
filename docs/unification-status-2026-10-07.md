# DSH unification status — 2026-10-07

This is the canonical completion and remaining-work list for thread
`18ba7fff-942f-4f50-86b5-a9f0e135a2be`. Update this file when a gate closes.
Historical checkpoints are [archived separately](archive/unification-checkpoints-2026-10-07.md).
A preserved implementation is not a production acceptance claim.

## History consolidation

- [x] Preserve the finished default writer, including final Workspace Restore safety changes and reproducible local-source Controller generation.
- [x] Duplicate the settled linear parent into the integration workspace, repair copied conflicted ancestors, and prove full-tree equality against `3a80becda0e96a463094f831eee5310665270946` at clean copy `24cf34722e8047da0cfae927e38b7192a8ebbeb7`.
- [x] Duplicate the default restore implementation; exact tree equality passed against `d84e533fd485e7ca51ede6253c11d39ec70d6a41` before final writer changes were folded in.
- [x] Integrate missing continuation range `42cce768..07101e02`: cold-restart feedback verification, native row config setup, Controller composition, and scratch helpers.
- [x] Compare Plugin UI source directly; retain newer roadmap-resume error/batch behavior rather than reverting to its earlier draft.
- [x] Restore the truncated CLI scaffold test and Project Checks README; retain the newer README catalog.
- [x] Reconcile Host/Client setup types, schema inference, both attention call forms, runtime peers, and dependency scope.
- [x] Regenerate merged plugin lockfile; frozen installs pass.
- [x] Separate 63 formatter-only paths into a described style revision.
- [x] Remove 137 empty copied revisions with per-target preflights; full-tree equality before/after passes.
- [x] Cancel the historical JJ squash process waiting in an editor, preventing a delayed rewrite.
- [x] Preserve raw source tips, old main, bookmark targets, operation checkpoint, and workspace inventory in the [recovery manifest](jj-unification-recovery-2026-10-07.json).
- [x] Delete 537 temporary unification bookmark names. Retain raw source recovery refs and unrelated refs.
- [x] Forget six finished source workspace registrations; retain their directories and source revisions.
- [x] Move main and default to the final documented local tip; default is verified as an empty child.
- [x] Forget the completed integration workspace registration after default moves; retain its directory.

Closeout topology: **162 described revisions beyond old main, zero conflicts, zero merges**.
Bookmark names: **544 → 24** (537 temporary names deleted after adding 17 bounded raw-source/old-main refs).
Registered workspaces: **8 → 1**, default only. Physical source directories remain.

## What is implemented and preserved

| Area | Included work | Proof boundary |
| --- | --- | --- |
| DSHX | Citty CLI, SDK Host/Client ownership, scaffolds, profile checks, native contract inspection, build guards, runtime peers, typed schema config, attention APIs, local hard fork documentation | Current typecheck and focused tests pass; broad test failures listed below |
| Core runtime | Local Agent/AgentLoop/Session and JSONL V5 migration chain; explicit driver binding, recovery receipts, history replay, attention sidecar and local Session Controller | Synthetic isolated Host acceptance; no credentialed provider claim |
| Workspace restore | Host-owned prepare/confirm/status, bounded path preview, overlap/owner/symlink guards, interruption recovery, durable receipts and UI | 13 focused tests pass; browser acceptance remains |
| Agent questions | Parent-scoped questions, recommended/deferred expiry, safe durable Markdown files, revisioned feedback and receipts | Unit and historical scratch evidence; full installed browser/cold-restart acceptance remains |
| AI Accounts | Provider routes, account setup, usage/quota views, durable quota continuation and manual resume, known-reset scheduling port | Local tests/build and historical scratch proof; active Schedule/browser gates remain |
| Multi-Host | Qualified runtime/workspace identity, SSH connector, directory/CLI, reliability and native remote view | Historical P1–P3 live evidence retained; P4/P5 limits below |
| Plugin UI | Shared components and Query/Table/Form/Charts bindings; consumers migrated | Direct source comparison and package tests; combined browser proof separate |
| Daily UI | Thread sidebar, MCP management, secrets, Jujutsu graph/forks, prompt stash, queue reorder, sidebar commands, shortcuts, marketplace, folder picker | Source preserved; native contract failures below override older boot claims |
| Review/checks | Exact-content review state, trusted Project Checks, receipts and native hook results | Fractional hook-duration source restored after reproducing regression |
| Agent communication | Durable topic/direct communication with explicit ownership | Preserved implementation and prior profile proof |
| Adopted candidates | Search, context/skills visibility, GitHub picker and other scoped adoption work | Exact versions and earlier acceptance receipts remain in the software roadmap |

See [feature catalog](../README.md), [integration summary](branch-integration-summary-2026-10-07.md), and [software roadmap](../plans/software-additions-roadmap.md) for individual capabilities.

## Current measured validation

Logs: `/private/tmp/dsh-unify-20261007/`. These are local diagnostics; the results here remain durable if those logs expire.

| Check | Result |
| --- | --- |
| DSHX typecheck | Passed |
| Focused SDK/config/attention/E2E contracts | 115/115 passed |
| Scaffold tests | 22/22 passed |
| Additional build/offline boot contracts | 57/57 passed |
| Browser evidence reporter | 4/4 passed with official prebuilt Chromium headless shell |
| Final broad DSHX | 49 files passed, 3 failed; 528 tests passed, 8 failed |
| Controller generation | 166 ignored outputs generated from local source overlay using pinned Typert and native build tools; SHA-256 `b1bb500e9c524a65bbc40fc274790a98af27d24152a059c7f8495d998342fa71` |
| Controller Workspace Restore | 2 files / 13 tests passed |
| Core scratch Host | Public CLI create/list/read, V4 migration worker, attention projection and SIGKILL recovery/reconciliation all passed; no activation failures |
| Plugin typecheck excluding Settings Search and Thread Sidebar | Passed for the remaining packages |
| Plugin build | Settings Search and Thread Sidebar blocked by native contracts; other completed builds recorded; Secret Catalog verified separately after recursive cancellation |
| Script typecheck | Passed |
| Root lint | Completed with warning-only antislop findings |
| Root formatter | Final check passed on 612 files |
| Project Checks | 2 files / 6 tests passed after source restoration |
| Plugin tests excluding Settings Search and Thread Sidebar | Completed with two failing packages: Prompt Stash and Jujutsu; no full-suite pass claimed |
| Full combined profile / production | Not proven by this integration; blocked by native seams below. Live DSH was not restarted or changed |

Known native Client declaration diagnostic: `sessions` is declared as both native `SessionStore` and Controller `ISessions` (TS2717). The generation script tolerates only that exact pinned diagnostic and rejects other errors. This is not a full native Client typecheck pass.

## Remaining engineering gates — finite queue

1. **Settings Search Host capability:** installed DSH 0.2.0-rc.2 runtime and declarations both lack `SettingsSectionOwnerProps.openSettingsTarget` and `SettingsNavigationTarget`. Add the real native seam or choose a supported product behavior. Do not use casts, module augmentation or state mutation to pretend it exists. Then build/typecheck and run an isolated browser navigation check.
2. **Thread Sidebar contract coherence:** local Controller summaries include attention, but native Workspace UI/Client Store still expose the release summary without attention. Resolve the native client composition/type contract as one coherent graph, then build/typecheck and verify read/snooze/UI behavior. Merely linking one package does not update the native Workspace UI contract.
3. **DSHX public API test:** `tests/api.spec.ts` rejects public `apiChannel`, which the current public module exports. Establish intended export contract and reconcile source/test; preserve real consumers.
4. **DSHX contextual help tests:** six `tests/authoring-cli.spec.ts` cases expect the old global “add targets” sentence from target-specific help. Verify each intended command help contract and update implementation or expectations accordingly.
5. **DSHX test CLI:** `tests/sdk-cli.spec.ts` expects project-local test exit 7 but gets usage exit 2 for `test --file`. Reproduce focused, repair command/flag routing, and retain exit propagation coverage.
6. **Plugin tests:** final no-bail run excluding Settings Search and Thread Sidebar leaves two observed failures: Prompt Stash `src/recent-prompts.test.ts` drops the multiline first prompt; Jujutsu `src/core.test.ts` expects diff rows without the now-returned `contentDigest`. Reconcile intended contracts with focused regression checks. Project Checks now passes 6/6 after restoring the continuation’s fractional native hook-duration schema. Other selected package tests completed.
7. **Native Client typing:** resolve the pinned TS2717 `sessions` augmentation collision rather than broadening the generator's diagnostic exception.
8. **Fresh checkout generation/setup:** verify `install:all`, local dependency preparation, Controller source-overlay generation and build in a clean consumer checkout. Generated `lib/` is ignored; tree equality alone cannot prove it is current.
9. **Combined isolated profile:** after native seam gates close, compose the complete profile, inspect offline IDs, capture stdout activation results, and run authenticated browser smoke on a second port/scratch home. Never restart live `:3080`.
10. **Release gate:** complete root checks, dependency audit/Knip, combined boot and browser checks, then push/promote deliberately. No push or live-profile promotion happened here.

## Remaining product acceptance

These are separate from a clean local JJ history. Existing receipts are retained; do not rerun established lower layers without a new reason.

- **Phase 1A–C:** credentialed provider turn; real Cursor side effects; real provider restart/recovery and ordered history replay; cross-provider resume/handoff and context-budget acceptance. Synthetic drivers do not close these gates.
- **Phase 1D:** generated Client/Remote attention integration and active-profile UI; Schedule composition and actual automatic quota wake; manual/unknown-reset behavior in an authenticated browser. Attention-ahead and Session-first SIGKILL windows already have focused evidence; cross-store atomicity is not claimed.
- **Phase 2:** installed panel/evidence/parent-child feedback journeys, including human answer, expiry/defer and cold restart; revision collision, permission, source identity and exactly-once delivery. Durable unit storage checks do not close browser acceptance.
- **Phase 3:** fresh candidate combined acceptance for search/drafts/context/skills/review; authenticated native Project Checks and failed/skipped hook attribution. Missing Host skipped-hook identity remains a Host limit.
- **Phase 4:** dock/move/split/tab/float layouts, keyboard reset and missing-plugin placeholders; revisioned Markdown and visual feedback; failed/cancelled evidence replay, assertion truthfulness, artifact retention/reopening, responsive/reduced-motion checks. Do not claim an implemented dock Host seam where none exists.
- **Phase 5A:** one real provider adapter pair, ordered queued switch, handoff timeline, resume/return, capability-aware delegation and budget behavior.
- **Phase 5B:** isolated JJ setup/launch and selected-boundary forks in an installed browser; live rebind requires native support; organizational links must not grant parent authority.
- **Phase 5C:** linked PR status, deduplicated authorized wakes, cancellation and quota recovery in the actual scheduler/profile.
- **Phase 5D:** Workspace Restore browser prepare/confirm/status, truncated-preview refusal, interruption/recovery and competing workspace ownership; distinguish filesystem restore from conversation-only rewind.
- **Multi-Host P4:** approval, upload, terminal interaction and popup close/reopen browser flows; reconcile deployment Go-models HTTP 200 versus local-alias HTTP 401 before claiming provider/model acceptance.
- **Multi-Host P5:** verify durable deployment ownership, declarative service, upgrades/rollback and daily-profile activation. Historical source reports do not prove the current deployment.
- **Phase 6:** conditional only after measured unmet demand; LSP peer mismatch and Host maintenance/rebind seams remain limits. No speculative expansion is required for unification.
- **Phase 7:** cosmetic polish remains deferred behind functional acceptance.
- **Boot/E2E portability:** fresh clone browser provisioning, healthy/failed/pending profile smoke, user-visible send/reply/queue journey and stable native boot-state hook. Existing locale/boot/evidence implementation must be checked against these acceptance contracts, not rebuilt because an old plan has unchecked boxes.
- **Desktop shell / own provider route / reference feature inventory:** separate conditional proposals, not additional unification work. Keep ownership and credential decisions in their own plans.

## Recovery and future integration discipline

Raw source references below survive consolidation. Superseded drafts remain recoverable even where a newer implementation was retained. Do not delete source directories or run GC as part of this cleanup.

| Workstream | Raw source revision | Recovery bookmark |
| --- | --- | --- |
| CLI parsing | `8122ebf0ceeb5e77d1b3d92e37749f6112d1683b` | `recovery/unify-20261007/source-01` |
| Multi-Host | `49d58dd578a15f87ef85fd6a7639fe75923825de` | `recovery/unify-20261007/source-02` |
| Main software roadmap | `09819c14572bd6a4649fd47b78992c5f8c8a8339` | `recovery/unify-20261007/source-03` |
| Roadmap continuation | `07101e02c2749e9a851694460e91580aea6bbdb8` | `recovery/unify-20261007/source-04` |
| Roadmap resume WIP | `69a2e31feee645bffa1b78fd58445d974a0b9b79` | `recovery/unify-20261007/source-05` |
| Roadmap core | `74167fd156666d7117c3195985543dc2a61f8e84` | `recovery/unify-20261007/source-06` |
| Roadmap delivery | `a24ed026812c3417be496264a86de412a33b464c` | `recovery/unify-20261007/source-07` |
| DSHX final docs correction | `de75a59201bede42e5f9fb658ce2ea4f204896ad` | `recovery/unify-20261007/source-08` |
| Audit / sidebar | `2cf31e3862ccf23a89e68cd7fc74ba85cd153451` | `recovery/unify-20261007/source-09` |
| Plugin UI mainline | `453be706c051e936588c4fdb0d9d525f1423c8fb` | `recovery/unify-20261007/source-10` |
| Plugin UI plan | `f5eb1440e7a5deace9b27ed6794632b498036d6b` | `recovery/unify-20261007/source-11` |
| Settings navigation | `a1ba45921f699a75c85d20fd3f27b6da7b6cddce` | `recovery/unify-20261007/source-12` |
| Evaluation candidate | `853ff0cc752c5b81f590c4db0810f36297dd8c92` | `recovery/unify-20261007/source-13` |
| Default API-session WIP | `bd5276d384884eb822bd546605e5424db7d15f33` | `recovery/unify-20261007/source-14` |
| Default final | `233a2f77002c5fdab7626c78290c0f7b7758367d` | `recovery/unify-20261007/source-15` |

The recovery JSON records removed bookmark targets and the pre-cleanup operation. Prefer restoring an individual bookmark or file by full commit ID; a whole `jj op restore` also reverses later work and needs fresh ownership checks.

After each future integration: duplicate fixed source snapshots, prove preservation, describe the integrated revisions, move main/default, then forget finished source workspace registrations and remove that integration's temporary refs in the same closeout. Keep one recovery ref per source tip and one operation inventory, rather than a bookmark for every attempted rewrite. Active writers always defer their workspace cleanup.

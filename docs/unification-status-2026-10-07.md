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

Closeout topology: **163 described revisions beyond old main, zero conflicts, zero merges**.
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

## Historical consolidation checkpoint

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
| Plugin tests excluding Settings Search and Thread Sidebar | 18 packages reported totals: 367 passed, 2 failed (Prompt Stash and Jujutsu); Settings Search and Thread Sidebar excluded; no full-suite pass claimed |
| Full combined profile / production | Not proven by this integration; blocked by native seams below. Live DSH was not restarted or changed |

The checkpoint above predates the repairs below. The TS2717 exception has since been removed; current source generation rejects every diagnostic.

## Integrated setup follow-through — current run

Logs: `/private/tmp/dsh-finish-20261007/`. Started from clean default `78e38a3c`, parent/main `3a72f71f`; default was the sole registered workspace. Existing recovery refs retained.

- DSHX's eight reported failures reproduced. Scoped `test --file` correctly; contextual help assertions now test command usage/options. Removed `apiChannel` from the public authoring entry: no external source consumers found, internal transport/tests retain it. Focused three-file suite passes 27/27 after rebuilding.
- Prompt Stash reproduced: mixed image/text content rejected the whole message. Text projection now excludes attachments while preserving multiline text. Jujutsu reproduced: stale expected rows omitted exact-content SHA-256. Expectations and content-change/truncation checks reconciled. Selected tests: Prompt Stash 18/18, Jujutsu 22/22, Settings Search 10/10.
- Settings Search chooses supported inline ConfigForm editing: rc.2 settings section owns only `close`; field navigation requires a native shell change. Removed dependency on absent navigation contract, retained existing in-place editor.
- Native Agent shared `/types` had acquired Host-only Session/options/services. Restored identity-only Agent there; runtime-types already owns live augmentation. Controller sync overlays this source, regenerates Agent declarations, and rejects every Client diagnostic. Generated 166 outputs with no TS2717 exception; SHA-256 `8804be4cc5c9cf1c3c249a4ed29f40d18c06b6fd2b6bf72fd170a4e1affbd5ce`.
- Plugin workspace overrides select one local Agent/Controller identity across native Client consumers. Thread Sidebar build passes with the root-declared local Agent/Session/Controller graph. Combined workflow acceptance remains below.
- Profile sync now supports repeatable `--bundle` selection and an explicit scratch `--home`, preserving unselected profile dependencies and bundles. No web profile writes or live restart performed.

### Resumed combined-profile validation

- Authenticated T3 browser reproduced Core Runtime import failure: disabling the native Controller removed its Client factory. DSHX now supports explicit Client `bundleDependencies`, preserving platform identities and Node-import refusal; configuration and actual compiler tests pass 69/69. Core Runtime embeds the local Controller `/client/module` source-generated library rather than importing the missing native factory.
- Controller sync now emits local JavaScript alongside declarations before native bundling. Declaration-only generation could preserve copied upstream JavaScript. Fresh generation passes with 166 outputs, SHA-256 `8ed20fd0f0560629178c1f192d11a7f43cfb3025cf62877356c58023a49eda98`.
- Combined scratch Client boots without a failure card and exposes Thread Sidebar, workspace/composer, Prompts and Drafts. Prompts create/save retains multiline text. More workflow checks remain in progress; no web promotion yet.
- Agent Questions fresh scratch provider-fixture and cold-restart resolution acceptance pass. This is a synthetic provider fixture, not a credentialed real provider.
- Core Host awaits persistence, SessionStore, AgentRegistry, AgentLoop and Controller fibres in order. Initial stdout still reports transient Controller-dependent pending rows; a scratch-only bounded readiness fixture now checks every enabled Loader row and records the settled state. Final combined Core candidate reports `inactive: []`; this does not claim warning-free initial stdout.
- Default retains this thread's existing graph/selection changes. The newly registered `roadmap-continuation` workspace is another active writer and is left untouched.

### Completed checks and bounded promotion

- DSHX full suite: **538/538 tests in 52 files**; scaffold **22/22**; all **19 individual owned bundle boot smokes** passed. The integrated root command stopped at two Knip findings (unused Client Store dev dependency and undeclared system `jj` executable); both repaired, then dependency checks passed. Subsequent plugin integrated build/typecheck/test lane passed. Script typecheck, Cordis identity, local core identity (17 links across 7 roots), lint (warnings only), formatter (612 files) and production dependency audit passed. These are completed lanes, not a claim that the original root invocation exited zero.
- Restored the canonical browser-safe Inbox projection to Agent `/types`; AgentLoop retains only its Host state projection. Agent and Queue builds pass; source-generated Controller JavaScript and declarations are coherent.
- Core public CLI create/list/read, V4 migration, attention APIs, SIGKILL recovery, durable reconciliation and exactly one resumed synthetic Cursor prompt passed. Agent Questions fresh synthetic parent/child provider journey and cold-restart resolution passed. Project Checks trusted execution, current/stale/current receipt transitions, automatic verification and failed Codex hook attribution passed. Real provider credentials were not used.
- Authenticated T3 browser on isolated `:3199`: combined Client boot; multiline Prompts save/insert and Drafts save; `/goto` opened the synthetic Cursor session; its actual reply appeared. Settings Search opened the inline Host editor, saved font size at revision 1, then restored inherited value. A synthetic native provider executed a real scratch filesystem tool through the native AgentLoop; its changed-file card opened review and Viewed progressed **0/1 → 1/1**. A native-runtime candidate without Core/Cursor also booted with no activation warnings and no Client failure card; browser Project Checks returned **Passed, exit 0**, with a working-copy receipt.
- Registered in `web` through explicit bounded `profile:sync --bundle` selection: **@dshfiles/agent-questions, @dshfiles/diff-viewed, @dshfiles/project-checks, @dshfiles/prompt-stash, @dshfiles/sidebar-commands**. All previous dependencies/bundles and the entire configuration patch remain byte-preserved. Offline composition has **202 unique top-level Loader IDs**. Existing unmatched patches for `llm-openai-codex` and `preset-standard:tool-ask-user` remain unchanged. Backup/evidence: `/private/tmp/dsh-finish-20261007/web-backup/`, `web-promotion.log`, `web-composition-check.log`.
- **Cursor Agent is not installed in web. Core Runtime remains scratch-only.** Official CLI Core candidate reproduces Thread Sidebar read/park failure before transport. Source-only graph coherence is not runtime coherence: installed native package resolution remains installation-owned, so the Client Remote namespace lacks local Controller extensions. Attempted mounting of canonical generated missing descriptors through `$mount` stalled Client service startup; that experiment was removed. No casts, local module augmentation, or durable-state workaround were retained. DSHX's Remote provider catalog was corrected from the obsolete API Remotes package to the actual rc.2 API Gateway owner.
- Live `:3080` remains PID **61677**, untouched. The five new boot-composition registrations require the user to restart when convenient. No push.

### Current run history closeout

- Focused revisions: DSHX Client library bundling/provider catalog `9b64ded82a6d7f4802a5645b4b8217380158e45b`; native artifacts/Client graph `180fe45d3220d29d9d1e50e284c0e6f1a3bfa680`; bounded sync/settled activation `bcc50083f41368dac9cea330ef61f5ebb3598315`; formatter-only Settings Search `7926f00259a648e351aee165ba279afd507f6868`. Earlier engineering repair remains `a6c73c2c381ceb6c3f4f5aade84e9e262df794b9`.
- Pre-split source tip `8cf2b6fe3e09c2e42a43684865f40b6f0d26d1e3`; preflight operation `ebdd1d7b19fb`. Full-tree diff against the focused chain was empty (zero files changed). A distinct recovery duplicate also has exact tree equality, preserved as `214ab228d02060b159e24f72f6c6cecfdbe160fa` at `recovery/finish-20261007/source`, avoiding a visible divergent source change ID.
- No temporary integration bookmarks or own named workspace were created: removed-target inventory is empty. Existing recovery refs and the active `roadmap-continuation` workspace remain untouched. Main/default closeout contains the finished work; default is an empty child. Runtime failures above remain release gates despite clean history.
- Installed Controller descriptor inspection (`installed-controller-extension-check.log`) confirms both `updateAttention` and `prepareWorkspaceRestore` absent in rc.2's installation-owned generated contribution. The repaired local source contribution contains them; profile links cannot override that installation scope.

## Remaining engineering gates — finite queue

1. **Native/local runtime graph:** close the reproduced official-CLI Client Remote ownership seam. Prove Thread Sidebar mark-read and park/unpark in the authenticated combined browser. Static TS2717, Settings Search, DSHX CLI/API and two plugin test failures are repaired; do not reopen those without new evidence.
2. **Cursor promotion:** only after that runtime graph works, repeat the bounded combined candidate with the actual Cursor driver and recovery contract, then promote Cursor and only the required Core runtime dependency. Synthetic ACP evidence does not prove credentialed Cursor behavior. Keep Core scratch-only until this gate closes.
3. **Clean consumer setup:** verify `install:all`, native source generation and build in a fresh consumer environment. Ignored generated `lib/` is not preserved by source-tree equality. Current overlay generation passed; fresh clone portability remains separate.
4. **Live adoption:** user restart is required to load the five new profile registrations. No live restart/reload or credentialed provider acceptance was performed. Schedule composition and automatic account wake remain product acceptance gates; no automatic-wake claim is made.

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

## Recent-work consolidation — 2026-10-10

- User confirmed no other agents writing and required consolidation before investigating Codex image rejection. Recovery operation before integration: `b5d7c60faf8b`. Integrated source-only tree: `38988ac8480a7e041957c478866f529363c83ea8`; integration workspace `unify-20261010` at `/Users/astahmer/dev/dshfiles-unify-20261010`.
- Preserved raw tips under `recovery/unify-20261010/`: `default` → `3557c76381e0f01ffbaf9fb55c8e72dd2110c379`; `communication` → `2497ae4d961c1eed28dab34a2101f284d3707fa9`; `failover` → `c931c33f1900e47c8dfec568b2cbe305a8cbd2ff`; `plugin-e2e` → `4219e7ec1a02a852c9dabf7aacdbd26deaef0531`; `queue` → `37e949fd0f8199001ef4ccd465395ebdb6cba1e8`; `roadmap` → `88513b6f7112af54da2b19722eff7cee86f9d4f2`; `core-rule` → `b00608df078367bcb449bdfaac39cd198885d03b`.
- Useful failover source was the nonempty divergent `c931c33f`, not its empty registered workspace tip `a2edac49c22adbd84d158b312ebb83cbf0c5ecea`. E2E includes ancestor `d1eb477d195df0e56233b7cc5d64c51ace196f1e`. Older divergent `26c6cce1990ad0dd8c29f2974893c05df5a53aff` and `20cbc73c4bcb3c6cf1f44ded17ecb1a40d6f91f4` are content-superseded by those saved sources, not ancestors.
- Preservation proof: byte comparison against the combined tree found all 21 communication source files, 8 failover source files, 11 E2E tip files, 2 roadmap files, and the Core instruction file identical to their source snapshots (excluding generated lockfile). E2E parent has 9 identical changed files; its only later overlap is `steps.ts`, with the tip's additional diagnostic declaration. Private local config has an empty source-to-integration diff. Every commit on the new main spine has `conflict=false`.
- Queue source's composer-only fixes conflict with the newer default inline editor. Retained the newer inline editor and its deliberate removal of the old source-text rendering test; the complete old queue tree remains recoverable at the queue bookmark. E2E message-preview extraction is preserved. This is an explicit semantic overlap decision, not whole-source-tree equality.
- Derived lock conflict resolved by regenerating from integrated manifests: `fnm exec --using=22.23.3 pnpm --dir plugins install --lockfile-only --ignore-scripts`, exit 0; supply-chain policies pass (1087 entries). Existing peer/deprecation and cyclic-workspace warnings remain. No build, browser acceptance, credentialed turn, profile promotion, or live restart is implied by consolidation.
- Closeout inventory: forget finished registrations `agent-attention`, `agent-communication-observability`, `agent-session-history`, `ai-failover`, `core-repo-rule`, `plugin-e2e-coverage`, `queue-rich-edit`, `roadmap-continuation`, and temporary `unify-20261010`; retain their physical directories. Empty attention/session tips were `0fbfcf2078e0cbdb486e2f8ee469664137ac6b0e` / `aebeb61b0bd9c3352a80f39212e82d57c3fd41a7`. Temporary integration bookmarks: none. Unrelated existing recovery refs remain intact.
- Remaining gates: communication scratch/browser and lint/build/import acceptance; E2E catalog/scenario coverage and browser journeys; failover classification/cancellation/routing/boundedness regressions and redaction review. In particular, the preserved failover draft adds no tests, may cycle cooled accounts without a cap, and uses provider error text in notices/logging. Do not equate preserved work with accepted runtime behavior. Earlier engineering/product gates above remain open.

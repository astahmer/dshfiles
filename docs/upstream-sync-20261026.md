# Upstream sync — 26 October 2026

Historical private-source receipt, not proof of current public synchronization or
activation. Private profile, process and home-path details are omitted. Follow the
[sanitized publication contract](fork-maintenance.md) for the later fresh lineage.

## Scope and rollback

- Fork baseline: `0f5eb75f86ce91650394a5899525e2db2c660735`.
- Verified upstream: `https://github.com/astahmer/dshfiles`, default branch `main`, fetched at `92d0f010fad793fdb4c80b61610d20c56da263ac`.
- Merge base: `04d6c5ee5156a5f18c45273eca440cdbb3ab63c7`.
- Six new upstream commits: accepted PRs [#1](https://github.com/astahmer/dshfiles/pull/1), [#3](https://github.com/astahmer/dshfiles/pull/3), [#4](https://github.com/astahmer/dshfiles/pull/4), [#5](https://github.com/astahmer/dshfiles/pull/5), [#6](https://github.com/astahmer/dshfiles/pull/6), and [#10](https://github.com/astahmer/dshfiles/pull/10). PR #2 was already incorporated in the rewritten upstream baseline.
- Ancestry-preserving Git merge, prepared in a separate named worktree. No JJ initialization, history rewriting, push, core upgrade, or live restart.
- Rollback reference: `backup/pre-upstream-sync-20261026`. Do not reset a dirty shared checkout; review an inverse change against that reference instead.

## Deduplication decisions

Adopted the shared typed-draft/model/preset production implementation: it already incorporates the local outgoing-payload retry behavior. Adopted upstream typed-draft tests, sanitized screenshots, completed documentation and more precise telemetry. Retained the additional pending-send retention regression instead of dropping distinct coverage.

Reclassified model-selection, agent-preset and loopback-access as **shared/accepted**, and retired the proposed contribution debt for PRs #1/#3/#4/#10 in [fork-policy.json](../fork-policy.json). Source ownership and profile activation remain separate.

Adopted the credential-port ESM distribution and secret-process failure containment. Preserved the fork's separate expected-scope credential safety contract and resolver, account-management/dashboard/attribution changes, Resources, and launcher/profile adaptations.

Adopted the canonical PR10 network implementation and MIT license: one forwarder/controller/UI, no parallel localhost workaround. Kept the fork's selected web seed and accurate historical verification notes. Upstream telemetry, native lifecycle/port-reservation tests and actual two-origin browser authentication checks supersede the local versions.

Combined shared browser-receipt/executable improvements with the fork's AI Accounts auth-fixture cache inputs, workspace seeding, stable prewarm seed keys and exclusive scratch-workspace registration. Aligned Host environment/executable argument order and kept both propagation and seed-key validation coverage.

Regenerated the lockfile with pinned pnpm 12.5.1 after manifest resolution. Its 848-line diff removes the unused loopback-access monolithic DSH dependency and recomputes peer snapshot identities; the set of **1,387 exact dependency versions is unchanged**. No hand-edited lockfile or dependency/core version upgrade.

## Verification

Pinned official Node 22.23.3; isolated dependencies installed with `NODE_ENV=development ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile --prefer-offline --prod=false`.

- `node --test scripts/fork-audit.test.mjs tooling/dshx/scripts/browser-tasks.test.mjs`: **23 passed**, including real shared-recipe invalidation and fork-specific account fixture isolation.
- Scoped Turbo `build typecheck test` for loopback-access, credential-port, secret-catalog, agent-preset, model-selection, rich-composer, thread-sidebar, workspace-nav and settings-shell: **70 tasks passed** (27 replayed from content-addressed cache).
- Complete source build: **74 tasks passed** (65 cached), after explicitly building Usage once for the existing fresh-worktree dependency cycle.
- Nine affected Host bundles imported successfully on pinned Node without executing activation.
- SDK executable/workspace/redaction tests: **26 passed**; E2E boot fixture tests: **6 passed**, including real subprocess restart and environment isolation.
- SDK typecheck: **4 tasks passed** (cached).
- Launcher/profile preparation/network startup/supervisor tests: **31 passed**.
- Feature/telemetry hygiene: **74 catalogs, 279 features, 381 scenarios validated**.
- Browser-task generation and Git whitespace/conflict checks: clean.

- Fresh forced browser journeys: **2 network** and **12 Settings** scenarios passed, including authenticated LAN/localhost/browser-origin fencing and staged choices across an isolated restart. The wrapper expands a named feature to all its owner's scenarios; the four project-draft scenarios passed before unrelated sidebar fixtures failed, so their narrow standalone result is recorded below.
- The historical selected-profile candidate verifier booted all **61 selected source bundles** in an isolated home with synthetic secrets; **zero activation failures, slot errors, failure cards or browser errors**. Its screenshot was retained privately; the temporary Host/browser/home were disposed. This is historical evidence, not a fresh run of the renamed portable verifier.
- Exact combined merge files pass focused `oxfmt --check`; no broad formatting rewrite.

- Standalone `playwright test project-header-chat.feature.spec.js --workers=1 --max-failures=1` with prebuilt bundles, scenario caching disabled, stock-core/system-Chrome overrides: **4 passed** freshly in 62 seconds. This covers collapsed-project creation, independent persistent typed drafts, pretyping model/preset choices, and the compact picker.

- Canonical source-checkout frozen install and complete build: **74 tasks passed** (3 cached), followed by successful imports of all nine affected Host bundles. These are the served artifacts, not only worktree output.
- Final fork audit: upstream is the merge base at `92d0f010`; **zero ownership reviews remain**. Thread-sidebar, model-selection and agent-preset packages exactly match upstream. AI Accounts, Resources, Usage and the fork-only credential scope contracts remain byte-identical to the pre-sync baseline.
- Landed merge: `db4137a0235347ed53db7715a218d395382c2957`. Fresh remote readback still reports upstream `92d0f010`. All six original dirty/untracked files are byte-identical after landing/building.
- The original Host remained running. The gate deferred loopback-access and secret-catalog until a user-managed restart at that time; this is not a current activation claim. No restart or push occurred.

Verification-maintenance outcome: **Changed** — combined the accepted upstream boot/recipe contracts with fork-only fixtures; green scoped tests, 18 affected browser journeys and all-selected-bundle scratch boot. Broader pre-existing fixture/release failures below remain outside this sync.

## Existing failures, not introduced by this merge

- Workspace contract rejects user-questions because its original-main manifest has no `scripts.test`. That manifest is unchanged. Do not invent a passing test script during an upstream sync.
- Whole native-fork audit exits 1 for existing added files in chat/rich-composer. Their native trees and provenance are unchanged from the fork baseline; all forks have no undeclared modifications, stale deltas or missing vendored files. Model-selection, agent-preset, controller and navigation provenance are clean.
- Broader sidebar fixtures boot only thread-sidebar, omitting its required `sessionDrafts` companion, so the browser displays `Failed to load plugins` before the expected Preview Notice. Reproduced the exact same failure on untouched canonical main `0f5eb75f` with a single archive-undo scenario (22 seconds); both baseline and candidate error snapshots identify `thread-sidebar: pending (waiting for service: sessionDrafts)`. The affected four draft journeys compose all companions and pass. The aggregate owner run was stopped after repeated identical fixture failures; no full-sidebar/full-release green claim. Baseline evidence: `tooling/dshx/test-results/e2e-features-thread-sideba-43d2a-e-from-its-temporary-notice-chromium/error-context.md` in the canonical checkout; logs `/tmp/dsh-sync-baseline-sidebar-20261026.log` and `/tmp/dsh-sync-browser-20261026.log`.
- A truly fresh build exposes the existing AI Accounts/Usage workspace cycle: AI Accounts imports Usage's built API before it exists. Building Usage first and then rerunning the build succeeds. Recorded as papercut `p_93f6749afe`; canonical checkout already has these artifacts. No source workaround was introduced.

## Live handoff boundaries

At the historical handoff, the inspected Host was a child of the canonical source supervisor, all **61 selected source bundles** resolved into that checkout, and the installed launcher matched its then-checked-in source. These are dated observations, not current runtime configuration. No writable profile, account/credential/Session storage or selected bundle list was edited.

Unverified: real provider/account operations, exact private profile configuration under a newly restarted Host, and the user's eventual restart. The scratch smoke reads only profile manifest/pnpm metadata and uses synthetic secrets. Broad unrelated feature journeys and the full release gate are not claimed green.

# Optimization audit evidence — 2026-10-18

This folder records bounded observations, not a product-wide performance certification. Source work packages live in the [master plan](../README.md), [client register](../client.md), [Host register](../host.md), and [tooling register](../tooling.md).

## Provenance and evidence classes

1. **Current-source facts:** source at audit start `ecfd5375f823`, based on `6a82b443dfe3`, in a dedicated JJ workspace. Forty-six owned package directories were mapped; depth differs by domain, as the registers explain. No core checkout was inspected or patched.
2. **Measured pure algorithm:** [graph-results.json](graph-results.json) executes the current TypeScript graph implementation in Node with synthetic fixtures. This is not a browser frame, React commit, keystroke, loading, or paint measurement.
3. **Measured built tool:** [checkout-results.json](checkout-results.json) executes the existing shared checkout's built dshx planner with no changed files, instrumenting real filesystem reads in a separate Node process. The matching source file hash was verified between source and built checkout; the artifact was not rebuilt for this audit. This demonstrates that actual artifact's work, not independent proof every output is fresh.
4. **Fresh runtime smoke:** [browser-results.json](browser-results.json) is a small/empty-fixture resource snapshot from a separate scratch instance; no active provider, long conversation, complete owned profile or streaming workload. It cannot establish loaded-product p95 or stable retained memory.
5. **Static scanner:** [compressed full Oxlint report](oxlint-baseline.json.gz) preserves all 1,861 warnings, zero errors, exit 0. Most concern code-quality boundaries, not performance. Count is not an optimization count; unstable-empty-array micro-tuning and broad lint cleanup were not promoted as high-value findings.
6. **Inherited browser baseline:** [earlier ADE audit](../../../docs/ade-performance/README.md) and its raw results already document 1/5/20 held-turn warm navigation. They are dated earlier evidence, not a new run here and not token streaming. That thread continued with an h-run of the same harness and reported materially worse, more variable numbers on a different scratch (agent creation p50/p95 186.1/587.2 ms, AI Accounts 150.8/968.7 ms, Activity 103.5/262.5 ms at 20 agents), so the earlier ~98–99 ms p95 is not a stable product guarantee. The h-run also stalled on repeated-turn output while the fake provider reused a fixed completion id (`created: 1`), which suggests stale turn content; the hypothesis is unproven and is a prerequisite check for any streaming benchmark (`docs/ade-performance/benchmark.mjs`, `tooling/dshx/packages/dshx/src/scratch/fake-command-code.ts`). The h-run's own instrumented numbers and the g-run figures must be reported as separate runs with variance, never averaged into one claim. Two operational facts from the same thread matter for reproducing M01: pass the exact scratch `--state-dir` on every command because an outer-shell `TMPDIR` can differ from the process default, and the live composer accessible name (`Message or run a task, / commands, @ files or sessions`) can differ from the harness constant, so later turns may need the contenteditable selector.

Node v22.23.3 (official fnm), pnpm 12.5.1, darwin/arm64; scratch Chromium 141.0.7390.37, viewport 1440×900. CPU/environment metadata, source hashes, scanner summary and existing-artifact sizes are in [audit-summary.json](audit-summary.json) and [bundle-sizes.json](bundle-sizes.json).

## Graph layout probe

[Portable runner](graph-benchmark.mjs) uses the actual graph module, one excluded warmup and seven measured runs for each fixture. Fixtures are linear first-parent history, and an 80%-side-chain/20%-trunk graph with eight revisions per side chain. The run validates returned row count and unique identities; it does not replace the comprehensive existing graph correctness fixtures.

| Revisions | Linear median / max (ms) | Branchy median / max (ms) |
| --------: | -----------------------: | ------------------------: |
|       100 |              0.65 / 1.18 |               0.27 / 0.35 |
|       500 |              5.05 / 7.78 |               1.94 / 2.86 |
|     1,000 |            17.43 / 20.41 |               4.43 / 5.22 |
|     2,000 |            37.12 / 75.15 |               7.04 / 8.23 |

Order was not randomized; JIT/GC and concurrent system activity can affect values. No p95 claim from seven samples. This specifically motivates inspecting repeated linear parent-branch scans and raw-keystroke layout, not claiming branch-heavy graphs always cost more. A 2,000-revision fixture represents accumulated history, not the initial 100-row fetch.

A second run of the same archived runner, on the same machine minutes later, produced materially lower numbers: linear 1,000 p50 **15.94 ms** (max 17.24), linear 2,000 p50 **29.23 ms** (max 30.12), branchy 1,000 p50 3.47, branchy 2,000 p50 6.72. The 2,000-linear max alone moved from 75.15 ms to 30.12 ms. Both sample sets are kept ([first](graph-results.json), [second](graph-results-rerun.json)) because the spread is itself evidence: seven samples on a loaded machine cannot support a precise threshold, and any budget derived from this probe needs repeated runs and a tolerance. Reject a claim that linear layout is always ~30 or ~37 ms at 2,000 revisions.

Reproduce without modifying source or saved baseline:

```sh
node --experimental-strip-types plans/performance-optimization/evidence/graph-benchmark.mjs /private/tmp/graph-new-results.json
```

## Memory retrieval scope probe

[memory-retrieval-probe.mjs](memory-retrieval-probe.mjs) (results in [memory-retrieval-results.json](memory-retrieval-results.json)) builds a scratch memory database where one project's corpus is term-dense and 1,000× larger than the requested project's notes, then asks for the requested project only. It prints the scoped hit count, the projects of the hits, and the `EXPLAIN QUERY PLAN` of the docs FTS statement.

| Run                      | Corpus                         | Scoped hits | Hit projects | Scoped search |
| ------------------------ | ------------------------------ | ----------- | ------------ | ------------- |
| Before the SQL predicate | 2,000 noise notes + 5 in-scope | **0 / 5**   | —            | ~7 ms         |
| After the SQL predicate  | same                           | **5 / 5**   | `mine`       | ~5 ms         |

The query plan is unchanged (`SCAN d VIRTUAL TABLE INDEX 0:M4`, `USE TEMP B-TREE FOR ORDER BY`): the fix is a predicate evaluated inside the FTS statement, not an index. Timings are single samples on a shared machine; the hit counts are deterministic.

## Checkout planner probe

[Portable runner](checkout-benchmark.mjs) calls `CheckoutRebuild.plan({ root, changedFiles: [] })` six times in one process. It wraps `readFileSync` only to count actual `.js.map` reads and bytes; the real implementation and filesystem remain in use. No JJ operation, install, bundle build or checkout mutation occurs.

- Each call: **74 maps, 53,913,303 bytes, zero selected plugins**.
- First call: **297.45 ms**; not a guaranteed cold filesystem cache.
- Five subsequent calls: **166.14–177.81 ms**, median **171.09 ms**.
- All complete maps are parsed even though only their `sources` array is used. The result includes embedded source contents from existing artifacts.

Reproduce with an already built checkout (replace the path; do not silently build or install globally):

```sh
node plans/performance-optimization/evidence/checkout-benchmark.mjs /absolute/path/to/built/dshfiles /private/tmp/checkout-new-results.json
```

The archived runners have portable root/output arguments instead of the initial run's hardcoded absolute paths; fixture/measurement logic is unchanged. Fresh runs should write new results rather than overwrite the dated baseline.

## Scratch runtime smoke

Name `perf-audit-5c0266`; origin was `http://127.0.0.1:60856`, never :3080. It used existing built artifacts from the shared checkout with `--skip-build`, not freshly built outputs in this documentation workspace. Selected seven bundles: UI Styles, Shared Runtime, Activity Timeline, AI Accounts, Project Checks, Agent Communication, Jujutsu.

- `dev doctor`: isolated home/port, owned Host/browser alive, URL authenticated, 173 active entries, all seven bundles loaded, no Host error lines.
- `dev open activity-timeline/activity-feed`: passed; [screenshot](activity.png) and [summary](activity.json): console/page/request/HTTP error counts all zero.
- `dev open agent-communication/human-browser`: passed; [screenshot](communication.png) and [summary](communication.json): all four error counts zero.
- `dev open jujutsu/graph-navigation`: all thirteen reach steps passed; [screenshot](jujutsu.png) and [summary](jujutsu.json): **one HTTP 404 and one matching console error** for `classifyWorkspaces`. The optional jj-integration owner was omitted from this targeted composition. Do not call this a clean full-Jujutsu/full-profile pass or a new product regression. A subsequent complete-composition benchmark must include that owner and pass its own error gate.
- Reach-step milliseconds are action/assertion journey timings, not correct-content paint distributions. The 843 ms Locate Current assertion in the small fixture has no causal Host/render breakdown; no optimization claim is derived from it.
- Resource snapshot after the Jujutsu reach: 618 DOM nodes, 163 stylesheets, 51 retained resource entries totalling 16,242,916 decoded bytes. This includes the native application/vendor resources and prior navigation, not only owned bundles or unique cold transfer. Transfer bytes can be zero from cache/resource timing. Coarse used heap was 76.6 MB; no forced GC, no retention conclusion.
- `dev down --dry-run` identified exactly the two owned processes and scratch home; `dev down` stopped Host pid 15975 and browser pid 16462, removed token-bearing scratch state/logs and reported **no processes left running**. Evidence was retained. No live instance restart or profile sync occurred.

One audit child sent one passive coordination notice through the communication inbox instead of the ephemeral parent channel. That wrote coordination state; no application-data investigation mutated user databases, account/secret configuration, profile, repositories or remote hosts. Do not describe the turn as literally zero state writes.

## Existing bundle inventory

[bundle-sizes.json](bundle-sizes.json) measures files already built in the shared checkout, using raw and local gzip sizes. Forty-two client artifacts total 15,214,373 bytes (3,953,003 locally gzipped in this sample); not every artifact is installed in the web profile. In particular, pulls-review is not evidence of live transfer. Editor is 5,663,518 bytes raw / 1,523,265 gzip; Jujutsu is 1,587,338 / 312,453. File sizes are not parse/evaluation latency or actual HTTP compression evidence.

The compiler's one-client-chunk protocol and already-shared runtime/styles constrain lazy-loading work. `import()` may defer evaluation without shrinking that chunk. Use an actual complete-profile network/evaluation trace before cutting language support, splitting bundles or introducing a worker.

## C19 implementation receipt

Implemented in revision `qkqlussz` on 2026-10-18, rebased onto the then-current main with tests re-run afterwards.

1. **Reproduced first:** [shim-lifecycle.test.ts](../../../plugins/@dshfiles/shared-streams/src/shim-lifecycle.test.ts) executes the generated page and worker script strings inside a `node:vm` sandbox with stub `EventSource`, `SharedWorker`, `EventTarget`, `Event`, `MessageEvent`, `URL`, `console` and controllable timers. Against the pre-fix script, 4 of 5 behaviours failed: the fallback native socket stayed open, no `disconnect` reached the worker, closing one of two same-URL proxies unsubscribed the whole port, and a repeated `close()` sent a second unsubscribe.
2. **Fixed** in [shim.ts](../../../plugins/@dshfiles/shared-streams/src/shim.ts): the proxy owns its native fallback; fallback disconnects the worker once before native attachment; a URL group publishes the union of its instances' event types and unsubscribes only on the group's last close; `close()` is idempotent and drops the empty group.
3. **Focused checks:** `pnpm --dir plugins/@dshfiles/shared-streams exec vitest run` → 13/13 passed (2 files); `run typecheck` passed; `run build` passed; the DSH-Node `import('./dist/index.js')` check passed; `pnpm run check:diff` clean with **0** diagnostics in the two changed source files.
4. **Scratch runtime:** `dshx dev up --name c19-5c0266 --plugin @dshfiles/shared-streams --skip-build` booted on `127.0.0.1:61391`; `dev doctor` reported 167 active entries, the bundle loaded, URL authenticated and no Host error lines. A CDP probe then loaded the real launch URL and a second tab: both reported `__dshSharedEventSource === true` and `EventSource.name === 'SharedEventSource'`, the app root rendered, and there were zero console/page errors. [Screenshot](c19-shared-streams.png), [summary](c19-shared-streams.json). `dev down` stopped both owned processes and left nothing running.
5. **Still unmeasured:** multi-tab socket count and pending HTTP requests under real streaming load, and whether the fallback path ever fires in a normal browser. The catalog's multi-tab journey remains `not-applicable` on purpose.

## T01 implementation receipt

Implemented in revision `xlmxnrtl` on 2026-10-18, based on main `6ee7a86a`.

1. **Compiler:** `CompilerKernel.dependencyManifestPlugin` writes `<entry>.deps.json` (`{ version: 1, face, sources }`, package-relative module paths) for the client bundle and the primary Host bundle. Generation builds skip it, because they publish a hashed chunk behind a wrapper and the planner reads `index.js.deps.json`.
2. **Planner:** [rebuild.ts](../../../tooling/dshx/packages/dshx/src/checkout/rebuild.ts) reads the manifest first and falls back to the source map for artifacts built before this change; bundle sources are resolved lazily, so a plan with nothing to match never opens either file. `comparesSources` and the `memoizedSources` thunks are what make the no-change case free.
3. **Focused checks:** 67/67 in `tests/checkout-sync.spec.ts` + `tests/client-build.spec.ts`, including three new cases — an unparseable map that is never opened when nothing changed, a manifest that wins over a corrupt map, and a fixture build asserting `src/client.tsx`/`src/helper.ts` are recorded. `check:diff` clean. Full `dshx` suite: 689 passed, 1 unrelated pre-existing failure (see below).
4. **Probe:** [checkout-plan-probe.mjs](checkout-plan-probe.mjs) with [raw samples](checkout-plan-results.json), run against this workspace's built planner and two targets.

| Case                                            | Before (audit baseline)                           | After                                                                |
| ----------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| No changed files (shared checkout, maps only)   | 74 maps / 53,913,303 bytes, 171.09 ms warm median | **0 maps / 0 bytes**, 6–16 ms warm                                   |
| One changed source (shared checkout, maps only) | 74 maps / 53.9 MB                                 | **2 maps / 4,099,100 bytes** (that package's own bundles), 20–114 ms |
| One changed source (manifest-backed package)    | n/a                                               | **1 manifest / 1,414 bytes**, 0 maps                                 |
| Changed dshx runtime file                       | 74 maps / 53.9 MB                                 | **1 manifest / 1,414 bytes**                                         |

Selection is byte-identical in the unit suite, `dshx dev up` still boots from existing artifacts, and the timing spread above is why the counts, not the milliseconds, are the primary evidence.

## C01 and C06 implementation receipts

Implemented in the working copy of thread workspace `thread-5c0266` on 2026-10-18 (unlanded; see the topology note below).

**C01 — incremental transcript decoration.** All three decorators now derive a dirty set from `MutationRecord`s and rescan only those nodes, and the initial pass drains its own records with `takeRecords()`:

- Memory: the strengthened unit test decorates **200 blocks**, changes one, and asserts the `createTreeWalker` roots are exactly that block — the untouched 199 are never walked. Memory suite 67/67 (decorator file 3/3).
- Jujutsu: changing one code element makes the conversation's `querySelectorAll` run **zero** times while the changed code is still re-marked/unmarked correctly. JJ suite 155/155 (decorator file 6/6); `pnpm check:e2e jujutsu` → **11 passed, 0 failed**.
- Mentions: a subtree is queued only when it can hold a reference chip, so an unrelated sidebar mutation does no document-wide query. Mentions suite 10/10, typecheck clean.
- `check:diff` clean (5 changed files, 0 diagnostics).
- Caveats: `memory.reference-preview` is the pre-existing flake documented in [the documented citation-preview flake](../../../docs/e2e-testing.md#provider-credentials); two fresh control runs on the reverted source also failed, and a control run _with_ the change passed. The mentions journey fails with **and** without the change (the booted profile still exposes the new-thread composer placeholder instead of `Message or run a task, / commands, @ files or sessions`), so mentions is unit-verified only.

**C06 — closed palette does no catalog work.** `PaletteOverlay` now reads only the palette snapshot and returns before mounting anything; `PaletteCatalog` owns the session/workspace subscriptions, and archived-ID/workspace joins are `Set`/`Map` lookups. Verified with 40/40 unit tests across 11 files, `typecheck`, `build`, and `pnpm check:e2e command-palette` → **12 passed, 0 failed** (includes `palette-performance`). Gap: the closed-path assertion is source-level; a unit test needs the full `shell.overlay` slot prop kit, so a shared test-props factory is the follow-up.

## C07 implementation receipt

Implemented in the working copy of `thread-5c0266` on 2026-10-18 (unlanded; see the topology note below).

`$projectComposer` is split into `$composerProjectionContent` (text views, chip occurrences, command claim) and `$composerSelection` (range/caret). `DraftEditorRuntime.refreshProjection` reuses the content half while its `contentRevision` is unchanged, and the update listener bumps that revision only when a commit dirtied elements or leaves. Measured on the installed Lexical 0.49: selection-only commit `0/0`, `setDraft` `3/2`, `paste` `2/2` (elements/leaves).

The first attempt keyed reuse on the `RootNode` instance; the new test immediately caught it serving a stale projection, because Lexical reuses the root object across content commits — the revision counter is the real signal, and the test now guards that regression.

- [projection-reuse.test.ts](../../../plugins/@dshfiles/rich-composer/tests/projection-reuse.test.ts): 200-block draft, 100 caret moves reuse the identical `detectText`/`clipboardText`/`occurrences` objects and report caret `35`; a paste rebuilds; a chip's occurrence array and `occurrenceId` survive 50 caret moves.
- rich-composer suite **16/16** across 4 files, `typecheck`, `build`, DSH-Node Host import check, `pnpm check:e2e rich-composer` → **1 passed, 0 failed**.
- Both edited `src/native` files were added to the fork's local-delta table in the plugin README.
- Not measured: input latency and allocations; range-selection/IME/undo rely on existing suites plus the new regression guard.

## C10 implementation receipt (graph layout algorithm)

Implemented in the working copy of `thread-5c0266` on 2026-10-18 (unlanded; see the topology note below). Scope: the algorithm half only.

`layoutRevisionGraph` asked, per parent link, whether the parent's branch owns any row strictly between the child and parent rows — by scanning that branch. On a long linear trunk that is quadratic. It is now a binary search over each branch's sorted rows (`rowBetween` in [graph.ts](../../../plugins/@dshfiles/jujutsu/src/graph.ts)).

Same archived runner, same machine, one warmup + seven samples per case, before → after p50:

| Shape   | Revisions | Before p50 / max (ms) | After p50 / max (ms) |
| ------- | --------: | --------------------: | -------------------: |
| linear  |       500 |           4.98 / 7.76 |      **1.50 / 2.18** |
| linear  |     1,000 |         16.49 / 17.26 |      **2.59 / 5.87** |
| linear  |     2,000 |         34.26 / 61.61 |      **5.12 / 6.80** |
| branchy |     2,000 |           6.60 / 7.80 |          5.60 / 8.59 |

Raw samples: [before](graph-results-before-c10.json), [after](graph-results-after-c10.json). Pure Node observations, not browser frame or typing latency.

Correctness evidence:

- 26/26 graph unit tests, 155/155 full jujutsu suite, `typecheck`, `build`, DSH-Node Host import check.
- A differential harness ran the previous and current `layoutRevisionGraph` over **120 random fixtures** (20–200 revisions, merges, immutable revisions, bookmarks) in both filter modes: **0 mismatches in 240 comparisons**.
- `pnpm check:e2e jujutsu` → **11 passed, 0 failed**. One earlier run of the same code failed the filesystem-dependent `jujutsu.stale-repository-recovery` scenario (the harness deletes the repository directory and expects the unavailable-path notice) after 8m16s under load; the clean re-run passed it in 20s, so that was a load flake, not a layout regression.
- Not shipped: deferring the layout off the raw keystroke path. It changes keypress-to-correct-content latency, so it needs the M01 harness before it can be called a win.

## JJ topology note (2026-10-18)

Several live threads rewrite the shared graph concurrently. During this work the audit revision was reparented under another thread's working copy, `main` advanced repeatedly, and a rebase reported rewriting 30 descendant commits; my own `jj` rewrites cascaded into 8-22 revisions held by other threads. My revisions were left conflict-free and their content is intact, but the stack currently sits on `ktkvyryz` (another thread's `@`) rather than `main`, and one unrelated conflict remains in another thread's revision. On 2026-10-18 the user chose to **freeze this topology**: keep stacking revisions in this thread workspace and stop rewriting shared history, rather than rebasing onto `main` (which cascaded into 8-22 revisions held by other live threads) or pausing until they finish. No rebase is attempted by this work; a later linearize pass settles the graph when the other threads are idle.

## Session close-out (2026-10-18)

What this session verified, per register:

| Register | Entries with receipts                                                                                                                         | Verified by                                                                                                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| client   | C19, C01, C03, C04, C06, C07, C08, C09, C10 (algorithm half), C11, C12, C13, C14, C16, C17, C20                                               | unit suites for the owning plugins, `typecheck`, `build`, DSH-Node Host import checks, and `pnpm check:e2e <plugin>` (jujutsu 11/11, jj-integration 14/14, editor 2/2, command-palette 12/12, rich-composer 1/1, thread-sidebar 26/26, ai-accounts 14/14, activity-timeline 3/3, memory 3/3) |
| Host     | H01, H02, H03, H04, H06 (rolling sweeps), H07 (SQL project scoping), H08 (statement reuse), H09 (overlapped sources), H21 (fingerprint cache) | dshx and plugin unit suites, instrumented read/write/fetch counts, the memory retrieval probe, and the plugin journeys that touch each owner                                                                                                                                                 |
| tooling  | T01 (dependency manifest), T04 (scoped browser prerequisites)                                                                                 | dshx spec suite, browser-task tests, the maintain-verify-dsh live pass (`dshx dev up/doctor/open/shot/down`), and the smoke journeys                                                                                                                                                         |

Measured highlights: graph layout linear 1,000/2,000 revisions **16.49/34.26 ms → 2.59/5.12 ms** p50 (240/240 differential comparisons identical); browser-check preparation **41.1 s → 0.35 s** and **192 files/20.3 MB → 13 files/1.23 MB** hashed; memory scoped retrieval **0/5 → 5/5** in-scope hits under dominant cross-project noise; Activity Timeline reads **0 readFile** on the snapshot path and 50 buffered events as **1 writeFile**; telemetry bursts as **1 state write** instead of one per record; fingerprint checks issuing **zero reads** when nothing moved.

Final gates on the last round's tree (2026-10-18):

- `pnpm run typecheck` from `plugins/`: **96/96 Turbo tasks successful**, zero `error TS` lines.
- `pnpm run test` from `plugins/`: **93/93 Turbo tasks successful**.
- `node --run check:green`: stops at `@dshfiles/dshx#test` with **1 failed | 692 passed**, the single failure being the documented `tests/compat.spec.ts` prerelease-range assertion that predates this work and touches no file this work changed.
- `pnpm check:e2e:smoke` (the `@smoke` subset across owners): **passed in 166 s** on the final tree (every owner task green, including thread-sidebar 2/2, ai-accounts 1/1, settings-shell 1/1, main-tabs, jj-integration, workbench, command-palette and the cross-plugin boot task).

Baseline failures and flakes are listed under [Baseline failures on main](#baseline-failures-on-main-not-caused-by-optimization-work); all were re-checked before attributing them to this work.

## Baseline failures on main (not caused by optimization work)

Verify these against the revision you start from before attributing a red check to your own change:

- `pnpm lint` fails with `antislop(require-safety-comment-for-type-assertion): 338 findings, cap 336`. The changed `shared-streams` files contribute **0** of those findings, so the drift predates this work. Never raise the cap; fix the sites or leave main red as found.
- `pnpm check:e2e jj-integration` (2026-10-18): the first run ended **13 passed, 1 failed** — `jj-integration.structured-reference-handoff-browser-journey` waited for the composer textbox `Message or run a task, / commands, @ files or sessions` and failed before any panel behaviour ran — while a second run of the same panel code passed **14/14**. Treat that composer accessible-name lookup as a flake (the same drift is recorded for the mentions journey below), not as a deterministic baseline failure.
- `pnpm check:e2e thread-sidebar` (2026-10-18, C03 revision): **25 passed, 1 failed** on the first run and **23 passed, 3 failed** on the second. Every failure is outside row rendering: `thread-sidebar.notifications-settings` and `thread-view-presets.custom-views` click a Settings/dialog button after `page.reload()` while the scratch profile’s provider-setup dialog (`Add an API key to get started|Get started`) is up — the registered locator handler dismisses it but the action still waits for the dialog to hide, and those steps do not use `StartupDialogs.reloadPastProviderSetup`; `thread-sidebar.navigation-history` failed on a `startBlankThread` poll for the Host-created session id (15 s) on a run that took 14 minutes under load. Neither mechanism touches sidebar rows, child slices, unread markers or workspace titles, and the same code passed 25 of 26 journeys on the first run.
- `pnpm check:e2e thread-sidebar` (2026-10-18, C04 revision): the first run ended **24 passed, 2 failed** — `thread-sidebar.mention-insertion` (a chip-ordering assertion in the composer, `rightIndex > labelIndex` was 4) and `thread-sidebar.referenced-by` (the `Referenced by` hover submenu item never appeared) — and a re-run of the same code passed **26/26**. Neither journey reads the sidebar inventory poll that revision changed, so both are recorded as flakes under load rather than regressions.
- `pnpm check:e2e workbench` (2026-10-18, C17 revision) ends **3 passed, 1 failed**: `workbench.surface-layouts` waits for a turn-status chip (`getByRole('status')` filtered by `Completed|Failed|Stopped|Cancelled`) to appear after the shared `sendMessage` helper sends from a New-session composer, and it never counts it, although the failure snapshot shows the row as "Completed". **Control run:** restoring the pre-C17 `workbench-view.tsx` (`jj file show -r @-`) and re-running reproduced the identical failure on the same assertion, so this journey is a baseline failure, not a regression. The `@smoke` layout-persistence scenario in the same feature passes.
- `pnpm --dir tooling/dshx run features:check` reports 8 issues in `jj-integration`, `pulls-review` and `thread-sidebar` (renamed/removed test references and one missing Gherkin tag). `shared-streams` reports none.
- `pnpm --dir tooling/dshx run browser-tasks:check` reports drift in about a dozen `turbo.json` files that this change never touches.
- `node --run check:green` (2026-10-18, final round) stops at `@dshfiles/dshx#test`: **1 failed | 692 passed**, and the one failure is the `tests/compat.spec.ts` prerelease-range assertion below. Nothing else in that run failed before it; the plugin-wide `typecheck`/`test` tasks and the smoke journeys were run separately and are green.
- `pnpm --dir tooling/dshx/packages/dshx exec vitest run` ends with one unrelated failure in `tests/compat.spec.ts` ("publishes a peer range accepted by package managers for every verified prerelease"): `satisfies` rejects a verified prerelease against `PROTOCOL_2_COMPATIBILITY.dshRange`. Neither optimization revision touches `src/compat`.

## Validation boundaries

- Oxlint baseline succeeded; warnings preserved and reported separately, not fixed.
- Planned final checks are documentation links/line anchors, JSON parsing, benchmark syntax/reproducibility, artifact privacy review and JJ diff scope. No product sources changed, so a full test/typecheck/build/browser suite would not prove these unimplemented optimizations.
- No real user database schema/count/query plan was collected. H07/H08/H12 require a consented read-only representative database or a seeded scratch copy before any SQL/index change.
- No real provider quota, secret reveal, OAuth login, marketplace installation, remote SSH mutation, cold full-profile navigation or 20-token-stream test was performed. Those are future measurement/implementation gates.
- CPU/latency wins, cache sizes/TTLs, final SLOs, storage migrations and library-specific API changes remain subject to the work-package checks. No “everything optimized” claim is supported by this audit.

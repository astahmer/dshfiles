# Effect refactor

Move the owned dshfiles code (dshx SDK + owned plugin Host halves, optionally browser logic) onto Effect. DSH core
(Cordis services, hooks, agent tools) stays Promise-based: Effect lives inside our code, adapters sit at the edge.

**Foundation complete:** Phases 0–1 are integrated on `main`. The Host service Layers, `effect-host` scaffold, and built-bundle snapshot harness are in place; the post-fix snapshot test passed 1/1 with byte-identical schemas. Plugin migrations proceed per Phase 3 waves, with Phase 2 Schema conversion and parity checks per plugin.

## Progress

Latest checkpoint (2026-11-01 00:05 CET): The landed differential is published for review as draft PR [#25](https://github.com/astahmer/dshfiles/pull/25): branch `effect/4.1-migration` is exactly `jj:5fef1a8c` (root parent = `main@origin` `jj:55d5bad3`), 53 commits, 190 files, +15,474/−3,719, one line with 0 merges/0 conflicts. Only that branch is pushed; remote `main` is untouched. Three migrations are mid-flight on the two Codex accounts — `tool-search` (Effect dependency added, lifecycle/search conversion in progress), `session-warming`, and `context-compaction` — and none has landed yet, so the cap of three stays full. They land into the same branch, followed by the remaining small-Host plugins, Phase 2 schema work, and the final quality gate, after which the PR flips from draft to ready. Rebase rule unchanged: `-r` per revision onto the branch tip, never a range that includes paused AI Accounts, Backlog, or Traces, and never a live workspace's `@`.

Previous checkpoint (2026-10-31 23:45 CET): The Git-ref import that advanced `main@origin` to `jj:55d5bad3` is resolved. `main` was moved to that origin tip, the 49-revision migration chain (`jj:24b55241` … `jj:fa89d54f`) was rebased onto it conflict-free, and the per-checkpoint migration notes were collapsed into this one document (`jj:7c88b79e`). Two validated candidates then landed on the same line: `plugin-marketplace` (`jj:a945904d`, typecheck/34 tests/E2E 4/4) and `agent-telemetry` (`jj:ba6c695c`, typecheck/30 tests/byte-identical schema snapshot/scratch E2E). Both re-ran their package suites on the new `main` (34/34 and 30/30) after the rebase. `main` is now `jj:ba6c695c` and `main@origin::@` is one linear chain with zero conflicts; no push, checkout sync, default-workspace move, or DSH restart happened. Remaining: Tool Search is blocked before any edit because its `effect` dependency needs a shared `pnpm-lock.yaml` importer entry — leave that file alone until no migration thread is active, then add it once for every remaining package. Paused lanes (AI Accounts, Backlog, Traces) and unrelated workspaces keep their WIP; the chain above `main` still holds their divergent lanes, so rebase candidates with `-r` and never rebase ranges that include them. Roughly 28 small-Host plugins, Phase 2/schema work, shared ports, the final quality pass, and full linearization of non-migration lanes remain.

Previous checkpoint (2026-10-31 23:20 CET): All ten validated Wave C/D candidates are integrated into local `main` through `jj:fa89d54f`: ThreadSidebar, Resource Packs, Agent Toolkit, Queue-Reorder, Prompt-Stash, Agents, FFF Search, References, Tweet Context, and Web Search Brave. Each landed conflict-free after its focused gates; Web Search Brave’s scratch, typecheck/build/import, schema, and feature checks passed, but a live provider request remains unverified until an API key is available. ThreadSidebar’s uncached E2E passed 50/50. Its `browser-tasks:check` failure reports broad `turbo.json` drift reproduced on the clean-main baseline; leave that baseline issue untouched. The abandoned `jj:5826c95c` was empty (0 files, +0/-0); current ThreadSidebar `@` `jj:73b2445f` is empty and has no working diff. A Git-ref import updated `main@origin` from `jj:dd9245d6` to `jj:55d5bad3` (`fix(ai-accounts): open verified setup from Models (#24)`) while `main@git` remains `jj:fa89d54f`; local `main` is now conflicted between the old base and those two tips. The new origin commit touches AI Accounts client files, so preserve that paused WIP and defer history changes until active migration workspaces are idle. Default remains `jj:4f9795b1`; no push, checkout sync, or DSH restart. Approximately 35 Host plugin migrations remain: two validated candidates (`plugin-marketplace`, `jj:8cb45177`, and `agent-telemetry`, `jj:5e1b9b6f`) awaiting integration, one Tool Search session waiting at the shared lockfile importer with no files changed, three paused/incomplete (AI Accounts, Backlog, Traces), and roughly 29 other small-Host plugins. Marketplace passed its E2E journey 4/4; its thread reports package/schema/feature/lint gates complete. Agent Telemetry passed typecheck, 30 tests, build/import, focused lint/format, feature checks, byte-identical schema snapshot, and its scratch E2E journey; `dshx dev open` remains unverified because its scratch composition lacked `sessionDrafts` and the retry returned no diagnostic JSON. Both Agent Telemetry and Tool Search require shared `effect` lockfile importer entries, so leave that file untouched until the active lane settles. Neither candidate can be integrated until active sessions idle and the local `main` conflict is safely resolved. I steered Tool Search to preserve the lockfile rather than race another agent. `optmem-core` was verified as a DSH-independent library (`kind: library`, no `dshx.config.ts`/Host entry), so Phase 3 is not applicable; its thread made no edits or no-op commit. Active work uses the two available Codex accounts at `gpt-6-luna` high effort. This excludes Phase 2/schema work, shared ports, final quality, and linearization. Preserve the paused WIP and unrelated divergent lanes; do not rewrite those lanes until their blocked work is cleared.

Earlier checkpoint (superseded): Phase 0/1 is already integrated; `jj:322e6858` is an ancestor of current `main` (`jj:4c97f879`). Fresh focused proof passed: dshx Effect/tracing/schema-snapshot tests 56/56, create-dshx tests 23/23, and `features:check` (85 catalogs). One active lane remains: ThreadSidebar; `fix(dshx): retain full E2E evidence manifests` is described at `jj:de1335f0` with focused evidence tests/Oxfmt passing. The second uncached full suite after the manifest fix passed 50/50, including the rename journey. The targeted Host race was not reproduced (`host.test.ts` and the affected case passed); the active follow-up is checking the earlier `jj abandon`. Preserve its undescribed WIP at `jj:73b2445f` and hold integration until the agent settles. Resource-Packs (`b:533`) is now an idle, validated candidate at `jj:2082a930`: typecheck, 66 tests, build/import, byte-identical schema snapshot, 1,014 dshx tests, focused Oxlint/Oxfmt and `features:check`, E2E 2/2, scratch doctor 8/8 and feature reach 2/2, plus pristine-main checks passed. Live Host activation is intentionally unverified; no restart. Hold integration until ThreadSidebar is idle so it can be rebased after landing. Agent Toolkit is complete and validated at `jj:350884fc` (`b:532` done), with 14 package tests, typecheck/build/import, `features:check`, schema parity across 99 schemas, and E2E 2/2; only four auxiliary scratch endpoints returned 404 and remain unverified. Queue-Reorder is also a validated idle candidate with three described revisions. Defer integrations while either active migration session runs, so remaining lanes can be safely rebased after each landing. Before the current timer-lifecycle WIP, ThreadSidebar gates passed (544 tests, typecheck, format, build/import, `features:check`, scratch doctor/reach, and byte-identical API/tool schemas); lint findings matched pristine main. ThreadSidebar now has three described, conflict-free revisions; latest is `jj:f986502f` (`fix(thread-sidebar): preserve boot recovery ordering`) on current main. A latest combined typecheck/package command passed, focused `oxfmt`, Oxlint, ast-grep and `restart-effect.test.ts` passed (6/6), and the diagnosed scratch retry succeeded: `dev open` reached all 10 steps, screenshot capture and `dev down` succeeded with `@dshfiles/frame-layout` included. The latest full suite ran 49 passed, 0 failed, 1 skipped, but its wrapper again failed to retain evidence. The attempted `tooling/dshx/e2e/support/evidence-reporter.ts` fix passed focused `pnpm --dir tooling/dshx run test:evidence` and Oxfmt, but the uncached full suite still failed: 49 passed, 1 failed, 0 skipped; the 721,353-byte evidence manifest exceeds its configured limit. The browser failure is the row-menu rename journey timing out on `Edit title` at `thread-sidebar.steps.ts:2141`. An independent read-only Host-test review suggests a shared-home/deferred-promotion race at `host.test.ts:199`; this remains unverified pending a fresh-home/awaited-promotion reproduction and stack trace. The previous full E2E was 45/50; focused comparison was main 1/5 and candidate 2/5, with candidate failures reproduced on main. Isolated test-support fixes are in candidate and clean-main workspaces; `browser-tasks.test.mjs` passes in both, and the revised compact-model-picker passed 1/1 on both. The latest candidate `pnpm check:e2e thread-sidebar` ran all 50 tests and all passed, but the wrapper exited 1 with `dshx E2E evidence could not be retained (Error)`. The latest full candidate E2E rerun completed 49 passed, 0 failed, 1 skipped, but the wrapper again failed evidence retention; `pnpm check:e2e:smoke` also passed earlier across 10 packages. The scratch failure was resolved by including `@dshfiles/frame-layout`, and the 10-step reach now succeeds. The isolated Host regression and full-suite evidence-retention issue remain under investigation; more ThreadSidebar WIP may still need description after final checks. Preserve baseline workspace `thread-sidebar-main-e2e` and artifact revision `jj:ca8d5f15`. Queue-Reorder is a validated idle candidate in `thread-a50310`: `jj:ecb70e83` (Host/dependency), `jj:f37b38ad` (schema parity), and `jj:bcaefb08` (E2E fixture). The candidate's TypeScript parity test moved to `.mjs` to avoid Host augmentations leaking into client typechecking. Package typecheck and 32 tests across 7 files passed; build produced 6 artifacts; Host import, 10 declaration-resolution comparisons, focused Oxlint/Oxfmt, and `features:check` passed. `pnpm check:e2e queue-reorder` passed 5/5; a targeted pristine-main scenario passed 1/1. The optional scratch `dev open queue-reorder/queued-attachment-previews` reach is still unverified: AI Accounts' Add Account flow needs provisional-connection support; its screenshot is preserved in the scratch evidence directory. Initial scratch doctor passed, though a later doctor reported AI Accounts pending after the failed open. This is separate from Queue's passing E2E path; integrate only after the active ThreadSidebar lane is idle. Repo-wide lint still has the same 13 cap-0 diagnostics on both trees; format checks list the same 23 pre-existing files, none in Queue-Reorder. Agents `jj:0d61b6e6`, PromptStash `jj:e05d1f75`, FFF, References, Tweet Context, and Web Search Brave are validated idle candidates awaiting integration; the live Brave request remains unverified. No questions remain. `main` is `jj:4c97f879`; default is `jj:4f9795b1`. Do not move default, run checkout sync, restart DSH, or push.

| Phase | Title                                 | State       | Wall time (6–8 agents) | Gate                                                               |
| ----- | ------------------------------------- | ----------- | ---------------------- | ------------------------------------------------------------------ |
| 0     | Decisions, conventions, tracer bridge | complete    | 1 day                  | ADR promoted; bridge parentage and lint fixtures green             |
| 1     | dshx Effect-native API                | complete    | 2–3 days               | Host service Layers, scaffold, full schema snapshot byte-identical |
| 2     | zod → Schema codemod                  | in progress | 2–3 days (overlaps 3)  | per-plugin JSON-schema parity, zero diff                           |
| 3     | Host halves, waves A–D                | in progress | 6–8 days               | per-plugin checklist all ticked                                    |
| 4     | Shared ports                          | in progress | 1 day (with wave A)    | consumers typecheck + journeys                                     |
| 5     | Browser logic (optional)              | not started | 5–7 days               | journeys + switch-probe budgets unchanged                          |
| 6     | Stabilization, perf, live restart     | not started | 2–3 days               | full e2e, perf table, one user-approved restart                    |
|       | **Host + dshx + Schema (0–4, 6)**     |             | **~2 weeks**           |                                                                    |
|       | **Incl. browser side (0–6)**          |             | **~3 weeks**           | bound by verification + machine load, not typing                   |

**Earlier checkpoint (superseded; see latest checkpoint above):** `usage` is integrated on `jj:46d422d1`; `worktree-memory` landed on `main` as `jj:b1f3d09e`, conflict-free. Pristine-main comparison confirmed the `stop-section` regression: the Effect layer captured `workspaceRegistry` before scratch registration; looking it up at snapshot time restored workspace groups. The stale tooltip test was corrected to hover and assert tooltip text. Candidate `stop-section` passed 1/1 and full `pnpm check:e2e worktree-memory` passed 2/2; package tests 19, typecheck, build, Host import, schema parity, `features:check` (85 catalogs), and scratch doctor/memory-board also passed. Preserve the separate baseline workspace for now. `backlog` remains paused after a scratch E2E timeout, `traces` remains blocked/paused with its WIP, and `ai-accounts` remains paused after seven E2E failures; its candidate was rebased onto `jj:46d422d1` as `jj:d3aa0c55`, but is not integrated. Preserve these incomplete lanes. Integrated in this run: `session-search`, `memory`, `jj-integration`, `secret-catalog`, `jujutsu`, and `usage`; earlier Wave B/C migrations are also on `main`. Phase 0/1 revisions (`jj:322e6858` plus supporting SDK/scaffold commits) are described ancestors of `main`. Verified foundation evidence: Effect/schema/tracing tests 45/45; `create-dshx` tests 23/23; `check:effect-antislop` and `features:check` passed. The full dshx package suite had one `host-generation.spec.ts` timeout (1013/1014), while that file passed alone (6/6); this is not proven baseline. Multi-host and Jujutsu E2E failures were reproduced on pristine `main` and are baseline-only. After each landing, rebase remaining active migration workspaces. The WTM, Git Worktrees, and Settings Shell integrations rebased the default workspace from `jj:bebfc1b5e52369e5d098af1200a12c5f6ab24187` to empty `jj:8add81d21e973df49141e300925cbbbf97493aad`, parented on current `main`; status is clean and conflict-free. Do not move the default workspace, run checkout sync, restart DSH, or push. Integrate candidates on `main` from isolated workspaces and rebase plugin threads only. Do not restart DSH or push.

Wave C status: `session-search`, `usage`, `worktree-memory`, `git-worktrees`, and `settings-shell` are integrated; current `main` is `jj:4c97f879`. Git Worktrees passed exact-`@` validation: integration tests 3/3, typecheck, build, Host import, `features:check`, byte-identical schema parity 1/1, formatting, and Host-only scratch DSH boot/doctor/cleanup. Settings Shell passed post-rebase typecheck, 67 package tests, build, Host import, `features:check` (85 catalogs), and scratch E2E 13/13. Its 27 normalized repo-wide lint diagnostics matched pristine main exactly (SHA-256 `f8cacf7b…`), confirming baseline. `backlog` remains paused with preserved WIP and a divergent duplicate copy; `traces` is blocked with preserved WIP; `ai-accounts` remains paused after E2E failures with one extra uncommitted edit. These incomplete lanes are untouched. `fff-search` is idle with one described candidate based on `main`, `jj:0baf0d2d5`; 13 tests, typecheck/build/Host import/lint/format, `features:check` (85 catalogs), scratch DSH open/shot/down, and `pnpm check:e2e fff-search` (1/1) passed. It awaits integration until the other migration lanes are idle. `references` is a described candidate at `jj:16f98e29`; 5 package tests, typecheck, build, Oxlint/Oxfmt, Host import, byte-identical schema snapshot (1/1), `features:check`, and scratch E2E (1/1) passed. `tweet-context` is a described candidate at `jj:87896ab9`; package tests (25 passed, 1 skipped), typecheck, build, Host import, schema snapshot parity (1/1), lint/fmt, `features:check`, and its actual `tweet-context.tool-catalog` scratch E2E (1/1) passed. `web-search-brave` is a described candidate at `jj:0a4b29b0`; typecheck, tests, lint/fmt, build, Host import, schema snapshot parity (1/1), `features:check`, and scratch DSH boot/doctor/shot passed. A live Brave request remains unverified: no Secret Catalog Brave alias is configured and `BRAVE_API_KEY` is unset; the catalog explicitly marks browser journey not applicable because the endpoint is fixed and needs a real key, while injected-fetch tests cover request/error behavior. Tweet Context, Web Search Brave, and References candidates await integration until active migration sessions are idle. FFF is now a validated idle candidate; see the current checkpoint above. Current ThreadSidebar and Queue-Reorder status is summarized there. Preserve the clean-main test artifacts in `thread-sidebar-main-e2e` and Queue-Reorder workspace `thread-a50310`; `thread-6fb184` hosts the References candidate. Remaining Wave D work: Agent Toolkit (`jj:350884fc`) and Resource-Packs (`jj:2082a930`) are validated idle candidates awaiting integration; unstarted items are `optmem-core`, `plugin-marketplace`, `agent-telemetry`, and the remaining sub-1k Hosts (~30). Keep one isolated JJ thread per plugin and the three-migration concurrency cap.

## Measured baseline (2026-10-29, `jj:main` 3c49886b)

| Fact                                                                             | Count                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| TS source / test lines                                                           | 315k / 82k                                                                           |
| Plugins under `plugins/@dshfiles/*` / with Host half                             | 82 / 81 (66 declare `host:` in `dshx.config.ts`)                                     |
| Plugin source lines: total / native forks / in scope                             | 273k / 67k / 206k                                                                    |
| dshx SDK (`tooling/dshx`)                                                        | 42k lines; 70 files import zod                                                       |
| Files using async/Promise                                                        | 656                                                                                  |
| Files importing zod (repo) / zod call sites in plugins                           | 402 / ~3.1k                                                                          |
| Files importing `effect`                                                         | 1 (`tooling/dshx/packages/dshx/src/effect/index.ts`, 185 lines, unused by plugins)   |
| API contracts (`defineApi`/`defineContract`)                                     | 68                                                                                   |
| Historical repository-wide source occurrences: `tool: {` / `defineTool(`         | 290 / 54 (not runtime schema counts; the sum 344 is not a schema target)             |
| Measured pre-Effect Host schema snapshot (57 collected bundles)                  | 446 API methods; 307 tool-marked bindings; 75 API schemas; 24 direct tools; 99 total |
| `withSpan`/`traced` call sites / `recordSpans` test files                        | 55 / 42                                                                              |
| Browser: `.tsx` files / TanStack Query files / stored-value files / xstate files | 454 / 122 / 42 / 4                                                                   |
| Unit test files / e2e feature files (`tooling/dshx/e2e/features`)                | 815 / 84                                                                             |

The historical `290 / 54` row is a repository-wide source inventory, not a
promise of 344 runtime schemas. The parity collector builds the 57 owned Host
bundles in [`tool-schemas.json`](../../tooling/dshx/e2e/fixtures/tool-schemas.json),
excluding the 13 native-fork/client-only packages listed above; that fixture
records the exact included package set. It captures actual `ToolRuntime.schemas()`
output: 75 API-generated schemas plus 24 declared tools. The 307 tool-marked API
methods are registration metadata, not 307 emitted schemas. The current and
pre-Effect snapshots match exactly for this planned owned-Host scope. The 30
`defineTool(` source call sites not represented in the 24 declared tools are
outside this collector's emitted set: eight are defined in eligible bundle
helpers/setup (`apply-patch`, `fff-search` ×2, `html-render` ×3,
`pulls-review`, `tool-search`), two are in `goal-stall-guard` which has no
`dshx.config.ts`, three are in excluded `goal-tool`, seven occur in plugin
integration/benchmark tests, and ten occur in dshx templates/tests. These source
sites are not synthesized into the snapshot.

## Versions and API names (verified)

| Item                 | Value                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned `effect`      | `4.1.0` (`pnpm-workspace.yaml` catalog); dshx peer `>=4.1.0 <5`; `@effect/vitest@4.1.0` is pinned for Effect tests                                       |
| Latest on npm        | `effect@4.1.0`; aligned `@effect/*` packages are exact-pinned at `4.1.0` when adopted                                                                    |
| Reference repo       | `~/.references/effect-4.1.0` is a detached worktree at `effect@4.1.0`; the pre-existing mutable `~/.references/effect` and its local edit were preserved |
| Errors               | `Schema.TaggedError<Self>()('Tag', fields)`                                                                                                              |
| Functions / spans    | `Effect.fn('name')(function* …)` (traced), `Effect.fnUntraced`, `Effect.withSpan`, `Effect.withSpanScoped`                                               |
| Services             | `Context.Service` (class-style service key), `Context.Reference`; `Layer`, `ManagedRuntime`, `Scope`                                                     |
| Interop              | `Effect.tryPromise({ try: signal => …, catch })`, `Effect.runPromiseExit(e, { signal })`                                                                 |
| Schema ↔ standards   | `Schema.toStandardSchemaV1`, `Schema.toStandardJSONSchemaV1`, `Schema.toJsonSchemaDocument`, module `JsonSchema`                                         |
| Platform (v4 merged) | `effect/FileSystem`, `effect/Path`, `effect/unstable/process` (`ChildProcess`), `effect/unstable/http`, `effect/unstable/observability` (`OtlpTracer`)   |
| Tracer hook          | `Tracer.make({ span, context })`, `Tracer.externalSpan`, `Tracer.ParentSpanKey`                                                                          |
| React state          | `@effect/atom-react` over `effect/unstable/reactivity` (`Atom.make`, `Atom.runtime`, `Atom.fn`, `Atom.family`, `AsyncResult`)                            |

## Scope

| In                                                                                                      | Out (and why)                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| dshx SDK runtime surfaces (`api`, `host`, `platform`, `tracing`, `communication`, `settings` Host side) | DSH core, Cordis services/hooks, the agent tool protocol: stay Promise                                 |
| Owned plugin Host halves (~60 plugins, ~206k lines total incl. client)                                  | Native forks (upstream sync cost; every delta re-applied on each bump): see list below                 |
| Shared ports `credential-port`, `vcs-provider-port`, `session-source-port`                              | `plugin-ui`, `ui-styles`, `shared-runtime`, React components                                           |
| Optional: browser data/state logic (Phase 5)                                                            | dshx CLI/compiler/scaffold (`cli`, `compiler`, `scaffold`, `scratch`: build tooling, no runtime value) |
| Settings: Host-side reads only                                                                          | `defineSettings` schemas: Cordis `schemastery`, rendered by core; stays                                |

### Native forks kept out (65–67k lines)

| Fork                 | Lines | Note                                                                                                  |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `chat`               | 15.4k | client only                                                                                           |
| `rich-composer`      | 15.2k | client only                                                                                           |
| `session-controller` | 11.1k | **Decision: out.** Host side vendored; consumers wrap its `continuation-api` with `DshxEffect.client` |
| `workspace-nav`      | 6.1k  |                                                                                                       |
| `subprocess-local`   | 5.0k  | Host; upstream transport                                                                              |
| `sidebar-right`      | 4.9k  |                                                                                                       |
| `user-questions`     | 2.2k  |                                                                                                       |
| `input-trigger`      | 2.1k  | vendored, no `native-fork.json` (see its `UPSTREAM.md`)                                               |
| `agent-preset`       | 1.8k  |                                                                                                       |
| `model-selection`    | 1.5k  |                                                                                                       |
| `frame-layout`       | 1.5k  |                                                                                                       |
| `goal-tool`          | 0.5k  |                                                                                                       |
| `hmr-gate`           | 0.6k  | reimplements upstream transport; keep shape-equal to upstream                                         |

Rule: an owned delta file inside a fork may call an Effect helper through a Promise adapter, never import `effect`
into a vendored file. `node scripts/native-fork-diff.mjs` must stay clean.

## Phase 0 — decisions and conventions

| #    | Decision               | Choice                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | Version                | Bump catalog to `effect@4.1.0` once (all `@effect/*` move in lockstep, exact pins). Refresh `~/.references/effect` to the `effect@4.1.0` tag.                                                                                                                                                                                                                                                        |
| 0.2  | One runtime per plugin | `ManagedRuntime.make(PluginLayer)` built in `DshxEffect.setup`; disposed with the plugin Scope on unload/reload. No global runtime.                                                                                                                                                                                                                                                                  |
| 0.3  | Tracing                | **Bridge, not a second exporter.** Implement an Effect `Tracer.make` that delegates to dshx `TracerModel.process()`; install it in every plugin runtime. Effect spans then nest under the dshx active span (`api-dispatch`, `agent-tool`) and leave through the existing OTLP export → `traces` plugin. Do not add `OtlpTracer`/`@effect/opentelemetry` (would duplicate spans and break parentage). |
| 0.4  | Span naming            | `Effect.fn('<subject> <verb>')` — same `<subject> <verb>` rule as the telemetry contract; attributes: identities and counts only. `dshx.features.json` `telemetry.custom` keeps naming the span; `recordSpans()` tests keep passing via the bridge.                                                                                                                                                  |
| 0.5  | Errors                 | One `Schema.TaggedError` per failure kind, defined next to the domain. Wire mapping already exists: `_tag` → `PluginApiError.code` (kebab-case). Defects stay internal.                                                                                                                                                                                                                              |
| 0.6  | Services               | `Context.Service` classes with `static layer`; Cordis `ctx.get(...)` reads only in the plugin's root Layer (edge adapter).                                                                                                                                                                                                                                                                           |
| 0.7  | Promise edge           | Allowed only in: dshx adapters, plugin `host.ts` registration, fork boundaries, tests. Lint: `effect-antislop` rule bans `runPromise` elsewhere.                                                                                                                                                                                                                                                     |
| 0.8  | Style                  | `Effect.fn` + `withSpan`, no `else`, dot notation, no destructuring, single-object args, `Schema.TaggedError`; `Effect.promise` only when no Effect API exists.                                                                                                                                                                                                                                      |
| 0.9  | Schema coexistence     | Contracts accept any Standard Schema already (`api/define.ts`), so zod and Effect Schema coexist per contract; migration is per plugin, not big-bang.                                                                                                                                                                                                                                                |
| 0.10 | Tests                  | `@effect/vitest` (`it.effect`, `it.layer`) for new Effect code; real services, no mocks (test Layers wrap real implementations with scratch dirs).                                                                                                                                                                                                                                                   |
| 0.11 | Abort                  | Every Host handler runs with the call's `AbortSignal` → fiber interruption (already in `DshxEffect.host`). Subprocesses via `ChildProcess` get killed on interrupt.                                                                                                                                                                                                                                  |

Deliverables: this ADR table promoted to `tooling/dshx/docs/sdk/effect.md`; antislop/effect-antislop rules enabled
for touched paths; `docs/observability.md` section on the bridge.
Verification: bridge unit test — an `Effect.fn` span inside `withSpan('parent')` records as child in `recordSpans()`; a
scratch DSH trace shows `api-dispatch → effect span` in `traces_get`.
Risks: Effect fiber context vs dshx AsyncLocalStorage parentage drift → test both directions (Effect inside dshx span,
dshx `withSpan` inside Effect).

## Phase 1 — dshx Effect-native API

Scope: `tooling/dshx/packages/dshx/src/{effect,api,host,platform,communication,tracing}` (~11k lines). Extend the
existing `@dshfiles/dshx/effect` export (`DshxEffect.host/setup/client/events/publish`).

| #   | Deliverable                                                                                                                                                                                                | Notes                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | `DshxEffect.plugin({ layer, setup })`: plugin lifetime = `Scope`, runtime = `ManagedRuntime` of `layer`                                                                                                    | replaces ad-hoc `ctx.on('dispose')`; reload closes Scope                                                                          |
| 1.2 | Host services as Layers: `PluginStorage`, `SecretValues`, `Subprocess` (`ChildProcess`), `HostApiClient`, `Communication`, `Settings` (read)                                                               | thin wrappers over existing dshx Promise modules                                                                                  |
| 1.3 | `DshxEffect.host` uses the plugin runtime by default; handler type `Effect<Out, TaggedError, Services>`                                                                                                    | typed failure union surfaces in contract docs                                                                                     |
| 1.4 | `defineApi` accepts Effect Schema directly (wrap with `Schema.toStandardSchemaV1` + `toStandardJSONSchemaV1` internally)                                                                                   | no call-site wrapping                                                                                                             |
| 1.5 | Tool schema parity harness: collect actual `ToolRuntime.schemas()` from the 57 eligible built Host bundles; compare the 99 emitted schemas against the pre-Effect baseline (75 API-generated, 24 declared) | committed snapshot `tooling/dshx/e2e/fixtures/tool-schemas.json`; 290 / 54 remain source-occurrence counts, not the schema target |
| 1.6 | Tracer bridge (0.3) shipped as `DshxEffect.tracerLayer`                                                                                                                                                    | default in 1.1                                                                                                                    |
| 1.7 | Streams: `events`/`publish` + `Stream` → Host event publication with backpressure                                                                                                                          |                                                                                                                                   |
| 1.8 | Promise API unchanged; Effect API is opt-in import                                                                                                                                                         | Promise adapters stay the public baseline                                                                                         |
| 1.9 | Docs: `tooling/dshx/docs/sdk/effect.md`, scaffold template `--template effect-host`                                                                                                                        |                                                                                                                                   |

Verification: `pnpm --dir tooling/dshx/packages/dshx test -- --run`, typecheck; tool-schema snapshot byte-identical vs
pre-change dump; one pilot plugin boots in `bootPluginProfile`.
Risks: Effect Schema JSON output differs from zod (`additionalProperties`, `$defs`, `anyOf` vs `oneOf`, `null`
handling, descriptions) → 1.5 snapshot is the gate; adjust annotations, never the projector, until zero diff.
Bundle size: Effect bundled per Host entry → measure `dist/index.js` size and Host boot time per plugin (Phase 6 budget).

## Phase 2 — zod → Schema codemod

Scope: 402 files / ~3.1k zod call sites (dshx 70 files; top plugins: ai-accounts 41, thread-sidebar 36, multi-host 20,
traces 18, jujutsu 17). Run per plugin inside its Phase 3 wave, not repo-wide.

| #   | Deliverable                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | ast-grep codemod (`safe-transformations` skill): `z.object/string/number/boolean/array/enum/literal/union/discriminatedUnion/optional/nullable/default/describe` → `Schema.*` |
| 2.2 | Residual report: `.refine/.superRefine/.transform/.preprocess/z.custom/.passthrough` listed per file for hand port                                                            |
| 2.3 | Parity check per contract: zod `toJSONSchema` vs `Schema.toJsonSchemaDocument` normalized diff + decode round-trip on recorded fixtures                                       |
| 2.4 | Tool schema snapshot (1.5) re-run per plugin                                                                                                                                  |
| 2.5 | Remove `zod` from a plugin's deps when its residual is zero; repo-wide drop only when count = 0                                                                               |

Verification: codemod idempotent (second run = no diff); `pnpm --dir plugins/@dshfiles/<p> typecheck test`; parity
script zero diff. Client forms (`@tanstack/react-form` + zod) stay on zod until Phase 5.
Risks: decode semantics (zod strips unknown keys; Effect Schema `Struct` also strips on decode but `exact` options
differ), `default` placement (decoding vs constructor), error message text shown in UI.

## Phase 3 — Host halves per plugin

Order by value: subprocess/job/queue/network heavy Hosts first (cancellation, retries, Scope gain most); thin CRUD last.
Waves run 6–8 agents in parallel, one plugin per agent workspace.

| Wave    | Plugins (src lines)                                                                                                                                                                                                                                                                                                                                                                             | Why                                                    | Days |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---- |
| A pilot | `secret-catalog` (5.1k), `jj-integration` (12.1k) + ports (Phase 4)                                                                                                                                                                                                                                                                                                                             | small subprocess Host, then the queue/cleanup-job Host | 2    |
| B       | `ai-accounts` (28.0k), `multi-host` (8.1k), `jujutsu` (12.9k), `backlog` (14.2k), `memory` (9.0k), `project-checks` (3.4k), `background-jobs` (2.1k)                                                                                                                                                                                                                                            | SSH, provider HTTP, durable jobs, polling              | 3    |
| C       | `traces` (9.2k), `usage` (6.2k), `mcp-servers` (4.3k), `annotations` (3.9k), `session-search` (2.0k), `activity-timeline` (1.9k), `agent-communication` (2.5k), `agent-questions` (2.8k), `editor` (2.7k), `worktree-memory` (1.9k), `settings-shell` (5.5k), `loopback-access` (1.2k), `pulls-review` (1.2k), `git-worktrees`, `fff-search`, `tweet-context`, `web-search-brave`, `references` | storage/indexing/IO, medium                            | 2    |
| D       | `thread-sidebar` Host part (21.9k total, mostly client), `agents`, `prompt-stash`, `queue-reorder`, `agent-toolkit`, `resource-packs`, `optmem-core` (Phase 3 N/A: library-only), `plugin-marketplace`, `agent-telemetry`, `tool-search`, remaining <1k Hosts (~29)                                                                                                                                                                        | thin Hosts; batch 4–5 per agent                        | 1–2  |

### Per-plugin checklist

| Step | Check                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | Dump tool schemas + API JSON schemas (before)                                                                        |
| 2    | Plugin `Layer` + `DshxEffect.plugin`; `ctx.get` only in root Layer                                                   |
| 3    | Handlers → `Effect.fn('<subject> <verb>')`; failures → `Schema.TaggedError`; no `try/catch` around Effects           |
| 4    | Timers/intervals/watchers → `Effect.forkScoped` + `Schedule`; subprocesses → `ChildProcess`                          |
| 5    | zod → Schema (Phase 2) for this plugin                                                                               |
| 6    | `dshx.features.json` telemetry entries still accurate; `recordSpans()` tests green through bridge                    |
| 7    | Tool + API schema dump (after) == before, byte-identical                                                             |
| 8    | `pnpm --dir plugins/@dshfiles/<p> build typecheck test`; `pnpm lint`; Host bundle import check (`dsh-plugin-verify`) |
| 9    | Plugin e2e journeys green in scratch DSH (`verify-dsh`); old-Host/new-client tolerance unchanged                     |
| 10   | One revision per plugin, `refactor(<plugin>): move Host half to Effect`                                              |

Risks: hidden ordering/race behaviour in hand-written queues (jj-integration `integration-queue-machine`, ai-accounts
pool) → port behaviour tests first, unchanged; parallel agents touching shared catalog/lockfile → lockfile edits only
in Phase 0.1.

## Phase 4 — shared ports

| Package                                    | Lines | Change                                                                                           | Consumers check                                 |
| ------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `credential-port`                          | 177   | reference grammar as Schema; `SecretReferenceResolver` as `Context.Service`; keep Promise export | every `host.bundleDependencies` user typechecks |
| `vcs-provider-port`                        | 92    | provider interface as Service + TaggedErrors; keep Promise interface                             | jj-integration, jujutsu, git-worktrees          |
| `session-source-port`                      | 199   | same pattern                                                                                     | its importers                                   |
| `plugin-ui`, `ui-styles`, `shared-runtime` | —     | untouched                                                                                        | —                                               |

Runs with wave A (jj-integration depends on `vcs-provider-port`).

## Phase 5 — browser logic (optional)

React stays. Only data/state logic moves; components unchanged.

| Target                             | Count                                   | Move to                                                                             |
| ---------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| TanStack Query files               | 122                                     | `Atom.runtime(layer)` + `Atom.fn` over `DshxEffect.client`; `AsyncResult` in render |
| `createStoredValue`                | 42 files                                | `Atom.kvs`/stored atom only if it removes code; otherwise keep                      |
| xstate                             | 4 files (`plugin-ui`, `shared-runtime`) | keep unless an atom is strictly simpler                                             |
| Event subscriptions                | —                                       | `DshxEffect.events` → `Stream` → atom                                               |
| Forms (`@tanstack/react-form`+zod) | —                                       | keep; switch validator to Standard Schema from Effect Schema                        |

Gate: `plugin-state` skill updated first; pilot `backlog` client, measure bundle + switch probe before continuing.
Risks: client bundle growth (Effect in every `dist/client.js`) → share one Effect copy via `shared-runtime` externals
or keep Phase 5 out; HMR stays per-bundle.

## Phase 6 — stabilization

| #   | Deliverable                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | All 84 e2e features green in scratch DSH (`dshx dev up`), full unit suite, `pnpm lint typecheck fmt`, `pnpm check:cycles`, `node scripts/native-fork-diff.mjs`                                                                    |
| 6.2 | Perf budgets (`live-performance-audit`): Host boot time, Host event-loop lag, per-plugin `dist/index.js` size, thread switch probe — before/after table in `docs/performance.md`; budget: ≤ +10% boot, no new >250 ms interaction |
| 6.3 | Trace check: a representative turn shows Effect spans nested under `api-dispatch`/`agent-tool`, no orphans (`traces_search`, `traces_service_map`)                                                                                |
| 6.4 | Live restart plan: land on `main`, `dshx checkout sync`, Host + client rebuild; **user** triggers one Host restart ("Restart when idle"); rollback = `jj` revert of the wave revision + rebuild                                   |
| 6.5 | `complete-plan`: move ADR into `tooling/dshx/docs/sdk/effect.md`, delete this plan                                                                                                                                                |

## Wall-time model

| Assumption                                              | Effect on estimate                               |
| ------------------------------------------------------- | ------------------------------------------------ |
| 6–8 parallel agents, one workspace each                 | waves B/C fit in 2–3 days                        |
| Verification (build + scratch DSH + journeys) dominates | machine load caps concurrency at ~6 scratch DSHs |
| Phase 2 rides inside Phase 3                            | no separate repo-wide codemod window             |
| Phase 5 pilot may stop the browser phase                | 3-week figure assumes go after the pilot         |

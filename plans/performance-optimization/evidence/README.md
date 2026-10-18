# Optimization audit evidence — 2026-10-18

This folder records bounded observations, not a product-wide performance certification. Source work packages live in the [master plan](../README.md), [client register](../client.md), [Host register](../host.md), and [tooling register](../tooling.md).

## Provenance and evidence classes

1. **Current-source facts:** source at audit start `ecfd5375f823`, based on `6a82b443dfe3`, in a dedicated JJ workspace. Forty-six owned package directories were mapped; depth differs by domain, as the registers explain. No core checkout was inspected or patched.
2. **Measured pure algorithm:** [graph-results.json](graph-results.json) executes the current TypeScript graph implementation in Node with synthetic fixtures. This is not a browser frame, React commit, keystroke, loading, or paint measurement.
3. **Measured built tool:** [checkout-results.json](checkout-results.json) executes the existing shared checkout's built dshx planner with no changed files, instrumenting real filesystem reads in a separate Node process. The matching source file hash was verified between source and built checkout; the artifact was not rebuilt for this audit. This demonstrates that actual artifact's work, not independent proof every output is fresh.
4. **Fresh runtime smoke:** [browser-results.json](browser-results.json) is a small/empty-fixture resource snapshot from a separate scratch instance; no active provider, long conversation, complete owned profile or streaming workload. It cannot establish loaded-product p95 or stable retained memory.
5. **Static scanner:** [compressed full Oxlint report](oxlint-baseline.json.gz) preserves all 1,861 warnings, zero errors, exit 0. Most concern code-quality boundaries, not performance. Count is not an optimization count; unstable-empty-array micro-tuning and broad lint cleanup were not promoted as high-value findings.
6. **Inherited browser baseline:** [earlier ADE audit](../../ade-performance/README.md) and its raw results already document 1/5/20 held-turn warm navigation. They are dated earlier evidence, not a new run here and not token streaming. That thread continued with an h-run of the same harness and reported materially worse, more variable numbers on a different scratch (agent creation p50/p95 186.1/587.2 ms, AI Accounts 150.8/968.7 ms, Activity 103.5/262.5 ms at 20 agents), so the earlier ~98–99 ms p95 is not a stable product guarantee. The h-run also stalled on repeated-turn output while the fake provider reused a fixed completion id (`created: 1`), which suggests stale turn content; the hypothesis is unproven and is a prerequisite check for any streaming benchmark (`plans/ade-performance/benchmark.mjs`, `tooling/dshx/packages/dshx/src/scratch/fake-command-code.ts`). The h-run's own instrumented numbers and the g-run figures must be reported as separate runs with variance, never averaged into one claim. Two operational facts from the same thread matter for reproducing M01: pass the exact scratch `--state-dir` on every command because an outer-shell `TMPDIR` can differ from the process default, and the live composer accessible name (`Message or run a task, / commands, @ files or sessions`) can differ from the harness constant, so later turns may need the contenteditable selector.

Node v22.23.3 (official fnm), pnpm 12.5.1, darwin/arm64; scratch Chromium 141.0.7390.37, viewport 1440×900. CPU/environment metadata, source hashes, scanner summary and existing-artifact sizes are in [audit-summary.json](audit-summary.json) and [bundle-sizes.json](bundle-sizes.json).

## Graph layout probe

[Portable runner](graph-benchmark.mjs) uses the actual graph module, one excluded warmup and seven measured runs for each fixture. Fixtures are linear first-parent history, and an 80%-side-chain/20%-trunk graph with eight revisions per side chain. The run validates returned row count and unique identities; it does not replace the comprehensive existing graph correctness fixtures.

| Revisions | Linear median / max (ms) | Branchy median / max (ms) |
|---:|---:|---:|
| 100 | 0.65 / 1.18 | 0.27 / 0.35 |
| 500 | 5.05 / 7.78 | 1.94 / 2.86 |
| 1,000 | 17.43 / 20.41 | 4.43 / 5.22 |
| 2,000 | 37.12 / 75.15 | 7.04 / 8.23 |

Order was not randomized; JIT/GC and concurrent system activity can affect values. No p95 claim from seven samples. This specifically motivates inspecting repeated linear parent-branch scans and raw-keystroke layout, not claiming branch-heavy graphs always cost more. A 2,000-revision fixture represents accumulated history, not the initial 100-row fetch.

A second run of the same archived runner, on the same machine minutes later, produced materially lower numbers: linear 1,000 p50 **15.94 ms** (max 17.24), linear 2,000 p50 **29.23 ms** (max 30.12), branchy 1,000 p50 3.47, branchy 2,000 p50 6.72. The 2,000-linear max alone moved from 75.15 ms to 30.12 ms. Both sample sets are kept ([first](graph-results.json), [second](graph-results-rerun.json)) because the spread is itself evidence: seven samples on a loaded machine cannot support a precise threshold, and any budget derived from this probe needs repeated runs and a tolerance. Reject a claim that linear layout is always ~30 or ~37 ms at 2,000 revisions.

Reproduce without modifying source or saved baseline:

```sh
node --experimental-strip-types plans/performance-optimization/evidence/graph-benchmark.mjs /private/tmp/graph-new-results.json
```

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

| Case | Before (audit baseline) | After |
|---|---|---|
| No changed files (shared checkout, maps only) | 74 maps / 53,913,303 bytes, 171.09 ms warm median | **0 maps / 0 bytes**, 6–16 ms warm |
| One changed source (shared checkout, maps only) | 74 maps / 53.9 MB | **2 maps / 4,099,100 bytes** (that package's own bundles), 20–114 ms |
| One changed source (manifest-backed package) | n/a | **1 manifest / 1,414 bytes**, 0 maps |
| Changed dshx runtime file | 74 maps / 53.9 MB | **1 manifest / 1,414 bytes** |

Selection is byte-identical in the unit suite, `dshx dev up` still boots from existing artifacts, and the timing spread above is why the counts, not the milliseconds, are the primary evidence.

## Baseline failures on main (not caused by optimization work)

Verify these against the revision you start from before attributing a red check to your own change:

- `pnpm lint` fails with `antislop(require-safety-comment-for-type-assertion): 338 findings, cap 336`. The changed `shared-streams` files contribute **0** of those findings, so the drift predates this work. Never raise the cap; fix the sites or leave main red as found.
- `pnpm --dir tooling/dshx run features:check` reports 8 issues in `jj-integration`, `pulls-review` and `thread-sidebar` (renamed/removed test references and one missing Gherkin tag). `shared-streams` reports none.
- `pnpm --dir tooling/dshx run browser-tasks:check` reports drift in about a dozen `turbo.json` files that this change never touches.
- `pnpm --dir tooling/dshx/packages/dshx exec vitest run` ends with one unrelated failure in `tests/compat.spec.ts` ("publishes a peer range accepted by package managers for every verified prerelease"): `satisfies` rejects a verified prerelease against `PROTOCOL_2_COMPATIBILITY.dshRange`. Neither optimization revision touches `src/compat`.

## Validation boundaries

- Oxlint baseline succeeded; warnings preserved and reported separately, not fixed.
- Planned final checks are documentation links/line anchors, JSON parsing, benchmark syntax/reproducibility, artifact privacy review and JJ diff scope. No product sources changed, so a full test/typecheck/build/browser suite would not prove these unimplemented optimizations.
- No real user database schema/count/query plan was collected. H07/H08/H12 require a consented read-only representative database or a seeded scratch copy before any SQL/index change.
- No real provider quota, secret reveal, OAuth login, marketplace installation, remote SSH mutation, cold full-profile navigation or 20-token-stream test was performed. Those are future measurement/implementation gates.
- CPU/latency wins, cache sizes/TTLs, final SLOs, storage migrations and library-specific API changes remain subject to the work-package checks. No “everything optimized” claim is supported by this audit.

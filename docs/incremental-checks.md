# Incremental development checks

## One development workspace

The root pnpm workspace includes plugins, SDK packages, workspace check packages and desktop. Run `pnpm install --frozen-lockfile` once. Plugin SDK dependencies use `workspace:*`; external installed DSH profiles retain `link:` because they live outside this workspace. The checked-in web profile seed remains a standalone deployment manifest. Scratch installation retains its separate [pnpm policy](../tooling/dshx/scratch-pnpm-policy.yaml) so a disposable profile never inherits development workspace discovery.

Turborepo 2.11.8 is pinned as a development dependency and uses its official platform binary. Vitest stays on 4.1.11. One local cache, `${XDG_CACHE_HOME:-$HOME/.cache}/dshfiles/turbo`, is shared by every JJ workspace of this repository: Turbo keys a task on its input content, not on the directory it runs in, so a linked thread workspace replays what another workspace already built instead of starting from an empty `.turbo/cache`. `scripts/turbo-cache.mjs` resolves that path, the dev shell exports it as `TURBO_CACHE_DIR`, and the check entry points pass it on. That shared cache is capped at 20GB with a 30-day age limit (`cacheMaxSize`, `cacheMaxAge`), because both eviction knobs default to disabled and one cache now serves every workspace and revision; the update notifier is off, since pnpm pins Turbo exactly. Remote caching is disabled. Neither install nor verification changes the active web profile.

## Package orchestration

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm exec turbo run build test typecheck --filter=@dshfiles/shared-streams
pnpm exec turbo run build --filter=@dshfiles/dshx
```

Build tasks follow workspace dependency builds and restore `dist` together with SDK incremental build metadata. Source-only libraries participate as transit nodes, so their changes invalidate consumers even without a build command. Typechecks and tests have separate task keys. A shared `test` task keys each package on its own files: the journey harness, the scratch pnpm policy and the checked-in profile seed are read only by tasks that are either uncached or declare them, so editing a shared Gherkin step file reruns the journeys that use it, not every package's unit tests. Existing plugin and SDK workspace check commands delegate their package work to Turbo; runtime boot gates still execute every time, with their prerequisite builds cached.

One bundle, `@dshfiles/ui-styles`, compiles the shared stylesheet, and its build fingerprint is what carries the all-plugins scan (`$TURBO_ROOT$/plugins/@dshfiles/**` inputs in `turbo.json`); every other UI plugin consumes the sheet without compiling it. A class change anywhere under the owned plugins therefore invalidates the owner's build and the build of the plugin that changed, so rebuilding those two is enough; an unrestricted `pnpm build` stays correct and replays every other task from cache. Non-UI documentation changes do not invalidate builds. Files under owned plugins remain UI scan inputs—even Markdown can contain Tailwind classes—while generated logs, caches and outputs are excluded. Test results for real SDK/scaffolding runtime suites remain uncached.

## Test selection

```sh
pnpm test:changed --from main --dry-run
pnpm test:changed --from '@-' --to '@'
pnpm test:related plugins/@dshfiles/shared-streams/src/shim.ts --dry-run
pnpm test:related plugins/@dshfiles/shared-streams/src/shim.ts
```

Changed mode uses `jj diff --from main --to @ --name-only` by default. It does not assume Git HEAD describes the JJ workspace. Both modes print selected packages and whether each runs related tests or its full suite, then build their dependencies through Turbo. Owned plugin code/style changes also select all plugin-ui consumer builds to preserve stylesheet deduplication; unchanged build hashes still hit cache. Related tests use `vitest related --run`; original package environment flags are preserved. Selective runs are not cached as full-suite passes.

An explicit `--since <Git commit-or-branch>` uses Vitest's native `--changed` inside related-mode packages. For example, `pnpm test:changed --since <base-commit>`. That same commit becomes the JJ package-selection base; it cannot be combined with `--from`. Native Git selection requires a Git-visible checkout; the default JJ-related lane works without one. Bare Vitest `--changed` only sees Git staged/unstaged state and is not a reliable JJ default.

Dependency changes run full dependent suites because consumers may import built files rather than original source modules. Manifest/config, CSS, fixtures, deleted files, scripts, CLI/runtime setup and shared workspace/profile changes also use full-suite fallback. Packages with known filesystem-read or variable-import test dependencies use full suites (AI accounts, queue reorder, thread sidebar, goal guard, JJ plugins and SDK/scaffolder). Real-JJ integration suites are uncached and retain their executable override. Shared repository/script changes also run root/helper tests. Documentation-only changes run no tests. Unknown non-Vitest test commands fall back to their regular full-suite command.

Vitest only follows static imports, including literal `import('./module')`. Files read through filesystem APIs, variable imports, subprocess inputs and external runtime state are not inferred. For changes crossing those boundaries, use `pnpm test` or the owning package's regular test command. These selective commands are a fast feedback lane, not a replacement for `pnpm check` or uncached browser/boot verification.

## Can a cheap model pick the tests?

Measured on 2026-10-24 on this checkout (Node 22.23.3, warm Turbo cache) with `scripts/test-selection-bench.mjs`, a mutation harness that records the test files the full package suite really fails and compares them with the files `vitest related` selects for the mutated source. Coverage truth came from one per-test-file V8 coverage pass over six ordinary packages (`shared-streams`, `memory`, `backlog`, `plugin-ui`, `usage`, `command-palette`: 116 test files, 221s to collect once).

### What selection costs

| Step                                                     | Wall time                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Package selection only (`pnpm test:related … --dry-run`) | 0.45-0.58s                                                               |
| `pnpm test:related` after one source edit                | **22.5s** (build: `ui-styles` 11.5s + owner 9.4s; tests 0.5s)            |
| `vitest related --run <file>` directly, no build         | 1.04s                                                                    |
| Owner package full suite (`vitest run`)                  | 1.10s                                                                    |
| Forced full owned-plugin suite, 132 tasks                | 291s wall, 628s of test-task time, median package 3.3s                   |
| Warm full owned-plugin suite, everything cacheable       | 189s; `jj-integration` and `jujutsu` are `cache: false` and always rerun |

Selection itself is not the cost: it decides in under a second. The authoritative lane spends about 20s rebuilding (`ui-styles` rescans every owned plugin for any plugin source edit) before running 0.5s of tests, while a direct `vitest related` run needs no build for same-package source changes.

### What selection misses

- Four real historical diffs, restricted to files unchanged since the commit: `vitest related` selected every test that covers a changed line (0 missed).
- 23 one-line mutations across the six packages, 13 of them fault-revealing (16 failing test files): the related selection contained **all 16 failing files** (0 missed) and exactly the 38 files that cover the mutated line. Median full package suite was 2.9s against 0.67s for the related run.
- The eight packages already forced to full suites (`ai-accounts`, `queue-reorder`, `thread-sidebar`, `goal-stall-guard`, `jj-integration`, `jujutsu`, `dshx`, `create-dshx`) were not benchmarked; they are the only known room for smarter selection, and their tests bind to filesystem, variable-import and real-JJ inputs where runtime coverage, not an LLM judgment, is the honest signal.

### What Jev does with the same changes

Jev's reachable contract is one `noul` probability per call (the Memory plugin's `JevClassifier`); it cannot enumerate tests in one call. Both uses were measured at `jev-latest`:

| Use                                                       | Calls | Latency p50 / p90 | Input tokens per call | Result                                                                                                                                      |
| --------------------------------------------------------- | ----- | ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-change gate: "does this break any test?"              | 23    | 160ms / 231ms     | 573                   | 74% accuracy against a 57% majority baseline; 2 false negatives, 4 false positives                                                          |
| Per-test ranking: "does this diff affect this test file?" | 22    | 150ms / 190ms     | 755                   | 22/22 on the easy sample (test source shown); enumerating all 649 test files would cost about 97s and 0.5M input tokens per change (~$0.02) |

Ranking every candidate test is slower than running the selected tests: a 15-test package needs about 2.3s of classification against 0.67s for the static related run, and the gate's two false negatives are exactly the risky changes it exists to catch. At the measured $0.042 per million input tokens, cost is negligible; latency and accuracy are not.

### How established projects do it

All production selectors found use dependency graphs, per-test coverage, or models trained on historical test outcomes, and all keep a safe fallback to the full suite:

- Meta's predictive test selection learns from historical outcomes and cuts testing infrastructure cost by 2x while keeping over 95% of individual failures and over 99.9% of faulty changes ([paper](https://arxiv.org/abs/1810.05286)).
- Develocity trains a model on Build Scan change/outcome history, offers conservative/standard/fast profiles, always runs new, changed, failed and flaky tests, and ships a simulator that replays history to estimate what it would have missed ([docs](https://docs.develocity.ai/2026.3/using-develocity/predictive-test-selection/)).
- Datadog's Test Impact Analysis matches per-test coverage against changed files; it names library dependencies, compiler options, external services and data files as blind spots and falls back through tracked files and `ITR:NoSkip` ([docs](https://docs.datadoghq.com/tests/test_impact_analysis/)).
- Azure Test Impact Analysis builds dependency maps for managed code and falls back to all tests for file types it cannot reason about; its guidance for trusting the selector is to run the selected tests and then the full suite and compare failures ([docs](https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-impact-analysis)).
- `jest --findRelatedTests` and `vitest related` use the static import graph; Nx `affected` and Turborepo `--filter=...[base]` run a whole affected project's tests; `pytest-testmon` records runtime coverage per test ([Jest](https://jestjs.io/docs/cli#--findrelatedtests-spaceseparatedlistofsourcefiles), [testmon](https://github.com/tarpas/pytest-testmon)).
- No production example was found of a model choosing repository tests by reading a diff without coverage or history; the LLM tools that appear in searches summarize a pull request and name tests, with no published recall.

### Verdict

Do not wire Jev into test selection. On this repository the static graph had no recall headroom to recover in ordinary packages, while a per-test LLM pass is slower than executing the selected tests and a per-change gate missed 2 of 13 real regressions. The measurable waste is elsewhere:

1. Skip the build before related runs of same-package source changes (1.0s against 22.5s here), and keep the build when a test consumes another package's `dist`; document that boundary rather than rebuilding by default.
2. If the eight full-suite packages should run less, record per-test coverage and select on it; that is the Datadog/Azure model and the only approach that sees their filesystem and dynamic-import dependencies.
3. Keep the fallbacks: manifests, configs, fixtures, deletions, non-source files and the known dynamic-input packages stay on full suites.

Unverified here: cold-CI behaviour, browser journey selection, flaky outcomes, and the eight full-suite packages above. `node --run bench:selection` reproduces the mutation comparison; `--jev` adds the gate when `JEV_API_KEY` is set.

## Skipping the build, and coverage instead of full suites

Measured on 2026-10-25 with the same mutation method plus a throwaway file-level per-test coverage index (a temporary `@vitest/coverage-v8`, not committed). Both experiments asked whether a specific cost can be removed without losing failures.

### Skipping the build for source-only related runs

`--build=auto` skips the Turbo build only when every selected package runs in related mode, no selected test file loads `dist` or its own package name, and no workspace dependency's built entry is missing. The default stays `--build=always` because a cold workspace has no outputs to run against. One source edit per scenario, a fresh edit for each variant:

| Package                                        | Build + tests | `--build=auto` | Result                                                              |
| ---------------------------------------------- | ------------- | -------------- | ------------------------------------------------------------------- |
| `shared-streams` (leaf)                        | 17.9s         | **1.7s**       | pass, build skipped                                                 |
| `traces` (leaf)                                | 22.1s         | **1.6s**       | pass, build skipped                                                 |
| `secret-catalog` (leaf)                        | 11.9s         | **0.8s**       | pass, build skipped                                                 |
| `prompt-stash` (test loads `../dist/index.js`) | 22.3s         | 23.0s          | pass, build still required                                          |
| `usage` (11 full dependent suites)             | 95.3s         | 95.3s          | one dependent suite failed here for a pre-existing workspace reason |

The saving applies to leaf packages: 443 of the 1760 commits touching plugins since 2026-08-01 changed only packages with no workspace dependents. Every other plugin edit keeps its build because its dependents run their full suites against the rebuilt package. A cold workspace is detected through the missing dependency entry: with the `dshx` dist moved away, the probe returned `unbuilt workspace dependency @dshfiles/dshx`.

### Coverage instead of a full suite

Method: run each test file once with V8 coverage, keep the source files it actually executed (not merely imported), select the tests whose recorded files intersect the change, and fall back to the full suite when the changed file is absent or the index is stale. Index cost and one mutation per package:

| Package          | Full suite   | Index build       | Ratio     | Mutation: selected / all | Selected run | Missed failures |
| ---------------- | ------------ | ----------------- | --------- | ------------------------ | ------------ | --------------- |
| `jj-integration` | 205.8-261.9s | 154.1s            | 0.6-0.75x | 3 / 37                   | **7.8s**     | 0               |
| `project-checks` | 12.5-17.7s   | 34.7s             | 2-2.8x    | 4-5 / 9                  | 1.7-16.5s    | 0               |
| `thread-sidebar` | 14.4s        | 416.5s collection | 29x       | not scored               | -            | -               |
| `ai-accounts`    | 12.2s        | 173.6s collection | 14x       | not scored               | -            | -               |

The first index run counted imported-but-unexecuted files, which made every test appear to cover every source file; the execution-only filter is what the `jj-integration` and `project-checks` rows use. The `thread-sidebar` and `ai-accounts` rows are collection cost only (those indexes were not rebuilt), and both are far above their suite cost.

Coverage selection pays only where the average test file runtime dwarfs Vitest startup, which here means the real-JJ suites: the index costs 0.75 of one suite, then each change runs about 8s instead of 206-262s, so one reuse covers the index. It does not pay for ordinary full-suite packages, and an index must be rebuilt whenever a test file changes, so it needs a content-keyed cache shared across workspaces before it is worth wiring.

### The larger cost: dependent fan-out

A one-file edit in `usage` selected 1 related package plus 11 full dependent suites and took 95.3s, yet only 12 of those 276 dependent test files statically reach `@dshfiles/usage` (4%). Rebuilding `usage` and running those 12 tests across six packages took about 23s of test time plus the build. That consumer-related selection is the highest-leverage follow-up, with full-suite fallback for the known dynamic-input packages; its recall under a real regression was not verified here because the probe mutation broke the build instead of the behavior.

Verdict: enable build skipping for leaf packages (measured 7-15x on that case, no failures), and treat coverage selection as a targeted tool for the real-JJ suites only. Neither touches the dependent fan-out, which is the dominant remaining cost.

## Validation

Dependency migration replaced 35 SDK link specifications, including the tool-meta package added on main while this work was in progress; one root install discovers 43 projects. The plugin workspace contract and shared Cordis module identity were verified. Selection regression tests cover owner/dependent selection, manifests/configs/fixtures/deletions, shared profile inputs, source-only libraries, dynamic-input fallbacks, CLI rejection and documentation-only skips.

- `pnpm run test:scripts`: 15 passing Node tests.
- `pnpm run test:tooling`: 15 passing evidence/inventory/feature-coverage tests, including real browser evidence collection.
- SDK scratch-profile regression file: 10 passing tests.
- `pnpm run test:related plugins/@dshfiles/shared-streams/src/shim.ts`: 32 successful build prerequisites followed by only 8 related tests.
- Repeated `turbo run build test typecheck --filter=@dshfiles/shared-streams`: all 7 tasks cached, 414ms warm run.
- Sibling CSS and Markdown hash probes invalidated UI consumers without changing the SDK build hash.
- Missing build output was restored byte-for-byte from cache without compilation.
- `pnpm run typecheck`: all 77 package/build/typecheck tasks passed.
- Repository lint ratchets passed; changed orchestration scripts have zero Oxlint findings; formatting passed.
- Scratch DSH loaded the shortcuts bundle with 158 active entries, healthy authentication/process checks and no Host error lines. It was shut down; the live web instance and profile were not changed.

The full uncached release/boot gate was intentionally not rerun. Scratch runtime health is verified; no plugin UI journey was changed or claimed as exercised.

References: [Turbo configuration](https://turborepo.dev/docs/reference/configuration.mdx), [Vitest 4.1.11 CLI](https://raw.githubusercontent.com/vitest-dev/vitest/v4.1.11/docs/guide/cli.md).

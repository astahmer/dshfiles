# Repository scripts

Profile orchestration, repository gates, the supervised launcher and the agent
helpers used from a shell. Plugin-specific checks and fixtures live in their
owning package.

## Root package commands

| Command                                           | Entry point                          | Purpose                                                                                                  |
| ------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `pnpm install:all`                                | `package.json`                       | Install the unified development workspace, then the Playwright browser.                                  |
| `pnpm check`                                      | `check:green` + `lint` + `fmt:check` | Every gate below plus repository-wide lint and format checks (CI runs the same blocks as parallel jobs). |
| `pnpm check:green`                                | `package.json`                       | Typecheck scripts, web-profile contract, dshx, plugins and desktop, without lint/format.                 |
| `pnpm check:diff`                                 | `check-diff.mjs`                     | Lint and format-check only the paths a revision touches (`--from`/`--to`, default `@-`..`@`).            |
| `pnpm check:plugin-boot`                          | dshx `test:boot`                     | Boot each owned bundle in a scratch profile and check its Client entries in a browser.                   |
| `pnpm profile:sync --profile <name>`              | `profile-sync.ts`                    | Reconcile a profile from its seed (the `dsh web` supervisor runs it before each start).                  |
| `pnpm profile:boot --profile <name>`              | `profile-boot.ts`                    | Start an isolated profile and report activation failures.                                                |
| `pnpm verify:web-profile-contract`                | `verify-web-profile-contract.mjs`    | Check the checked-in `profiles/web` seed against the owned bundles.                                      |
| `pnpm screenshots`                                | `plugin-screenshots.mjs`             | Capture each UI plugin's feature from a running scratch DSH into its `docs/screenshots/`.                |
| `pnpm check:screenshots`                          | `plugin-screenshots.mjs --check`     | Every UI plugin ships a screenshot its README embeds ([rule](../docs/plugin-screenshots.md)).            |
| `pnpm typecheck:scripts`                          | `tsc -p scripts/tsconfig.json`       | Typecheck the repository's TypeScript scripts.                                                           |
| `pnpm bench:selection`                            | `test-selection-bench.mjs`           | Mutation benchmark: do related tests catch what a package's full suite catches?                          |
| `node scripts/ci/plugin-shard.mjs <i> <n> [boot]` | `ci/plugin-shard.mjs`                | One deterministic slice of the owned plugins for the parallel CI matrices (test or boot).                |

## Other scripts

Runnable on their own or imported by the commands above; each has a test beside it.

| Script                                                                                                                                                                    | What it does                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `check-browser.mjs`                                                                                                                                                       | Runs the plugin-boot, e2e and smoke browser matrices (`check:plugin-boot`, `check:e2e`, `check:e2e:smoke`).                               |
| `check-api-spans.mjs`                                                                                                                                                     | Live proof that each dshx API call produces exactly one `<api>/<method>` server span.                                                     |
| `check-effect-antislop.mjs`                                                                                                                                               | Enforces the Effect anti-slop rules against `tooling/antislop/effect/baseline.json`.                                                      |
| `check-zod-imports.mjs`                                                                                                                                                   | Fails when owned source imports `zod` outside a recorded bridge.                                                                          |
| `effect-native-audit.mjs`                                                                                                                                                 | Ratchets the Promise facades that are not native Effect yet (`check:effect-native`).                                                      |
| `effect-schema-codemod.mjs`                                                                                                                                               | Codemod that moves manual validation onto Effect Schema.                                                                                  |
| `fork-audit.mjs`                                                                                                                                                          | Compares this fork's shared-plugin deltas against Astahmer, from `fork-policy.json`.                                                      |
| `copy-check.ts`                                                                                                                                                           | Glossary and plugin-name ratchet on user-facing labels (`check:copy`).                                                                    |
| `workspace-cycles.mjs`                                                                                                                                                    | Fails on a dependency cycle between workspace packages; same check as `dshx check repo --only cycles`.                                    |
| `ade-migration-map.mjs`                                                                                                                                                   | Generates `docs/ade-ux/migration-map.md` and thread-sidebar's `moved-to.generated.ts`.                                                    |
| `native-fork-diff.mjs`                                                                                                                                                    | Diffs each `native-fork.json` fork against its pinned upstream (`check:native-forks`).                                                    |
| `test-selection.mjs`                                                                                                                                                      | JJ-aware changed and related test selection (`test:changed`, `test:related`).                                                             |
| `turbo.mjs`, `turbo-cache.mjs`                                                                                                                                            | Run Turbo against the repository's shared cache directory.                                                                                |
| `launch-dsh.mjs`, `launcher-config.mjs`                                                                                                                                   | The supervised launcher: read the machine-local launcher config, start one DSH.                                                           |
| `supervise-dsh.mjs`                                                                                                                                                       | Supervise that DSH: restart when idle and the confirmed-request protocol; upstream delta in its `.UPSTREAM.md`.                           |
| `network-startup-patch.mjs`                                                                                                                                               | Write the profile's network-access startup choice.                                                                                        |
| `prepare-manuel-source.mjs`, `verify-manuel-candidate.mjs`                                                                                                                | Build and verify the source-linked candidate the supervisor starts.                                                                       |
| `jj-state.mjs`                                                                                                                                                            | One-shot Jujutsu state for an agent: workspace, working copy, conflicts, `main                                                            | main@origin`, revisions above `main`. |
| `plugin-screenshots-core.mjs`                                                                                                                                             | The pure decisions behind `plugin-screenshots.mjs`, testable without a scratch DSH.                                                       |
| `lint-ratchet.ts`                                                                                                                                                         | Runs oxlint and ast-grep, enforcing the per-rule caps in `lint-ratchet.json`.                                                             |
| `json.ts`                                                                                                                                                                 | The one JSON-parse helper every script uses.                                                                                              |
| `self-improve.ts`, `self-improve-mine.ts`, `self-improve-review.ts`, `self-improve-ledger.ts`, `self-improve-log.ts`, `self-improve-corpus.ts`, `self-improve-harness.ts` | `/self-improve`: mine Session logs, validate candidate signals, maintain the ledger and record runs, build the corpus, render the review. |
| `fff-bench.ts`, `fff-bench-dsh.ts`                                                                                                                                        | The fff search benchmark for Claude Code sessions and its DSH half.                                                                       |

Fixtures and baselines sit beside them: `copy-check.baseline.json`, `effect-native-audit.baseline.json`,
`lint-ratchet.json`, `screenshot-ignore.json`, `fff-bench-tasks.json`, plus `ci/` (CI shards) and `dsh-lkg/`.

## Incremental checks

See [incremental-checks](../docs/incremental-checks.md) for package caching, JJ-aware changed tests, explicit related tests, and full-suite fallback boundaries.

## Last known good

[`dsh-lkg/`](dsh-lkg/README.md) snapshots a complete working DSH runtime and
restores it with `dsh-recover`. The nixfiles `dsh-lkg` alias runs `dsh-recover`.

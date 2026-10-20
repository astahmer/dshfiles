# Repository scripts

Profile orchestration and repository gates. Plugin-specific checks and fixtures
live in their owning package.

## Root package commands

| Command                              | Entry point                          | Purpose                                                                                       |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `pnpm install:all`                   | `package.json`                       | Install the unified development workspace, then the Playwright browser.                       |
| `pnpm check`                         | `check:green` + `lint` + `fmt:check` | Every gate below plus repository-wide lint and format checks.                                 |
| `pnpm check:green`                   | `package.json`                       | Typecheck scripts, web-profile contract, dshx, plugins and desktop, without lint/format.      |
| `pnpm check:diff`                    | `check-diff.mjs`                     | Lint and format-check only the paths a revision touches (`--from`/`--to`, default `@-`..`@`). |
| `pnpm check:plugin-boot`             | dshx `test:boot`                     | Boot each owned bundle in a scratch profile and check its Client entries in a browser.        |
| `pnpm profile:sync --profile <name>` | `profile-sync.ts`                    | Reconcile a profile from its seed (the `dsh web` supervisor runs it before each start).       |
| `pnpm profile:boot --profile <name>` | `profile-boot.ts`                    | Start an isolated profile and report activation failures.                                     |
| `pnpm verify:web-profile-contract`   | `verify-web-profile-contract.mjs`    | Check the checked-in `profiles/web` seed against the owned bundles.                           |
| `pnpm screenshots`                   | `plugin-screenshots.mjs`             | Capture each UI plugin's feature from a running scratch DSH into its `docs/screenshots/`.     |
| `pnpm check:screenshots`             | `plugin-screenshots.mjs --check`     | Every UI plugin ships a screenshot its README embeds ([rule](../docs/plugin-screenshots.md)). |
| `pnpm typecheck:scripts`             | `tsc -p scripts/tsconfig.json`       | Typecheck the repository's TypeScript scripts.                                                |

## Incremental checks

See [incremental-checks](../docs/incremental-checks.md) for package caching, JJ-aware changed tests, explicit related tests, and full-suite fallback boundaries.

## Last known good

[`dsh-lkg/`](dsh-lkg/README.md) snapshots a complete working DSH runtime and
restores it with `dsh-recover`. The nixfiles `dsh lkg` command calls its CLI.

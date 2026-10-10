# Repository scripts

Plugin-specific scratch checks and fixtures live in their owning package. This directory contains profile orchestration, shared core-runtime test helpers, and cross-plugin browser gates.

## Root package commands

| Command | Entry point | Purpose |
|---|---|---|
| `pnpm install:all` | `with-local-core-dependencies.mjs --prepare` | Install workspace dependencies and prepare local core links. |
| `pnpm check` | `check` pipeline | Typecheck scripts, check dshx/plugins, run boot and core-runtime integrity checks, lint, format-check. |
| `pnpm verify:cordis-identity` | `verify-cordis-identity.mjs` | Check Cordis package identity across owned packages. |
| `pnpm verify:core-runtime-identity` | `verify-core-runtime-identity.mjs` | Check local core-runtime package identity. |
| `pnpm sync:core-api-session-controller` | `sync-dsh-core-api-session-controller.mjs` | Regenerate and sync the maintained API Session Controller fork. |
| `pnpm verify:core-runtime-scratch` | `verify-core-runtime-scratch.mjs` | Exercise local core runtime in a scratch profile. |
| `pnpm verify:project-checks-scratch` | Project Checks `verify:scratch` | Build and exercise Project Checks with real scratch-JJ edits and hook results. |
| `pnpm verify:dsh-customization` | `dsh-customization-verify.mjs` | Cross-plugin visual/browser integration gate. Currently defaults to `http://127.0.0.1:3080`; pass `DSH_ORIGIN` for a scratch instance and do not run against the live profile. |
| `pnpm verify:dsh-customization:a11y` | `dsh-customization-a11y.mjs` | Cross-plugin accessibility, keyboard, theme, and zoom gate. Currently defaults to `http://127.0.0.1:3080`; pass `DSH_ORIGIN` for a scratch instance and do not run against the live profile. |
| `pnpm profile:sync --profile <name>` | `profile-sync.ts` | Reconcile local bundle links and profile dependencies. |
| `pnpm profile:boot --profile <name>` | `profile-boot.ts` | Start an isolated profile and report activation failures. |
| `pnpm typecheck:scripts` | `tsc -p scripts/tsconfig.json` | Typecheck the repository's TypeScript scripts. |

## Shared helpers and manual tools

- `core-runtime-scratch-host.mjs` — scratch Host launcher shared by Core Runtime and Project Checks verifiers.
- `trace-core-runtime-imports.mjs` — import tracing preloader used by the core-runtime scratch verifier.
- `fixtures/profile-readiness.mjs` — temporary readiness bundle injected by the scratch Host helper.
- `dsh-web-probe.mjs` — manual browser/console/network evidence probe; use only with an authenticated scratch URL and do not persist tokenized URLs.
- `with-local-core-dependencies.mjs` — temporary local dependency overlay used by Core Runtime package scripts and initial setup.

Agent Questions scratch verification and fixture live in [`agent-questions`](../plugins/@dshfiles/agent-questions/README.md); Project Checks verification lives in [`project-checks`](../plugins/@dshfiles/project-checks/README.md); OptMem performance drivers live in [`optmem`](../plugins/@dshfiles/optmem/README.md). The [package index](../README.md#owned-dsh-bundles) links every package.

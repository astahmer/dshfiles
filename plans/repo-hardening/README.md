# Repo hardening

Status: **in progress** — Phases 0 and 1 done, Phase 2 next.

Progress is tracked here and nowhere else. Tick a box in the same jj change
that does the work. Each phase closes with the full check run, and the next
phase starts only after review.

## Decisions

| Question | Decision |
|---|---|
| Unmerged jj heads | Keep relevant work, drop superseded copies (see Phase 0) |
| Protocol-1 adapter and `phase-a` fixture | Retire |
| dshx runtime AST code under TS 7 | Port from the TypeScript compiler API to `oxc-parser` |
| `flake.nix` dshx package | Make it a pure build: dependencies fetched by a hash-pinned fixed-output derivation, no network in the build |
| `plugin-marketplace` | Move from `tooling/dshx/packages` to `plugins/@dshfiles` |
| Bundles in the `web` profile | Install every owned bundle |
| Execution | Phase by phase, separate jj workspace `hardening`, review between phases |

## Baseline (2026-10-04, after Phase 0 merges)

- All 9 plugins typecheck. 6 have tests and pass them; ai-accounts and
  queue-reorder have none.
- dshx: typecheck clean; vitest 35/36 files pass, 9 tests in `tests/cli.spec.ts`
  fail against the current `cli/args.ts`.

## Phase 0 — Clean the graph

- [x] Rebase the platform CLI branch (`feat(dshx): add authenticated DSH
      platform CLI`, `expand DSH platform CLI`) and agent communication onto the
      mainline; resolve the status table and lockfile conflicts
- [x] Rebase `docs: stop carrying another project's product names into ours`
- [x] Abandon superseded work: the `wip: DSHX platform CLI` copies, the
      ai-accounts panel wips, the conflicted queue-reorder, AGENTS and fork-docs
      copies, the undescribed fork-metadata prune, and the empty workspace wips
- [x] Forget the stale `/private/tmp` jj workspaces; delete the `bb/*` and
      `dshfiles-bb-base` bookmarks
- [x] Root `.gitignore` owns `node_modules/`, `dist/`, `.test-dist/`, `.vite/`
      instead of relying on a global ignore; untrack the `.pnpm-store` symlink;
      drop the empty `.fork-history/`
- [x] Replace the `allowBuilds` placeholders: no dependency builds natively in
      either workspace
- [x] Create the `main` bookmark on this stack
- [ ] Rebase the parallel queue-reorder/thread-sidebar stack
      (`fix(queue-reorder): own the queue dock locale namespace` onward) onto
      `main` once its agent stops editing; it also touches
      `tooling/dshx/packages/dshx/src/client/locale.ts`

## Phase 1 — Security and red builds

- [x] ai-accounts: key variables must end in `_API_KEY` and every read goes
      through `readKeyFromEnv`; a Command Code base must be https on
      `commandcode.ai` or a loopback address
- [x] ai-accounts: model discovery passes the key value, not an env name; a
      draft base URL never receives the stored key
- [x] ai-accounts: the shared OpenCode key is only used for OpenCode routes
- [x] ai-accounts: Codex homes must resolve inside the user's home; an invalid
      account is skipped with a warning instead of failing every route
- [x] secret-catalog: free-text metadata may not start with `-`; schemas
      defined once in `secret-arguments.ts`
- [ ] secret-catalog: check-then-set race on create — deferred. Whether
      `secret set` without `--force` refuses an existing item when stdin is not
      a TTY is unverified (the CLI is a compiled binary); verify against a
      throwaway vault before changing it
- [x] dshx: option scopes declared once in `cli/args.ts`; `dev --port` and
      `check --boot --port` both work
- [x] dshx: `tests/cli.spec.ts` ported to a protocol-2 fixture with the DSH
      installation injected; eslint clean
- [x] Regression tests: ai-accounts 27 (new), secret-catalog +1, dshx parser

Exit evidence: dshx tsc and eslint clean, vitest 36/36 files, 378 tests;
all 9 plugins typecheck; plugin tests 103/103.

## Phase 2 — Prune the fork

- [ ] Delete `apps/framework-hub`, `framework-hub-cli`, `hub-ops-prompt`, hub,
      SEO and release scripts, `.changeset/`, nested `.github/`, `renovate.json5`
- [ ] Move `plugin-marketplace` to `plugins/@dshfiles/plugin-marketplace`
- [ ] Retire protocol-1: adapter, `phase-a` fixture, conversation-assembly spec
- [ ] Delete public-project docs (PRD, technical design, roadmap, releasing,
      contributing, CoC, security, zh-CN, changelog, platform CLI plan)
- [ ] Rewrite the dshx README and `docs/compatibility.md` around protocol-2;
      fix `getting-started.md` (`applies`, `dshx create`)
- [ ] knip covers every `exports` subpath; drop unused dependencies

## Phase 3 — One workspace contract

- [ ] Root task runner: one `check` runs typecheck, test, lint, fmt and build
      across plugins and dshx
- [ ] Every plugin has `build`, `test`, `typecheck`, `lint`
- [ ] Tests for ai-accounts and queue-reorder; thread-sidebar moves to vitest;
      mcp-servers typechecks its tests
- [ ] Align peer ranges; remove duplicated `peerDependencyRules`; enable
      `noUncheckedIndexedAccess` everywhere

## Phase 4 — Toolchain

- [ ] Oxlint and Oxfmt replace eslint and prettier repo-wide, with the antislop
      rules
- [ ] TS 7 typecheck through `@typescript/native-preview`
- [ ] dshx AST code (`project/typecheck.ts`, `project/migrations.ts`,
      `scaffold/*`, `compiler/client/capabilities.ts`) ported to `oxc-parser`
- [ ] `create-dshx` templates target the new toolchain

## Phase 5 — Shared dshx helpers

- [ ] Client env types entry replaces the six `css-modules.d.ts` copies
- [ ] Host subprocess runner replaces the jujutsu, secret-catalog and
      mcp-servers copies
- [ ] One locale API across plugins

## Phase 6 — Plugin quality

- [ ] ai-accounts: parse config through its zod schema, split
      `accounts-panel.tsx` and `host.ts`, remove the module singleton
- [ ] queue-reorder: remove `as never` by fixing the types where they belong
- [ ] zod at the remaining hand-narrowed boundaries; redacted debug logs
      instead of swallowed errors; arrow functions in mcp-servers
- [ ] Locales for jujutsu, secret-catalog, settings-search
- [ ] dshx: tests for the boot check and platform commands; decode inspect
      bridge RPC results

## Phase 7 — Install and verify

- [ ] Profile sync script links every owned bundle into `web` and installs
- [ ] Boot smoke test fails on any "did not activate" line
- [ ] Browser walk-through of every plugin
- [ ] Correct the integration review install steps; add an installed column

## Phase 8 — Docs and Nix

- [ ] Root README with a plugin inventory table
- [ ] AGENTS.md: resolve contradictions, move pnpm traps and creator-mode notes
      to `docs/`
- [ ] Remove or rehome `scripts/dsh-session-status.mjs`
- [ ] Multi-system flake; one pnpm source; pure dshx package

## Phase 9 — New capability

- [ ] Port sidebar-resize into thread-sidebar
- [ ] Port sidebar-commands
- [ ] Port diff-viewed, if a changes-panel slot exists
- [ ] Desktop shell Phase 0 spike

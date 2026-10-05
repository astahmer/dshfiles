# Repo hardening

Status: **in progress** — Phases 0–6 done; 7 and 8 partly done; 9 not started.

Progress is tracked here and nowhere else. Tick a box in the same jj change
that does the work. Each phase closes with the full check run, and phases continue autonomously under the user's 2026-10-04 instruction.

## Decisions

| Question | Decision |
|---|---|
| Unmerged jj heads | Keep relevant work, drop superseded copies (see Phase 0) |
| Protocol-1 adapter and `phase-a` fixture | Retire |
| dshx runtime AST code under TS 7 | Port from the TypeScript compiler API to `oxc-parser` |
| `flake.nix` dshx package | Make it a pure build: dependencies fetched by a hash-pinned fixed-output derivation, no network in the build |
| `plugin-marketplace` | Move from `tooling/dshx/packages` to `plugins/@dshfiles` |
| Bundles in the `web` profile | Install every owned bundle |
| Execution | Phase by phase, separate jj workspace `hardening`, autonomous continuation between phases |

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
- [x] Rebase the parallel queue-reorder/thread-sidebar stack onto `main`
      (done by hand); `zsqq` had swept in 21 lines of another agent's unfinished
      dshx `capabilities.ts` work, moved back into that agent's change

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
- [x] secret-catalog: check-then-set race on create is benign. Verified in
      `~/dev/secret-cli` (`secret/Sources/secret/main.swift`, set overwrite
      branch): without `--force` and with no TTY, `set` fails with "item
      already exists"; the plugin never passes `--force` on create
- [x] dshx: option scopes declared once in `cli/args.ts`; `dev --port` and
      `check --boot --port` both work
- [x] dshx: `tests/cli.spec.ts` ported to a protocol-2 fixture with the DSH
      installation injected; eslint clean
- [x] Regression tests: ai-accounts 27 (new), secret-catalog +1, dshx parser

Exit evidence: dshx tsc and eslint clean, vitest 36/36 files, 378 tests;
all 9 plugins typecheck; plugin tests 103/103.

## Phase 2 — Prune the fork

- [x] Delete `apps/framework-hub`, `framework-hub-cli`, `hub-ops-prompt`, hub,
      SEO and release scripts, `.changeset/`, nested `.github/`, `renovate.json5`;
      both packages private (−142k lines)
- [x] Move `plugin-marketplace` to `plugins/@dshfiles/plugin-marketplace`; it
      had never been ported to DSH 0.2 (icons, SettingsScope)
- [x] Retire protocol-1: adapter, conversation-assembly spec, smoke script. The
      `phase-a` fixture was really a 0.2 fixture; tests write it from
      `tests/plugin-fixture.ts`
- [x] Delete public-project docs; rewrite the dshx README and
      `docs/compatibility.md` around protocol-2; package READMEs and creator docs
      use `dshx create`
- [x] knip covers every `exports` subpath; dead `client/ambient.ts` and three
      unused devDependencies removed
- [x] Found on the way: Settings types accepted `base`, `validate` and
      `applies: 'restart'` that the DSH 0.2 runtime rejects (the marketplace
      would have failed at activation); `DSHX5107` was shared by two errors,
      the Host-provided one is now `DSHX5110`

Exit evidence: dshx tsc, eslint and knip clean; vitest 35/35 files, 377 tests
(`--maxWorkers=4`; machine load average ~30 makes the default run time out a few
watcher tests that pass alone); all 10 plugins typecheck; plugin tests 136/136.

Left for later phases: unreachable protocol-1 conversation wiring in
`src/client/runtime.ts` (`conversationEvents`) and `compat/types.ts`
(`eventService`) — Phase 6, with `defineConversation` itself.

## Phase 3 — One workspace contract

- [x] Root `package.json`: `pnpm check` runs the dshx check, lint and knip, then
      the plugin workspace check; `pnpm install:all` installs both
- [x] `plugins/`: `pnpm check` = contract, typecheck, test, build;
      `scripts/check-workspace-contract.ts` fails when a package lacks a script
      or strict compiler options (pnpm -r silently skips missing scripts)
- [x] Tests for queue-reorder (pure `queue-order.ts`, `as never` casts gone)
      and agent-communication (untrusted peer text boundary); thread-sidebar,
      jujutsu and mcp-servers tests moved to typechecked vitest
- [x] Peers derived from imports and `dsh.client.inject`; one DSH range, one
      cordis range, pinned devDependencies; duplicated `peerDependencyRules`
      removed; `noUncheckedIndexedAccess` everywhere; pnpm 12.5.1 in both
      workspaces
- [x] Toolchain rule earned by queue-reorder and ai-accounts: dshx `DSHX4224`
      warns when an injected provider is not a peer; templates derive the peers

Exit evidence: root `pnpm check` exit 0 — dshx 378 tests, create-dshx 20, all
10 plugins typecheck, test (144) and build.

## Phase 4 — Toolchain

- [x] Oxlint 1.86.0 and Oxfmt 0.71.0 replace eslint and prettier; root lint
      and format gates cover both workspaces. Reused the owned emilint bundle
      with pinned revision provenance. Existing antislop findings are warnings
      pending Phase 6; correctness rules are errors. React behavior rules remain
      outside this mechanical migration.
- [x] Stable TypeScript 7.0.2 replaces TS 5 throughout both workspaces.
      Project checks execute its native CLI (no unstable compiler API).
- [x] dshx AST code (`project/typecheck.ts`, `project/migrations.ts`,
      `scaffold/*`, `compiler/client/capabilities.ts`) ported to `oxc-parser`
- [x] `create-dshx` templates target TS 7, Oxlint and Oxfmt; script/config
      assertions cover all template/style combinations.

Evidence: dshx 386 tests, create-dshx 20 tests, both typechecks and builds
pass. Native compiler diagnostics and Unicode source offsets have regressions.
Knip passes with the previously recorded temporary ownership exclusion.
The full plugin gate still has inherited queue-reorder decorator typing and
the rejected bash-parallel experiment; neither is claimed green.

## Integration repair (2026-10-04)

The integration onto `main` left the root gate red; earlier "green" reports
never ran `pnpm check` end to end. Fixed:

- [x] The locale-ownership change was rebased from a stale `package.json` and
      dropped the `./client/env` export: every generated project failed TS2688
- [x] knip: stale locale-ownership ignore removed; e2e suite and slot smoke
      script are entries
- [x] The contract crashed on an ignored directory holding only `node_modules`
- [x] `shortcuts` (landed after Phase 3) joined the contract; its new test found
      checkboxes swallowing every chord
- [x] Setup-service checks matched neither the runtime nor DSH: an undeclared
      `inject` gets `locale` and `slots`, and `slots` is renderer-owned. The Oxc
      port began detecting `ctx.slots`, so every imperative-Slot plugin failed
      to build
- [x] The virtual `dshx/host` module never exported the Phase 5 process
      helpers, so jujutsu, secret-catalog and mcp-servers could not build

Evidence: root `pnpm check` exit 0 — dshx 409 tests, create-dshx 21, 12
plugins typecheck, test (172) and build; lint and format clean.

## Phase 5 — Shared dshx helpers

- [x] `@dshfiles/dshx/client/env` packages the ambient CSS types. Seven
      plugin copies removed; templates consume the shared declaration.
- [x] Shared Host process exit/termination helpers replace repeated cleanup
      in jujutsu, secret-catalog and mcp-servers. Domain runners remain separate:
      persistent MCP processes, secret input/redaction, and JJ repository identity
      have different ownership contracts.
- [x] All plugin locale definitions use `defineLocale`; legacy alias remains
      for compatibility. The global namespace widening needs a separate Phase 6
      correctness fix, rather than more claims about generic declaration merging.

Phase 5 evidence: shared helper consumers pass secret-catalog 24, MCP 19,
JJ 12 tests; creator 20 tests, dshx typecheck and generated-project checks pass.
Two ambient declaration entries have a narrow triple-slash lint exception: the
wildcard declaration is a global script, so a module import cannot replace it.

## Phase 6 — Plugin quality

- [x] ai-accounts: module singleton replaced by a context-owned runtime;
      `account-config.ts` builds config from the zod-validated store
- [x] ai-accounts: `accounts-panel.tsx` 1058 → 47 lines over a state hook
      and per-section files (redone on current code after the first split was
      lost in the re-land; the account switch, which double-negated, now toggles)
- [x] ai-accounts: `host.ts` split into API/quota handlers, provider-profile
      construction, and provider-route/config mapping modules
- [x] queue-reorder: `as never` gone; dshx's decorator keeps component props
- [x] mcp-servers: start failures reach the Host log through the redacting
      logger instead of vanishing; reconciler generic over its target (cast
      gone); arrow functions throughout
- [x] Locales for jujutsu, secret-catalog, settings-search (en, zh; typed keys)
- [x] dshx: inspect bridge replies decoded with zod (DSHX3203); unreachable
      `conversationEvents` wiring removed
- [x] dshx: boot check parses "did not activate" (it never did, despite the
      docs), stops the Host's process group (the pnpm shim orphaned it), and
      names a Nix-built Node (DSHX4112); 44 boot and platform tests

Phase 6 evidence (2026-10-05): root `pnpm check` exit 0 — dshx 506 tests,
create-dshx 25; all 14 plugin packages built, typechecked, and tested, and all
13 profile boot checks passed. Lint and format gates exited 0; antislop warnings
remain.

Left open: the remaining catch blocks in jujutsu and ai-accounts convert errors
into fail-closed domain messages on purpose and stay; the `as` casts warned by
antislop outside the files touched here.

## Phase 7 — Install and verify

- [x] `pnpm profile:sync` links every owned bundle into a profile and installs
- [x] `pnpm profile:boot` checks the composed config, boots, and fails on any
      activation line; proven red by hiding jujutsu's built entry
- [x] `probe` runs all ten owned bundles and boots clean
- [x] `web` runs all eleven owned bundles. nixfiles now seeds
      `web/package.json` and `cordis.patch.yml` only when absent (DSH rewrites
      both, so a store link broke installs) from an asset matching the live
      profile; `nixapply` is the user's to run
- [x] Browser walk on probe (all ten bundles): four client crashes no other
      gate saw, now fixed: undeclared `inject` for services beyond dshx's
      full-runtime set (mcp-servers, secret-catalog, thread-sidebar's empty
      sidebar), imperative Slot components without `decorate` (useApi threw),
      and an unbound store `getSnapshot`. Jujutsu, MCP, Secret Catalog,
      Accounts and Settings panels then open with no console error
- [x] Polish seen in the walk: the Secret Catalog heading measured 18.9:1, but
      its alias line was 3.7:1 and its names fell back from monospace (a font
      shorthand in `font-family`); the ai-accounts footer meter lost its size
      in the integration commit. The remaining footer overlap is the third-party
      Command Code quota widget (about 116px in a 44px footer)
- [x] thread-sidebar: collapsed footer actions are bounded and scroll vertically.
      Reproduced in an isolated DSH home: four actions painted down to y=1020
      in an 876px viewport; after the CSS fix, wheel scrolling kept the last of
      five actions inside the footer at y=872, before its y=876 boundary
- [x] DSHX checks catalogued Client service injections and their provider
      package edges during build and manifest validation. The web boot gate
      gives each owned bundle a scratch profile, then uses headless Chromium to
      verify composition, expected Client entries, native readiness, and Slot
      render boundaries. All 13 per-plugin browser boot checks passed in the
      2026-10-05 `pnpm check`
- [x] Integration review install steps corrected (bundles list package names,
      not row ids); Installed column added

Found: most bundles insert unscoped Loader row ids (`mcp-servers`,
`settings-search`, `thread-sidebar`…), which AGENTS.md says can replace a native
row. None collides today (probe composes clean). Renaming orphans stored
settings, so it is a decision, not a fix.

## Phase 8 — Docs and Nix

- [x] Root README with a plugin inventory table
- [x] AGENTS.md: `pnpm add <path>` contradiction resolved, upstream create
      command, `node --test` and `lib/` corrected; pnpm traps in
      `docs/profile-installs.md`, creator mode in `docs/creator-mode.md`
- [x] `scripts/dsh-session-status.mjs` removed (one session title hardcoded)
- [x] Flake outputs for aarch64-darwin, aarch64-linux and x86_64-linux
      (pinned nixpkgs dropped x86_64-darwin)
- [x] Pure dshx package: hash-pinned `fetchPnpmDeps` (fetcher 4), offline
      install, `pnpm deploy --prod` so no symlink points back at the build tree.
      pnpm 12 writes unpacked packages to the store's `links/`, whose
      comment-bearing `tsconfig.json` files broke nixpkgs' jq normalization;
      the fetch drops that derived directory. Built and run on aarch64-darwin;
      Linux outputs only evaluated
- [x] One pnpm source: the dev shell takes pnpm only from corepack
- [x] Desktop dependencies now use hash-pinned `fetchPnpmDeps` and the standard
      `pnpmConfigHook` offline install. The aarch64-darwin Nix output builds with
      TypeScript 7.0.2 and cached Electron 43.6.0; Electron's binary download is
      skipped

## Phase 9 — New capability

- [x] Thread-sidebar navigation/thread split — accessible horizontal handle
      resizes the vertical space for the header controls and the project/thread
      middle region. Compact mode keeps the header controls in a horizontal
      icon row; expanded mode keeps labeled controls vertical. The selected
      header height persists with sidebar preferences, with keyboard resizing
      and a double-click reset; the actual collapsed Host rail hides the handle.
- [x] `@dshfiles/sidebar-commands`: `/goto` popup over sidebar panels and
      recent sessions (built: `dsh-spotlight` targets the removed client runtime)
- [x] `@dshfiles/diff-viewed`: Viewed toggle and n/m count in
      `deliverables.review.file.actions`, keyed by session, turn and path.
      Collapsing or filtering viewed files needs a Host change
- [x] Desktop shell Phase 0 spike — tokenized Host URL and provider RPC verified;
      see `plans/desktop-shell/README.md`

# Incremental development checks

## One development workspace

The root pnpm workspace includes plugins, SDK packages, workspace check packages and desktop. Run `pnpm install --frozen-lockfile` once. Plugin SDK dependencies use `workspace:*`; external installed DSH profiles retain `link:` because they live outside this workspace. The checked-in web profile seed remains a standalone deployment manifest. Scratch installation retains its separate [pnpm policy](../tooling/dshx/scratch-pnpm-policy.yaml) so a disposable profile never inherits development workspace discovery.

Turborepo 2.11.8 is pinned as a development dependency and uses its official platform binary. Vitest stays on 4.1.11. Local caches live in `.turbo/cache`; remote caching is disabled. Neither install nor verification changes the active web profile.

## Package orchestration

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm exec turbo run build test typecheck --filter=@dshfiles/shared-streams
pnpm exec turbo run build --filter=@dshfiles/dshx
```

Build tasks follow workspace dependency builds and restore `dist` together with SDK incremental build metadata. Source-only libraries participate as transit nodes, so their changes invalidate consumers even without a build command. Typechecks and tests have separate task keys. Existing plugin and SDK workspace check commands delegate their package work to Turbo; runtime boot gates still execute every time, with their prerequisite builds cached.

The shared stylesheet scans all owned plugins. The plugin-ui transit build includes all scanned code/style inputs; changing a sibling's classes invalidates every UI-consumer build. Run the unrestricted `pnpm build` after class changes: filtering only one package cannot rebuild omitted consumers. Non-UI documentation changes do not invalidate builds. Files under owned plugins remain UI scan inputs—even Markdown can contain Tailwind classes—while generated logs, caches and outputs are excluded. Test results for real SDK/scaffolding runtime suites remain uncached.

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

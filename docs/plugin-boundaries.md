# Plugin boundaries

Workspace packages depend on each other in one direction. `dshx check repo` enforces it: `--only cycles` fails on any
cycle, peer dependencies included, because turbo orders builds by `dependencies` and `devDependencies` only, so a cycle
that closes through a peer builds against whatever `dist/` the other side left. `pnpm check:cycles`
(`scripts/workspace-cycles.mjs`) runs the same cycle check from the dshx source before anything is built, and
`pnpm check:repo` runs every check after the plugin build; both are part of `pnpm check:green`.

When plugin A shows something that plugin B knows how to produce:

- **A declares a contract or registry, B fills it.** The plugin that owns the screen or slot defines the token
  (`defineContract`, `defineRegistry` from `@dshfiles/dshx/client`, published as a dshx `modules` entry) and renders
  what is provided, or nothing when B is absent. B already depends on A, so the dependency stays one-way. Example:
  `@dshfiles/ai-accounts/account-usage-view` declares `AccountUsageView`; `@dshfiles/usage` provides the dashboard.
- **A third integration plugin** only when the integration is large and both A and B must keep working without it.
  Every plugin is another bundle to build and boot, so do not split for a single component or call.
- **Never** import the other plugin's `dist/` by relative path (`--only boundaries` reports `relative-dist-import`), and
  never add an optional peer dependency to get around the cycle check.
- **A contract module never imports the plugin that fills it**, directly or through a file it imports: the provider
  depends on the contract, not the reverse. `--only boundaries` reports it as `contract-imports-provider`.

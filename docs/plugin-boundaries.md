# Plugin boundaries

Workspace packages depend on each other in one direction. `node scripts/workspace-cycles.mjs` (part of
`pnpm check:green`) fails on any cycle, peer dependencies included: turbo orders builds by `dependencies` and
`devDependencies` only, so a cycle that closes through a peer builds against whatever `dist/` the other side left.

When plugin A shows something that plugin B knows how to produce:

- **A declares a contract or registry, B fills it.** The plugin that owns the screen or slot defines the token
  (`defineContract`, `defineRegistry` from `@dshfiles/dshx/client`, published as a dshx `modules` entry) and renders
  what is provided, or nothing when B is absent. B already depends on A, so the dependency stays one-way. Example:
  `@dshfiles/ai-accounts/account-usage-view` declares `AccountUsageView`; `@dshfiles/usage` provides the dashboard.
- **A third integration plugin** only when the integration is large and both A and B must keep working without it.
  Every plugin is another bundle to build and boot, so do not split for a single component or call.
- **Never** import the other plugin's `dist/` from both sides, and never add an optional peer dependency to get around
  this check.

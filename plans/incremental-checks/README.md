# Incremental workspace checks

Source revision: `62af011c` (main when this thread started).

| Milestone | Status |
| --- | --- |
| Inspect dependency and cache boundaries | Done |
| Unify development workspace; migrate 34 SDK links | Done; 42 projects installed, contract and shared Cordis identity verified |
| Add Turbo package graph and cache-safe task inputs | Pending |
| Add JJ-aware Vitest changed/related selection | Pending |
| Validate cache hits, invalidation and selected tests | Pending |

Resume here: collect install job `bash-14`, review the unified lockfile, then describe dependency migration before a new orchestration revision.

## Constraints

- External installed profiles must retain `link:` dependencies: they are not development workspaces.
- Do not restart or sync the live web profile.
- Tailwind scans all owned plugin sources. UI build inputs must include that entire scan closure.
- Full-suite and selective-test results must never share cache keys. Selection tasks are uncached.
- Vitest 4.1.11 static related selection cannot detect filesystem, variable imports or subprocess inputs; select whole package suites for those inputs.
- Keep runtime boot checks uncached.
- Scratch profile installation retains its old dependency policy in `tooling/dshx/scratch-pnpm-policy.yaml`; the development workspace policy moves to root.

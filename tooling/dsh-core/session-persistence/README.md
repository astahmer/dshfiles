# DSH session persistence seam fork

This private snapshot comes from DeepSeek Harness release commit `639ed015397290b3745d163aafe02ffee4aa3f84`. The local change adds `decodeStoredEvents`, the domain boundary that validates generic persisted-format events and returns Session events without an unsafe caller cast. Source provenance and the shared MIT license are recorded in `tooling/dsh-core/FORK.md`.

Build and verify with Node 22 and pnpm 12:

```sh
pnpm install --offline --lockfile-only
pnpm install --offline --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm test
```

Generated `lib/` files are local build output. This package is private and is not published.

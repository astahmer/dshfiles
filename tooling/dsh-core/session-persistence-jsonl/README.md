# DSH JSONL session persistence fork

This package is a private fork of DeepSeek Harness `dsh-session-persistence-jsonl` from release commit `639ed015397290b3745d163aafe02ffee4aa3f84`. The local fork injects `@dshfiles`' V5 format catalog through the existing catalog service so the JSONL backend can encode and restore V5 session headers. The upstream MIT license is retained at `tooling/dsh-core/LICENSE`; provenance and local changes are recorded in `tooling/dsh-core/FORK.md`.

Build and verify with the repository's official Node 22 binary and pnpm 12:

```sh
pnpm install --offline --lockfile-only
pnpm install --offline --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm test
```

Generated `lib/` output is local build output. The package is private and is not published.

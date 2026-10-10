# @dshfiles/optmem

Persistent project memory for DSH. Captures session activity into an append-only memory store, exposes memory tools, and injects a compact memory view into context.

The Host adapter composes `@dshfiles/optmem-core` with the `node:sqlite` implementation in `@dshfiles/optmem-sqlite`. See [`docs/`](docs/) for requirements, clean-room research, architecture, runtime evidence, benchmarks, and a benchmark runbook. Scratch scenarios and their driver live in [`scripts/`](scripts/). The only remaining plan gate is the 100k-event storage benchmark rerun: [`plans/optmem/`](../../../plans/optmem/README.md).

Build, test, and typecheck with `pnpm build`, `pnpm test`, and `pnpm typecheck` from this package.

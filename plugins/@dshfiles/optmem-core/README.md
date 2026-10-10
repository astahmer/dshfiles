# @dshfiles/optmem-core

Harness-agnostic OptMem engine. Owns append-only event capture, the binary memory tree, persisted views, zoom, and snapshots; contains no DSH adapter or storage dependency.

The DSH bundle is [`@dshfiles/optmem`](../optmem/README.md), backed by [`@dshfiles/optmem-sqlite`](../optmem-sqlite/README.md). Run `pnpm build`, `pnpm test`, and `pnpm typecheck` from this package.

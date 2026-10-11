# @dshfiles/optmem

Persistent project memory for DSH. Captures session activity into an append-only memory store, exposes memory tools, and injects a compact memory view into context.

The Host adapter composes `@dshfiles/optmem-core` with the `node:sqlite` implementation in `@dshfiles/optmem-sqlite`. See [`docs/`](docs/) for requirements, clean-room research, architecture, runtime evidence, benchmarks, and a benchmark runbook. Scratch scenarios and their driver live in [`scripts/`](scripts/). The only remaining plan gate is the 100k-event storage benchmark rerun: [`plans/optmem/`](../../../plans/optmem/README.md).

Build, test, and typecheck with `pnpm build`, `pnpm test`, and `pnpm typecheck` from this package.

## Settings in DSH

Settings live in the `dshfiles-optmem` entry (Loader row inserted by this package's `cordis.patch.yml`). A small client
(`src/client-entry.tsx`) shows one panel in two places: **Settings → Memory** and the bundle's own page under
**Plugins**. The panel replaces dshx's generic Plugins-page form because that form renders arrays as raw JSON.

- Row editors for `cheapModels` (kind, ordered models, effort) and `summarizerFallbacks` (provider, model, effort), with
  add, reorder and remove. Routes are checked against the models each DSH provider offers, using the same matching as
  the Host (`src/routing.ts`). Warnings never block saving.
- An override route (one provider, model and effort for every summary), every byte budget, and the exclusions.
- `mode` can be switched to `full` only when the Host reports the fork core marker (`agent/request-messages`).
  Otherwise it is read-only.
- Live status from the Host API (`src/api.ts`): database size, events, summary calls, pending summaries and merges,
  last summary route, current error. Two actions: **Pause summaries** (`summarizerPaused`, live; pending summaries
  retry once resumed) and **Backfill sessions** (20 at a time).

Old values decode field by field with defaults (`src/settings-draft.ts`). A Host started before the panel API shows a
restart notice, and settings still save.

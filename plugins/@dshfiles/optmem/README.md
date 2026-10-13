# @dshfiles/optmem

Persistent project memory for DSH. Captures session activity into an append-only memory store, exposes memory tools, and injects a compact memory view into context. The Host owns SQLite; browser inspection APIs are read-only and always scoped to one selected OptMem project.

The Host adapter composes `@dshfiles/optmem-core` with the `node:sqlite` implementation in `@dshfiles/optmem-sqlite`. See [`docs/`](docs/) for requirements, clean-room research, architecture, runtime evidence, benchmarks, and a benchmark runbook. Scratch scenarios and their driver live in [`scripts/`](scripts/). The three-arm live benchmark (native compaction vs compatibility vs full mode on a real model) lives in [`bench/`](bench/); its latest results are in [`docs/benchmark-2026-10-13.md`](docs/benchmark-2026-10-13.md). The only remaining plan gate is the 100k-event storage benchmark rerun: [`plans/optmem/`](../../../plans/optmem/README.md).

Build, test, and typecheck with `pnpm build`, `pnpm test`, and `pnpm typecheck` from this package.

## Workbench Explorer

A dedicated **OptMem** Workbench page (separate from Settings) offers three read-only tabs:

- **Explore**: choose a registered workspace or an existing detached OptMem project, browse the committed main tree, search the selected project's indexed events with bounded pagination, inspect node text and up to 50 source events, and open a source session. The current workspace is the initial selection when available; the choice is saved locally in the browser.
- **Context Preview**: run the same compact-view injection assembly with the selected project, optionally excluding one session. This is a simulation, not a record of past prompt injection. It does not start or resume a session.
- **Pipeline**: inspect persisted, selected-project counters (missing stream leaves, distinct events, estimated unique oversized leaf calls, ready merges, oldest event, completed nodes and recent throughput). Counts are estimates and do not expose or change the queue.

Workspace identity remains the current OptMem project identity (`workspace:<id>` or historical `path:<hash>`). Multiple Jujutsu workspaces in one repository are not silently joined; a repository-level identity migration would need an explicit compatibility and data-preservation design. Pending unsummarized tails are accounted in the Pipeline tab, not in the committed Explorer tree.

## Full mode

Full mode sends each request as system and instruction messages, one memory view message, then the current turn only.
It runs on stock DSH through `@dshfiles/request-messages`, which wraps the llm runtime's innermost adapter call; that
bundle must be in the profile. Each override is recorded in OptMem's status (`lastFullRequest`: original vs sent
message counts and bytes) and the Host log (`optmem: full-mode request`), never in the session log. While full mode
holds a conversation, DSH's pressure compaction of its stored history is skipped (`src/compaction-deferral.ts`): the
token meter prices that history, not what is sent, so compaction would otherwise keep summarizing context full mode
never sends. Overflow recovery still runs. The Context bar keeps showing the stored history's size.

## Settings in DSH

Settings live in the `dshfiles-optmem` entry (Loader row inserted by this package's `cordis.patch.yml`). A small client
(`src/client-entry.tsx`) shows one panel in two places: **Settings → Memory** and the bundle's own page under
**Plugins**. The panel replaces dshx's generic Plugins-page form because that form renders arrays as raw JSON.

- Row editors for `cheapModels` (kind, ordered models, effort) and `summarizerFallbacks` (provider, model, effort), with
  add, reorder and remove. Routes are checked against the models each DSH provider offers, using the same matching as
  the Host (`src/routing.ts`). Warnings never block saving.
- An override route (one provider, model and effort for every summary), every byte budget, and the exclusions.
- `mode` can be switched to `full` only when [`@dshfiles/request-messages`](../request-messages/README.md) is loaded
  and reports that it dispatches `agent/request-messages`. Otherwise it is read-only.
- Live status from the Host API (`src/api.ts`): database size, stored events vs stream entries, in-memory jobs vs persisted missing-leaf entries, estimated unique model calls, ready merges, oldest pending work, completed summaries, recent throughput, last route and error. The legacy `pendingSummaries` value is explicitly labeled as an in-memory job count, not calls or persisted backlog. **Pause summaries** is live; failed summaries retry after resume. **Backfill sessions** imports a bounded batch.
- Backlog accounting, the output-budget failure mode, safe retry behavior, production-snapshot caveats and data-safety boundaries are recorded in [`docs/backlog-diagnosis.md`](docs/backlog-diagnosis.md).

Old values decode field by field with defaults (`src/settings-draft.ts`). A Host started before the panel API shows a
restart notice, and settings still save.

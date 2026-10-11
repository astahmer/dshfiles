# OptMem remaining validation

Implementation, design, and historical evidence live with the owning packages:

- [`@dshfiles/optmem`](../../plugins/@dshfiles/optmem/README.md) — DSH adapter, tools, and settings.
- [`docs/`](../../plugins/@dshfiles/optmem/docs/) — requirements, research, design, runtime evidence, benchmark results, and runbook.
- [`scripts/`](../../plugins/@dshfiles/optmem/scripts/) — scratch turn driver and scenario fixtures.

## Status

Stages 1–5 plus backlog diagnostics/recovery and the read-only Workbench Explorer are implemented. Fresh validation for this revision is recorded below; older runtime and benchmark receipts remain historical, not fresh evidence.

| Remaining check | State | Evidence / gate |
|---|---|---|
| Add OptMem to the `web` profile | done 2026-10-10, live after the user restarts | Seed `profiles/web/package.json` lists `@dshfiles/optmem`; `pnpm profile:sync --profile web --bundle @dshfiles/optmem` linked it into `~/.dsh/profiles/web` without a restart. Compat mode: `web` runs the stock core (no `@dshfiles/dsh-core-runtime`). Summaries (2026-10-10): the thread's own provider with its kind's cheap model (`cheapModels`, e.g. codex → `gpt-6-luna` low), override via `summarizerModel`/`summarizerProvider`, ordered `summarizerFallbacks`, else skipped and retried; never the thread's model. Scratch web copy: a `codex-emialex`/`gpt-6.1-sol` thread wrote its leaf as `codex-emialex/gpt-6-luna`. Host Node is 22.23.3, which ships `node:sqlite` unflagged. A scratch copy of the post-`nixapply` `web` profile on :3199 booted clean; `memory_status` reported compatibility mode, ready capture and events in `optmem.db`. |
| Settings visible in DSH (Settings → Memory and the Plugins page) | done 2026-10-11, live after the user restarts | Client panel with row editors for cheap models and fallbacks, model checks per provider, read-only `full` mode without the fork marker, live status, pause and backfill. Scratch copy of `web` on :3199 (own `DSH_HOME`): the panel showed on both pages, edits round-tripped into the profile patch and survived a restart, and an `opencode-go-alex`/`glm-5.3-flash` thread had its summaries written as `codex-emialex/gpt-6-luna` (the configured override). Pause stopped summary calls (route `summaries are paused`), resume retried them. |
| Backlog diagnosis/recovery and Workbench Explorer | implemented; isolated browser journeys pass 2026-10-12 | Added bounded output-token retries, explicit recovery, persisted counters, per-stream processing/failure health, Zod-bounded read-only APIs, path-hash identity resolution, root-node detection, and the three-tab Explorer. OptMem/core/SQLite suites pass (49/29/36), all three typechecks and OptMem build/import pass; scratch Playwright Settings + populated Explorer journeys pass (2/2). Frozen lock, contract and `check:diff` pass. Workspace-wide build/typecheck/test and full-profile stylesheet E2E remain blocked by unrelated stale `agent-communication` contracts; `features:check` still reports 81 pre-existing catalog issues. No live DB mutation, profile sync, or restart. |
| Rerun the 100k-event storage benchmark on a quiet machine | pending (busy rerun recorded 2026-10-11) | 2026-10-11: 3 runs under 1-min load 13–18, after waiting 20 min (load 17–38). Median: build 62.4 s, append 6,018 ev/s, search p50/p95 21.9/36.8 ms. Counts were deterministic. Still not a quiet baseline. Append new measurements to [`benchmarks.md`](../../plugins/@dshfiles/optmem/docs/benchmarks.md); do not replace prior results. |

## Resume here

Run the 100k-event benchmark under the Node version pinned by `.node-version` when system load is low, append dated measurements, and mark that gate complete. Before promotion, resolve the unrelated full-plugin build failures, rerun the broad repository gates, and let the user restart the live Host to load the new Host API and package composition. No live profile was synced or restarted here.

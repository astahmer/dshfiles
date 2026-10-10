# OptMem remaining validation

Implementation, design, and historical evidence live with the owning packages:

- [`@dshfiles/optmem`](../../plugins/@dshfiles/optmem/README.md) — DSH adapter, tools, and settings.
- [`docs/`](../../plugins/@dshfiles/optmem/docs/) — requirements, research, design, runtime evidence, benchmark results, and runbook.
- [`scripts/`](../../plugins/@dshfiles/optmem/scripts/) — scratch turn driver and scenario fixtures.

## Status

Stages 1–5 are implemented. Existing test, build, import, scratch-profile, and live-turn receipts are dated historical evidence in the package docs; they are not fresh validation for later changes.

| Remaining check | State | Evidence / gate |
|---|---|---|
| Add OptMem to the `web` profile | done 2026-10-10, live after the user restarts | Seed `profiles/web/package.json` lists `@dshfiles/optmem`; `pnpm profile:sync --profile web --bundle @dshfiles/optmem` linked it into `~/.dsh/profiles/web` without a restart. Compat mode: `web` runs the stock core (no `@dshfiles/dsh-core-runtime`). Summaries (2026-10-10): the thread's own provider with its kind's cheap model (`cheapModels`, e.g. codex → `gpt-6-luna` low), override via `summarizerModel`/`summarizerProvider`, ordered `summarizerFallbacks`, else skipped and retried; never the thread's model. Scratch web copy: a `codex-emialex`/`gpt-6.1-sol` thread wrote its leaf as `codex-emialex/gpt-6-luna`. Host Node is 22.23.3, which ships `node:sqlite` unflagged. A scratch copy of the post-`nixapply` `web` profile on :3199 booted clean; `memory_status` reported compatibility mode, ready capture and events in `optmem.db`. |
| Rerun the 100k-event storage benchmark on a quiet machine | pending | Prior run was deferred because system load exceeded the recorded threshold. Append new measurements to [`benchmarks.md`](../../plugins/@dshfiles/optmem/docs/benchmarks.md); do not replace prior results. |

## Resume here

Run the 100k-event benchmark under the Node version pinned by `.node-version` when system load is low. Then append the dated measurements and mark this gate complete. No other implementation work is tracked here.

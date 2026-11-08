# Plugin performance pass

One measured performance pass per owned plugin under `plugins/@dshfiles/`, one subagent per plugin.
Method: the `performance-optimization` skill — target, measure, hypothesis, smallest change, prove, report.
A plugin with no measured bottleneck is recorded as `no-change` with its evidence; no invented changes.

Shared brief given to every agent: `/tmp/plugin-perf-brief.md` (scratch files never under `src/`, no installs,
no jj writes, finish with a passing typecheck + build + tests).

## Resume here

Waves run at 3–5 concurrent agents in this shared thread workspace. Next plugin to dispatch: first unclaimed row
below in LOC order. Verify each `optimized` row here before landing it (typecheck + build + tests, then read the
diff).

## Results

| plugin | status | finding | before → after (real workload) |
| --- | --- | --- | --- |
| background-jobs | optimized | board row cache keyed on whole-map identity; every live event / 30s pass re-derived all 20k rows | board read after a job event 30.3ms → 8.75ms (3.5x) |
| ai-accounts | optimized | quota sweep built the observed accounts file (keychain spawn + credential reads) to use 4 stored fields | observe pass 25.7ms → 0; body with I/O held constant 30.7ms → 1.0ms |
| usage | optimized | `activity()` joined the percentile CTE onto the 406k-row tools scan before grouping | dominant query 2636ms → 2059ms (7/7 paired rounds), activity 30d 3562ms → 3164ms |
| thread-sidebar | optimized | `list` folded a title (whole-log read) for every candidate before slicing to `limit` | title folds per default page 250 → 50; model 5751ms → 1151ms; corpus work 905MB/6010ms → 107MB/974ms |
| traces | optimized | stats window scan walked the (trace_id, span_id) btree row by row | stats CPU 154.4 → 101.1ms, p50 121.3 → 91.2ms (covering index `spans_window`) |
| shared-runtime migration (macro) | done | 11 Client plugins re-inlined the UI stack | Client bytes 36616 → 35320 KB |
| secret-catalog (macro) | done | Host bundle kept its own Effect runtime | Host bundle 1132 → 264 KB |
| project-checks | optimized | `DurableTasks.list` scanned and decoded every task row (up to 1000) then filtered to one Session | 9.7 / 6.0 / 5.9 ms → 0.16 / 0.39 / 0.15 ms (indexed per-session query), results identical |
| backlog | no-change | owned reads already sub-millisecond (list 0.22 ms / 614 live items, 0.6–0.9 ms / 2000); a search cache was implemented, measured below the noise floor and reverted | — (the only large number is contract encode: 12.9 ms + 868 KB payload for the panel's `limit:2000` request — product decision) |
| jj-integration | optimized | workspace scan ran two `jj log` processes per workspace (2N spawns, each loading the repo view) | real repo 82 → 42 spawns, scan median 1849 → 1023 ms (−45%), results identical on 40 workspaces |
| jujutsu | optimized | landmark reads sequential (Effect.forEach default); `readRevisionRelationship` ran 9 waves of independent `jj log` | navigation 259 → 138 ms medians; relationship 465 → 209 ms medians; spawns unchanged, jj busy/wall 1.00 → 2.4-2.6 |
| multi-host | no-change | hottest API already 0.35–0.5ms quiet (read 0.50ms = fs 0.04 + parse 0.04 + decode 0.02); live p95 is Host-wide stall, other plugins share it | — (rejected candidates recorded in the thread: read coalescing, parallel session fan-out, lock removal) |

## Unmeasured / follow-ups filed

- `b:kg0q` — live `ai-accounts` quota sweep times out at its 30s budget; provider I/O under a saturated Host, not plugin CPU.
- `b:17rs` — native `sessionController.list` dominates `thread_list` (p50 8.2s) and `auto-settle scan` (p50 8.4s, 96% of it native). Host gap, not plugin code.


## Macro round (across the whole plugin set)

Per-plugin passes fix hot paths inside one plugin. This round looked at the set instead — what 100 plugins
duplicate, forget, or repeat once they exist together.

| finding | evidence | change |
| --- | --- | --- |
| 19 Client plugins inlined their own copy of the UI stack (radix, tanstack, motion, zod) that `@dshfiles/shared-runtime` already provides | `dist/client.js.deps.json` per bundle; `pulls-review` alone 356 KB of it | migrated 11 (pulls-review, chat, model-effort-picker, sidebar-right, workspace-folder-picker, dialogs, rich-composer, workspace-nav, attachment-gallery, model-selection, user-questions); total Client bytes 36616 → 35320 KB, and one copy of each library at runtime instead of 12 |
| nothing kept future plugins from re-inlining those libraries | same manifests | `plugins/scripts/check-shared-runtime.mjs` + `pnpm check:shared-runtime` in `check:green`; fails a bundle that retains a provided package without `client.shared` unless the plugin declares a private copy |
| one Host bundle bundled its own Effect runtime while 97 others use DSH's | `secret-catalog/dist/index.js` retained 112 `effect` files | dropped `'effect'` from that plugin's `bundleDependencies`: Host bundle 1132 → 264 KB, one Effect instance in the process |
| React was never duplicated (the page provides it) — no action | strict `node_modules/react/` scan over every Client deps manifest: 0 hits | none |
| 427 agent-tool registrations, dominated by backlog 49, ai-accounts 45, thread-sidebar 41, multi-host 40; every model request carries their schemas | source scan per plugin | not changed here: the lever is deferred/lazy tool exposure (the `tool-search` plugin owns that surface), not a per-plugin edit |
| ~23 `setInterval` sites, 8 of them at 1 s, several in the sidebar/chat/background-jobs | source scan | not changed here: consolidating them needs one shared ticker module + a render-count measurement in the live GUI |

Verification: every migrated plugin re-ran `typecheck` + `vitest` green (see the rows above for the code fixes);
`pnpm check:repo` reports cycles/boundaries ok; `pnpm check:shared-runtime` → 69 Client bundles, no re-inlined
module.

## Method notes that cost time

- `dshx build` typechecks the whole project, so a scratch bench under `<plugin>/src/` breaks the plugin build and
  every sibling that imports its `dist`. Benches belong under `/tmp`.
- Sibling packages resolve `@dshfiles/<x>/dist`; a fresh thread workspace must run
  `pnpm exec turbo run build --filter='./plugins/@dshfiles/*'` once before per-plugin verification is meaningful.
- The machine is shared: judge by paired A/B and medians, not single wall-clock runs.

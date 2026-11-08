# Plugin performance pass

One measured performance pass per owned plugin under `plugins/@dshfiles/`, one subagent per plugin.
Method: the `performance-optimization` skill — target, measure, hypothesis, smallest change, prove, report.
A plugin with no measured bottleneck is recorded as `no-change` with its evidence; no invented changes.

Shared brief given to every agent: `/tmp/plugin-perf-brief.md` (scratch files never under `src/`, no installs,
no jj writes, finish with a passing typecheck + build + tests).

## Resume here

Waves run at 3–5 concurrent agents in this shared thread workspace. **Wave 2 running:** rich-composer, chat,
workbench, editor, session-controller. Before dispatching, pick the first plugin below that has neither a row in
the results table nor a `wave 2` mention, in LOC order: plugin-ui, secret-catalog (host effect already fixed),
settings-shell, mcp-servers, workspace-nav, sidebar-right, main-tabs, activity-timeline, workspace-folder-picker,
subprocess-local, then the rest of `plugins/@dshfiles/*`.

Landing shape (already applied once, reuse the same shape): one commit per plugin above the macro commit, appended
above the previous wave, plus one `perf(plugins): …` macro commit per cross-plugin round. Verify each plugin with
`/tmp/verify-plugin.sh <name> --build` before committing, and check that every landed client plugin keeps
`client.shared` (guard: `node plugins/scripts/check-shared-runtime.mjs`).

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
| settings-models | optimized | every state change re-rendered all 500 model rows (inline handlers, no memo) | expand-row 18.2 → 1.3 ms, capacity keystroke 17.6 → 0.96 ms (18×), picker open 61 → 24 ms, select-all 23.1 → 5.9 ms; mount flat |
| subprocess-local | optimized | every 50 ms terminal readiness poll forked the whole `ps` table (33–45 ms event-loop block) for evidence it discarded | probe 43.9 → 8.6 ms (~5×), 10-probe blocking 460 → 108 ms; descendant scan bounded to 1/s, teardown still immediate |
| workspace-folder-picker | optimized | `project_identities` re-inspected every folder (2 git spawns each, ~128/read) although the contract says cached | repeated read 538 → 0.6 ms, read after one new workspace 538 → 22.9 ms; cold read unchanged |
| main-tabs | no-change | activation click 1.49 ms at 10 tabs, 5.71 ms at 50 (two strip renders at ~0.12 ms/tab); tab.select 0.02 ms, persist 0.01 ms, publication fingerprint 0.02 ms, `saveTabs` 0.03–0.35 ms | — (rejected: memoizing tab rows saves ~1 ms at 50 tabs but the row context menu consumes the whole tabs array, so a comparator either re-renders anyway or serves a stale menu after the tab set changes) |
| settings-shell | no-change | section switch 1.48 ms, search keystroke 2.65 ms (640 fields; 4.2 ms CPU), pure search 0.33 ms, page composition 4.17 ms only when describe/labels/locale versions change, per-render rebuild 0.008 ms, exactly 1 Host `describe()` per write (it carries the `expectedRevision` the write is fenced with) | — (the 48.6–312 ms broad-search cost is React/DOM building 600+ interactive matched rows: 9816 nodes, 2048 `<mark>`; plugin JS is ~1–2% of it; capping or virtualizing results is a behaviour change) |
| secret-catalog | no-change | list warm 0.10 ms with 0 CLI spawns (rev-keyed cache, 15 s TTL), resolve CPU 0.039 ms (one `get` is the value read), client filter 1.1 ms at the 5000-row cap; the live p50 499–593 ms is the external `secret` CLI | — (noted, not fixed without a GUI profile: the aliases table rebuilds its row-actions context each render, so Radix tooltips re-render per keystroke; `elsewhereIn` can spawn 16 `print`s for one broken reference, only 12 `print` spans in the whole trace window) |
| activity-timeline | no-change | reads over a 5000-event / 2.5 MB store already p50 0.05–0.6 ms (revision-keyed snapshot cache, condensation only on the returned slice); cold stale read 29.4 ms happens at boot/30 s idle, not per page | — (ingest write 15 ms at 32 writes/hour rejected; schema-encode shortcut measured 11.3 → 3.4 ms but rejected as a serialization-semantics risk for 0.25 s/hour) |
| mcp-servers | optimized | cold reconcile launched MCP clients one at a time, each awaiting its handshake | cold 8 servers 263 → 74 ms (3.6×), 16 servers 583 → 137 ms (4.3×); control lands on ceil(N/4) waves |
| editor | optimized | file-index walk kept only 8 `list` calls in flight on one gateway socket → ~138 sequential rounds for this repo | 138 → 52 rounds; modelled 1 ms-RTT index 158 → 58 ms, 5 ms-RTT 677 → 258 ms (round count exact, absolute modelled) |
| chat | optimized | live-tail node re-anchored per streamed chunk → structural upsert → full sort + location/rail rebuild per chunk | per-chunk 0.087→0.010 (280n), 0.248→0.022 (840n), 0.914→0.009 (2800n), 4.78→0.014 ms (7000n) |
| workbench | optimized | float-layer `sync()` walked every panel body on every layout change even with nothing floating | layer sync 0.369/0.436 → 0.097/0.113 ms per layout change; end-to-end switch not resolvable (jsdom) |
| session-controller | optimized | `messages` decoded a whole cold session log (JSON.parse every row + schema decode of every spoken message) to keep its last 20 | cold read p50 97.8 → 5.9 ms, 44.1 → 1.0 ms, 68.4 → 2.6 ms (16–44×); live fold 5.8 → 0.18 ms; tail falls back to the full read on any doubt |
| rich-composer | optimized | `ConversationContent` subscribed to InputState only to build the dock InputZone, so every draft publish re-rendered the conversation view | conversation renders per 60 keystrokes 60 → 0; wall 59.3 → 10.5 ms, CPU 72.2 → 17.7 ms |
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
| workspace-nav | optimized | `reconcileManualOrder` rebuilt the archived-session Set once per Workspace (`220 x 2079` inserts) on every snapshot change in manual order | `orderedWorkspaces` 7.87 → 0.20 ms (39×), manual-order bundle 8.14 → 0.59 ms; 400 differential cases, 0 mismatches |
| sidebar-right | optimized | `AddressableSeat` subscribed to the whole targets array, so one panel's visibility change re-rendered every panel | body renders per switch 16 → 4; switch median 2.17 → 0.96 ms (min 1.96 → 0.85) |

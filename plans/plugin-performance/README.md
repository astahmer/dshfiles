# Plugin performance pass

One measured performance pass per owned plugin under `plugins/@dshfiles/`, one subagent per plugin.
Method: the `performance-optimization` skill — target, measure, hypothesis, smallest change, prove, report.
A plugin with no measured bottleneck is recorded as `no-change` with its evidence; no invented changes.

Shared brief given to every agent: `/tmp/plugin-perf-brief.md` (scratch files never under `src/`, no installs,
no jj writes, finish with a passing typecheck + build + tests).

## Resume here

**Wave 6 running:** tool-search, queue-reorder, worktree-memory, tweet-context. Every earlier wave is landed as
one commit per plugin above the previous wave's `docs(plans)` commit.

Before dispatching, take the first plugin below with neither a result row nor a running mention, in LOC order:
`plugin-ui`, `agent-questions`, `component-gallery`, `pulls-review`, `agent-communication`, `plugin-guide`,
`loopback-access`, `frame-layout`, `user-questions`, `html-render`, `agentsview`, `annotations`,
`project-automations`, `pull-requests`, `worktrees`, `goal-tool`, `goal-stall-guard`, `tool-ask-user`,
`prompt-stash`, then the remainder of `plugins/@dshfiles/*`.

Landing recipe (proven, reuse it): one commit per plugin above the previous wave's docs commit, built by
`/tmp/land-wave2.mjs <base> <messages-file> --apply` — it saves a patch per group, rebuilds the chain from the base,
verifies the tree is content-identical, then abandons the old working copy. Two rules that matter:

- Never land while an agent owns uncommitted files: the script abandons the previous working copy, so a running
  lane's edits would be destroyed. Check `jj status` first.
- Re-run the formatter and `node scripts/lint-ratchet.ts oxlint` AFTER landing: the agents write working code but the
  ratchet catches new `react-hooks/exhaustive-deps` and `antislop` findings, and those get squashed into the plugin's
  commit (or a follow-up `chore(plugins)` commit) rather than left for CI.

Verify each plugin before commit with `/tmp/verify-plugin.sh <name> --build`, and keep
`node plugins/scripts/check-shared-runtime.mjs` green (every Client plugin stays on the shared UI runtime).

## Results

| plugin | status | finding | before → after (real workload) |
| --- | --- | --- | --- |
| background-jobs | optimized | board row cache keyed on whole-map identity; every live event / 30s pass re-derived all 20k rows | board read after a job event 30.3ms → 8.75ms (3.5x) |
| ai-accounts | optimized | quota sweep built the observed accounts file (keychain spawn + credential reads) to use 4 stored fields | observe pass 25.7ms → 0; body with I/O held constant 30.7ms → 1.0ms |
| usage | optimized | `activity()` joined the percentile CTE onto the 406k-row tools scan before grouping | dominant query 2636ms → 2059ms (7/7 paired rounds), activity 30d 3562ms → 3164ms |
| thread-sidebar | optimized | `list` folded a title (whole-log read) for every candidate before slicing to `limit` | title folds per default page 250 → 50; model 5751ms → 1151ms; corpus work 905MB/6010ms → 107MB/974ms |
| memory | optimized | `Recall.threadRecords` ran one SQL query plus a full digest decode per Session (N+1 over 1,902 digests) for `find_threads` and the Memory panel | that loop 1,402–1,679 ms → 4–5 ms (≈300×); 300/300 ids identical; digester N+1 left alone |
| traces | optimized | stats window scan walked the (trace_id, span_id) btree row by row | stats CPU 154.4 → 101.1ms, p50 121.3 → 91.2ms (covering index `spans_window`) |
| shared-runtime migration (macro) | done | 11 Client plugins re-inlined the UI stack | Client bytes 36616 → 35320 KB |
| secret-catalog (macro) | done | Host bundle kept its own Effect runtime | Host bundle 1132 → 264 KB |
| project-checks | optimized | `DurableTasks.list` scanned and decoded every task row (up to 1000) then filtered to one Session | 9.7 / 6.0 / 5.9 ms → 0.16 / 0.39 / 0.15 ms (indexed per-session query), results identical |
| plugin-ui | optimized | `ListSelectionModel.isComplete` was O(n×m) (`orderedIds.every(id => ids.includes(id))`), run once per render of every select-all header | 300 ids 0.149 → 0.014 ms, 1500 3.841 → 0.042 ms (~91×), 3000 15.069 → 0.092 ms (~164×); 5 consumer suites green |
| agent-communication | optimized | `tracked` awaited the store's activity write (25 ms batch + full-snapshot fsync write, ~33 ms) before returning a tool result | peer listing 79.6/87.2 → 3.9/4.5 ms (~20×), ack 62.7/85.7 → 3.4/4.4 ms, inbox 101.1/111.9 → 32.2/42.0 ms |
| frame-layout | optimized | status strip re-rendered on every layout change (523 item renders per 130-change drag) though it reads only sessions/settings/registry | sidebar drag 0.893 → 0.525 ms/change, resize 0.753 → 0.356, rightbar drag 0.420 → 0.044 |
| pull-requests | optimized | `pollAll` ran one `gh pr view` per linked PR strictly sequentially (50 spawns × 46–51 ms per refresh; store reads 0 ms) | refresh p50 3084 → 829 ms (3.7×) at concurrency 6, spawn count unchanged, MERGED and rate-limit fixtures both 50/50 with 0 missed |
| resource-packs | optimized | `packOf` re-decoded the same pack JSON once per attachment (600 decodes for 5 packs) | list(200) 29.1 → 9.6 ms (~3×); per-call cache, no cross-call state |
| context-compaction | no-change | the planning pass is a single exact-serialization pass: 88 % of it is the one `JSON.stringify` per message the byte budget requires (5,000 msgs / 17.7 MB = 32.7 of 37.3 ms), 4.6 ms is all unit building and chunk assembly, sizing calls = one per message (zero re-tokenizing); real ranges peak at ~0.5 MB, so ~1–3 ms | — (rejected: `Buffer.byteLength` swap ~0.1 ms real; message-size memo only helps retries. The real cost is 3–9 **sequential** provider calls — 26–40 s p50 per compaction from event timestamps — a provider-traffic decision, filed as `b:9k2p`) |
| turn-summary | optimized | `update` copied the growing calls/results arrays per event (quadratic within a turn) for the footer summary of every loaded turn | long-session replay 63.06 → 41.84 ms (−34%), single 8k-event turn 20.89 → 8.33 ms; ingest alone 81× on one huge turn; output byte-identical |
| mentions (2nd) | optimized | remote-thread lookup was O(threads × sessions) with a fresh 782-element array per thread — 782k comparisons per keystroke at the schema's 1000-thread cap | at the cap 4.4191 → 0.1606 ms (27.5×), full derive 5.16 → 0.47 ms; 400-store sweep identical; costs ~2.5 µs at today's 8 threads (break-even ≈9) |
| agent-plan | optimized | `progress()` resolved every step's status with `write.todos.find(...)` — O(steps × writes × todos) — for every card that subscribes to the plan | fold 1.35 → 0.21 ms (6.4×), 30-card update pass 25.6 → 7.66 ms CPU; 400-history parity |
| sqlite-store | no-change | opening a 50,000-row / 9 MB WAL store is 0.755–0.852 ms p50 and identical for an empty 16 KB file, so no data-proportional path exists (split: underlying make 0.36, migrations 0.27, file-mode restrict 0.16, prepare 0.06, pragmas 0.05); the untraced statement wrapper is noise (20k trivial statements 48.6–54.9 vs 45.9–56.1 ms raw; 50k-row SELECT 14.6–18.1 vs 14.8 ms) | — (both residual ideas — skipping the duplicate migration `CREATE TABLE IF NOT EXISTS`, dropping an exists before chmod — are sub-millisecond, once per process, on schema-sensitive code) |
| agent-preset | optimized | the preset chip re-derived and re-wrote its snapshot on every drafts-store publish (2,000 draft updates → 2,000 writes and chip re-renders) although nothing it shows changed | notifications 2,000 → 0; ~111 ms of main-thread derivation/element work avoided per 2,000 updates; values unchanged |
| apply-patch | optimized | `replaceRanges` and the fuzzy loop rebuilt the whole file content per match (8,571 × 390 KB ≈ 3.3 GB copied), and the ambiguity path sliced+split the file per match | `replaceAll` 277 → 0.55 ms (end-to-end 283.8 → 6.0 ms, now I/O-bound), ambiguity error path 518.6 → 0.91 ms; 4,000-case differential fuzz, 0 mismatches |
| model-selection | optimized | the picker re-rendered its unvirtualized 496-row list on every directory snapshot (15 publishes for 15 unchanged events) and twice per keystroke (placement effect set a fresh position object) | pressure tick 12.19 → 0.01 ms (publishes 15 → 0), keystroke 13.05 → 8.48 ms (−35 %), open 43.68 → 37.99 ms |
| pulls-review | optimized | `reviewRevisions` spent one jj process per revision (30 describes + an ordering log + 30 diffs = 61 spawns for a 30-revision selection) | median 1449 → 576 ms (min 1358 → 499), spawns 61 → 2; ordering/unresolved/budget unchanged, batched read falls back on any inexact framing; real-jj equivalence test added |
| input-trigger | optimized | every menu-store update reconciled all 40 trigger rows, even when no row's props changed (4 notifications per keystroke with 3 sources) | refinement 0.76 → 0.15 ms, arrow highlight 0.75 → 0.19 ms, 3-source keystroke 1.77 → 0.94 ms; markup identical in 4 states |
| capabilities-hub | no-change | the page renders three static section cards and counts entries, it does not render rows: mount 3.61 ms (0 entries) / 3.87 ms (500+500) / 7.25 ms (2000+2000), full re-render 0.30 ms per pass, `skillCounts` 0.009 ms at 500; remounts inside the 30 s staleTime make 0 Host calls | — (the brief's row/search/remount workloads do not exist here; a forced memo would be unprovable) |
| thread-share | no-change | a served share page is 15.10 ms typical (21.29 ms at the 783 KiB ceiling), of which 9.05 ms is the per-view durable write (temp file + fsync + rename + dir fsync) and 4.75 ms the payload build (redact 3.0 + render 1.65); storage reads 0.11 ms, rate limit 0.11 µs | — (rejected with numbers: 5-pass escapeHtml → single regex 1.43 → 1.46 ms, URL-gated redaction saves 0.97 ms but adds a branch to a security filter; write-behind for the views counter is a durability decision, filed as `b:…`) |
| tool-meta | optimized | the shared 1 s clock exposed `now` as its snapshot, so in relative format every row re-rendered each tick though text cannot change for 60 s | 300 rows all ≥10 min old 18.32 → 0.53 ms wall / 22.64 → 0.53 ms CPU per tick; mixed ages 16.03 → 3.26 ms; absolute format unaffected |
| agent-telemetry | optimized | with content capture on, every model call re-mapped the whole captured conversation (schema decode per block, `decodeJson` per tool argument) | per call at 400 messages 0.764 → 0.170 ms (4.5×), 1000 messages 1.862 → 0.323 ms (5.8×); capture-off path flat |
| agent-questions | optimized | `listTargets({includeStopped:false})` — the path behind `list_thread_questions` and the 60 s/500 ms attention reconcile — listed the whole persisted corpus (2,777 artifacts) then kept only live Sessions | p50 422.5 → 0.014 ms, p95 451.2 → 0.063 ms; live spans had it at 569 ms p50 / 2,728 ms max, 99 % of a reconcile |
| diff-viewed | optimized | each of the up-to-31 `rangeState` reads after one write rebuilt every range's entries from 7,000 marks | 31 cold reads 76.0 → 4.0 ms (19×), unchanged state 76.0 → 0.11 ms; one toggle unchanged (storage-bound) |
| hmr-gate | optimized | the 500 ms fallback poll suspended two fibers per watched directory to discover its watches were already open (150 dirs in this profile) | idle CPU 33.50 → 14.10 ms per 8 s (2.38×), every legacy sample above every patched sample; status read 0.345 µs, digest 0.39 ms |
| agent-toolkit (2nd) | optimized | the page selected thread rows with no equality fn, so every store notification reconciled the whole page (120 tools / 40 skills / 60 API rows / 100 plugin rows) even when the projection was unchanged | renders over 200 no-op notifications 200 → 0, selector calls 200 → 200, equality check 0.33 µs; jsdom page re-render avoided 42.16 ms |
| attachment-gallery | optimized | tiles were unmemoized with per-tile inline callbacks, so each resolved image re-rendered the whole gallery (O(N²)) | load cascade n=200 338.2 → 56.3 ms render (6×), n=100 87.7 → 17.0, n=20 6.1 → 3.1; mount unchanged |
| mentions | no-change | per-keystroke `@` derive is 0.08–0.10 ms plugin CPU (20 files + 50 local + 8 remote threads; rank 0.026–0.035 ms at 70 entries); the brief's 5k-candidate case cannot occur — the native provider returns `maxResults=20`, the session resolver 50, the remote store 8 live rows | — (the real cost is Host-owned: native file-index rank 1.64–2.49 ms warm / 87 ms cold. Residuals filed: 4 Host calls per keystroke, 2 query-independent; `remoteMentionCandidates` is O(threads × sessions), linearized under `b:…`) |
| agent-toolkit | no-change | `decodeListing` 0.24 ms at 120 tools (0.70 ms at 400), `versions` 2.14 ms with 110 package.json reads, `instructionFiles` 0.15 ms; the static-decoder-hoist hypothesis was measured and falsified (0.10→0.10, 0.24→0.33 noise, 0.70→0.71); zero spans for this plugin in 24 h of traces | — (no registration/dispatch helpers exist here; the page's `useSessions` selector churn is a client-only, panel-open cost, filed as a follow-up) |
| goal-tool | no-change | `get_goal` p50 0.0019 ms flat at every size; `update_goal` complete 0.0232 → 0.0746 ms as the open turn grows 50 → 10k events, blocked 0.0196 → 0.0764 ms; the shared `snapshotEvents` copy is 0.0012 ms at 10k and cached | — (a suffix read would trade a cached O(1) for a cold slice and index math to save ≤0.07 ms, and updates happen once per round; zero goal-tool spans in 7 days of traces) |
| session-search | optimized | `truncate` materialized every document (`Array.from`) before applying the per-type cap — 590 ms of a 2.37 s ingest pass, scaling with untruncated payloads | full pass 2373 → 1737 ms (−27 %), CPU 2308 → 1634 ms; 60k-char documents 0.19 ms → ~0; 36,000 equivalence cases, 0 mismatches |
| mcp-endpoint | optimized | every `tools/list` rebuilt all descriptors including Effect→JSON-schema conversion for a static registry | listing p50 0.711 → 0.522 ms (−27%), CPU 1.58 → 1.08 ms; payload identical |
| session-undo | optimized | the undo/redo shared-directory guard called `sessionController.list({})` (folds every stored log: 2,764 logs / 2.9 GB here) then discarded every non-attached row | guard read 318–325 → 0.051 ms p50; the same controller call shows 2.5–8.1 s p50 in stored traces |
| whiteboard | optimized | every scene write decoded the full JSON twice — once pre-write, once re-reading the row it just wrote for a 9-field summary | full-scene write 17.5 → 5.5 ms (−69%), elements-only 17.6 → 11.7 ms, metadata-only 17.8 → 12.4 ms; 1600 elements byte-identical over 120 writes |
| thread-transfer | optimized | attachment detection schema-decoded every JSON object twice per event, twice per export | export 153.6 → 113.1 ms (−26%), import 89.9 → 75.3 ms; byte-identical bundle (sha256) and 400-object fuzz identical |
| project-automations | optimized | `runs` decoded every stored run (7,800 records) then sorted and sliced to return 20 | list 27.95 → 22.39 ms, runs(limit 20) 20.01 → 17.60 ms; remaining ~15 ms is dshx `pluginStorage.list` paging (recorded as a dshx follow-up) |
| component-gallery | optimized | every gallery re-render re-rendered all mounted `DemoCard`s and re-ran each demo's `render()` | filter re-render 12.50 → 0.35 ms wall, 18.56 → 0.37 ms CPU; tab mounts unchanged |
| html-render | no-change | at the plugin's contract ceiling (32 assets → 362 KB) publish p50 is 5.38 ms, of which the plugin's inlining is 0.16 ms (3%) and 4.0 ms is per-asset Host fs round trips (linear: 0 assets 0.65 ms → 32 assets 5.38 ms); `html_render` of a 510 KB page 0.29 ms | — (rejected: dropping the per-asset stat for 5 % but opening non-regular files before the guard; hoisting service lookups for 0.6 ms against the per-fiber idiom; a per-path asset cache against an invented workload) |
| user-questions | no-change | tick cost ≤60 µs per second (0.006–0.009 % of a core): one interval per pending card, memoized markdown, and an empty Host half (the tool is native) | — (a countdown-only re-render split would save ~50 µs/s; rejected as speculative) |
| loopback-access | no-change | status p50 30.8 µs (plugin work 0.06 µs; `listeners()` 1.7 µs from `server.address()`, no lsof spawns); settings snapshot 296–303 µs of a 476–514 µs end-to-end read; proxied first byte 3.3 ms vs 4.8 ms direct | — (declined: caching `networkInterfaces()` 65 µs without a VPN-aware invalidation story, skipping the post-write snapshot, memoizing 3.7 µs of a 198 µs render) |
| tool-search | optimized | each search re-projected the whole 429-tool registry (deep-cloning every schema) ~2× and re-tokenized every description per query | search p50 10.59 → 4.75 ms, p90 11.3 → 5.74; CPU/search 12.8 → 5.4 ms; projections 2.06 → 0.84; 64 queries × 2 modes, 0 mismatches |
| worktree-memory | optimized | RAM snapshot ran a serial `ps` then `lsof` chain and scanned the process table twice per probe | snapshot p50 96.1 → 86.4 ms, min 80.2 → 76.5; one fewer process spawn per snapshot; reported numbers identical |
| tweet-context | optimized | video windows decoded from file start to window end in both ffmpeg passes — a late window paid for the preceding minutes twice | window at 110–120 s of a 120 s video 1008 → 207 ms (4.9×); raw scan 0.48 → 0.09 s; frames byte-identical across 4 cases |
| queue-reorder | optimized | dock re-derived every row's preview per render and collapsed whitespace over the whole ~8.9k-char body to show 200 code points | row derive 3.24 → 0.27 ms (11.8×), per reorder 4.50 → 1.45 ms; 20k-case fuzz output-identical |
| prompt-stash | optimized | whole prompt bodies went into cmdk item values, so its superlinear scorer re-ran per keystroke | per keystroke at the library cap 1057.9 → 1.57 ms; recent tab 2083.9 → 1.62 ms; match set identical, relevance ranking traded for library order |
| policies | optimized | every pre-tool-call check re-derived each rule's escaped glob regex and serialized arguments before looking at any rule | 500 rules/check 67.1 → 8.7 µs (7.7×), 0 rules + 20 KB payload 38.7 → 0.3 µs; 30,153 before/after comparisons, 0 mismatches |
| agents | optimized | every editor keystroke re-rendered the 100-row agent registry (EntityRow + Switch + DropdownMenu each) | keystroke 19.6 → 2.16 ms (~9×); 10 agents 3.65 → 2.51 ms; host `agents.list` measured at ~2.3 ms and left alone |
| preview | optimized | dev-server probe ran sockets → ps → session list → cwd as a sum instead of a max | probe p50 152.2 → 125.9 ms; with a 150 ms session read 315.7 → 233.3 ms |
| command-palette | no-change | ranking already indexed/memoized: rankActions 0.075 ms (300 cmds × 6 aliases), rankThreads 0.37 ms (2000), rankFiles 2.27 ms at the 20k cap, registry burst 500 registrations 1.31 ms; component keystroke 16.7 ms CPU, of which ranking <0.1 ms | — (rejected: re-lowercasing in `rankActions` costs 0.075 ms, an index would add invalidation surface for no gain; capping/virtualizing results is a behaviour change) |
| annotations | optimized | sourcemap scan re-ran `JSON.stringify(map).length` for every (needle, bundle) pair as budget accounting; `classCandidates` also split compound selectors into one impossible name, and an impossible decoded position was returned as a source | warm create enrich 706.4 → 27.6 ms (26×), class resolve 331.9 → 5.8 ms, text fallback 346.3 → 20.4 ms; cold 1133 → 819 ms; corrected candidates cost +2–5 ms and add a guard that drops schema-rejected positions |
| fff-search | optimized | single-file `grep` sent the file's directory to the native finder, then filtered other files out in JS — scanning (and paginating) the whole directory, or the whole tree for a root-level file | root-level file with one match 1514.95 → 0.88 ms p50 (~1700×); nested file 54.95 → 1.02 ms; worker end-to-end 97.8 → 0.95 ms; whole-tree unchanged |
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

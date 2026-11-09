# Ultra-fast DSH

Resume here: live heap fixed (2,354 → 346–459 MB after GC; open follows no longer pin decoded logs or frames). Open: a long-lived browser tab keeps ~250 Session instances resident with open follows and reopens them all on every reconnect (session-controller client resident cap only bounds viewed Sessions) — agent working; then sidebar/main-tabs/session-controller list churn (GC while streaming), dshx client runtime rollout (flag exists, off), Host gap: native gateway `cancellableStream`/mux `pump` keep the last frame per stream.
before/after row in this file and its evidence in `docs/performance.md` or `docs/ram-usage.md`.

## Goal

The app must feel native: every interaction answers before the user notices, nothing janks while a turn streams, and
the Host stays small however long it runs. Structural changes come first; forking a native plugin is allowed when it is
the owner of the cost ([native plugin overrides](../../docs/native-plugin-overrides.md)).

Method: the `performance-optimization` skill (target, measure, hypothesis, smallest change, prove) and this repo's
[`live-performance-audit`](../../.agents/skills/live-performance-audit/SKILL.md) probes. This plan supersedes nothing:
the registers in [performance-optimization](../performance-optimization/README.md),
[memory-usage](../memory-usage/README.md) and [native-fork-waste](../native-fork-waste/README.md) stay the detailed
work lists; this file orders them and holds the targets.

## Targets

Measured on a clone of the live home on a scratch Host unless a row says live; live numbers only through the read-only
probes, never by restarting or snapshotting the live Host.

| Metric                                    | Target                          | Probe                                         |
| ----------------------------------------- | ------------------------------- | --------------------------------------------- |
| Thread switch, warm, content and composer | p95 ≤ 100 ms, no task > 50 ms   | `switch-probe.mjs`                            |
| Thread switch, cold thread                | p95 ≤ 250 ms                    | `switch-probe.mjs` after a Host start         |
| New thread to focused composer            | ≤ 100 ms                        | scripted click, `dshx dev`                    |
| Page reload to interactive                | ≤ 1.5 s; boot JS parsed −50 %   | `har-capture.mjs`, `__DSH_BOOT__`             |
| Streaming a turn                          | no long task > 50 ms, ≥ 55 fps  | performance observer during a scripted turn   |
| Requests per interaction                  | ≤ 3, none queued behind streams | `REQUESTS=1 switch-probe.mjs`, HAR            |
| Host event loop                           | lag p99 ≤ 50 ms                 | `host-lag.mjs`                                |
| Host heap after GC, idle after boot       | ≤ 400 MB                        | CDP `process.memoryUsage` on the scratch Host |
| Host heap after GC, after a day of use    | ≤ 800 MB, flat                  | live `ps` RSS trend; scratch replay           |
| Browser tab heap, 10 threads visited      | ≤ 500 MB                        | `performance.memory` / CDP on the page        |

## Workstreams (structural first)

| Id  | Workstream                                                                                                                                                                                                          | Owner(s)                                                 | State       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------- |
| U0  | Land today's line: dshx shared Host module / client code splitting, full rebuild, clone verification                                                                                                                | dshx, all plugins                                        | in progress |
| U1  | Host heap: every long-lived holder named and bounded (idle Agents, cold memo, per-client copies — native-fork-waste P0)                                                                                             | session-controller, persistence fork, core forks         | partly done |
| U2  | Host footprint and boot: one dshx runtime instead of 89 inlined copies, through immutable content-addressed snapshots (a shared mutable dist was rejected: version skew); activate plugins on demand; boot ordering | dshx, profile                                            | not started |
| U3  | Transport: no request waits behind the six HTTP/1.1 sockets; RPC and streams over one multiplexed connection                                                                                                        | shared-streams, session-controller client, dshx api      | not started |
| U4  | Client boot: lazy chunks (landed: editor 5.85 → 0.28 MB, pulls-review 1.72 → 0.91 MB), lazy plugin evaluation, CSS size, nothing parsed that the first screen does not use                                          | dshx client compiler, heavy plugins                      | partly done |
| U5  | Client rendering: transcript and sidebar virtualized, streaming coalesced per frame, DOM budget per thread                                                                                                          | chat / rich-composer forks, thread-sidebar               | not started |
| U6  | Session read path: no whole-corpus loads (`dsh-session-query` readSession), tail restore always, small follow payloads                                                                                              | session-query fork, session-controller, persistence fork | partly done |
| U7  | Background work: everything demand-gated and bounded (search worker, fff, traces, usage, jj)                                                                                                                        | owners                                                   | partly done |
| U8  | Native feel: optimistic navigation, hover prefetch, warm last-N threads, no layout shift, instant composer                                                                                                          | client plugins                                           | not started |

## Baseline (2026-11-09 19:08, after U0, clone of the live home on the full rebuild, scratch Host :3097)

Machine load fell from 10.9 to 3.0 during the run; the switch rows were taken at load ~7–10, so they read high.

| Metric                                       | Baseline                                                                                              | After                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| warm switch (thread with history)            | composer 743–902 ms, history 768–950 ms                                                               | composer 221–333 ms, history 225–337 ms (U5/U8, clone 3111, load ~3.9)                                                   |
| browser long tasks per switch                | 3–4 tasks, 601–808 ms in total                                                                        | 1–2 tasks, 121–219 ms in total, longest 99–142 ms                                                                        |
| DOM nodes after a switch                     | 2,946–3,534                                                                                           | 1,736–3,026 (unchanged: transcript not virtualized)                                                                      |
| requests per switch                          | 17–28 (slowest `session/modelCatalog` 298 ms, `threadAt`/`context` 375 ms, one `dshx-batch` 1,031 ms) | 3–4 warm (`schedule/list`, serving-account batch, preview batch); no `modelCatalog`, `session/page`                      |
| `session/page` on an empty New chat draft    | 9,104 ms                                                                                              | 8.7–9.6 s: multi-host `owns()` over SSH (not Host read); Host part 0.1–2.9 s → 6–46 ms; cold 90 MB follow 9.1 s → 147 ms |
| Host lag, settled                            | p50 4 / p99 10 / max 27 ms (inside target)                                                            |                                                                                                                          |
| Host lag, first minute                       | p99 162 / max 275 ms (boot passes)                                                                    |                                                                                                                          |
| Host heap after GC, settled                  | 343 MB, rss 1,017 MB                                                                                  | 275 MB, rss 914 MB (shared dshx runtime snapshot; idle Agents disposed after 5 min)                                      |
| Host bundle code (all plugins)               | 24.6 MB                                                                                               | 8.1 MB                                                                                                                   |
| Host lag, settled                            | p99 10 / max 27 ms                                                                                    | p99 10 / max 12 ms                                                                                                       |
| streaming React commits / fibers per s       | 68–70 / ~4,050                                                                                        | 17–18 / ~480                                                                                                             |
| sidebar rows mounted / DOM after full scroll | 1,040 / 25,139                                                                                        | ~29 / 990                                                                                                                |
| tab JS heap after 3 threads                  | 201 MB                                                                                                |                                                                                                                          |
| editor first file open (lazy Monaco chunk)   | chunk 1.7 MB in 57 ms, not loaded at boot                                                             |                                                                                                                          |

Not yet measured: cold switch after a Host start, reload to interactive, streaming long tasks, tab heap after 10 threads.

## Results after the 2026-11-09 waves (clone of the live home)

| Metric                                       | Baseline                                                       | After                                                 |
| -------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| warm switch, composer + history              | p95 192 ms (in-page probe; 743–902 ms in the Playwright probe) | p95 80–92 ms, p50 59–63 ms                            |
| long tasks per warm switch                   | 165 ms total, max 134 ms                                       | none in most rounds (one 52 ms)                       |
| requests per warm switch                     | 11–19                                                          | 3–4                                                   |
| warm reload to interactive                   | 1,623–1,827 ms                                                 | 850–1,106 ms                                          |
| cold boot JS decoded / on the wire           | 38.2 / 13.8 MB                                                 | 31.8 / 11.5 MB                                        |
| empty New chat draft `session/page`          | 9,104 ms                                                       | 83 ms                                                 |
| first open of a 90 MB thread after a start   | 9,114 ms                                                       | 147 ms                                                |
| largest thread DOM after reading up and back | 29,123                                                         | 5,084                                                 |
| Host heap after GC, settled                  | 343 MB                                                         | 343 MB (resumed Agents now disposed after 5 min idle) |

## Open items

- Streaming: long tasks and frame rate while a turn streams (not measured yet).
- jj-integration `readWorkspaceRunning` / `readWorkspaceQuestion` scan the whole Session list once per mounted conversation on every list change (now up to three kept views).
- Cold (first-visit) switch still pays scroll restore, caret and width-measure layouts; the open-thread event path costs ~60 ms more than a row click.
- Sidebar virtualization (C02); transcript windowing is one-directional (reading far up still grows the DOM until back at the tail).
- Boot duplicates left (2026-11-09, see `docs/performance.md`): stock `ui-settings` `settings/describe` (its row id is the `ui-settings` settings namespace, so it cannot be forked under a new row); per warm switch `session-undo` `history`, `preview` `devServers`.
- dshx client runtime still inlined (~83 KB × ~70 plugins) and dshx Host runtime inlined (17 MB): needs immutable content-addressed runtime snapshots (U2).
- Core: Vite `/assets/*` shell served without cache-control.

## Done on 2026-11-09 (jj line above `main`, not yet on main)

Measured where noted; details in each revision's description.

| Change                                                                                                                                                            | Evidence                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| capabilities-hub market page no longer double-declares `settings.section` (client crash)                                                                          | crash gone on a live-data clone                      |
| session-controller cold list: no inline log reads; background fold, size-gated (16 KiB), persisted                                                                | 1,003 s → 33 s second boot; list 571 ms avg          |
| session-controller: filtered-list block cache, corpus patched on create/dispose, follower size once                                                               | tests                                                |
| session-controller: idle Agent disposed after 5 min; drain reads one log                                                                                          | 90 MB thread held +410 MB forever before             |
| session-search: orphan-only checkpoint prune + one-time rebuild; incremental live title read                                                                      | 1,890 lost checkpoints being rebuilt; heap flat      |
| request-messages: no persisted step projection (tail restore no longer disabled)                                                                                  | restoreFloor traced                                  |
| persistence-jsonl: lazy catalog hashing; folder memo + header cache; cold memo bounded                                                                            | lookup 112 ms → 0.2 ms; warm list 76 → 32 ms         |
| session-log-window: small-log tail refused before lookup                                                                                                          | 393/785 wasted reads                                 |
| jj-integration: one jj log per repo, op_heads cache key                                                                                                           | 45 workspaces 1,487 → 54 ms                          |
| model-selection: catalog refresh ≤ 1/s                                                                                                                            | 4–6 → ≤ 2 reads per switch                           |
| backlog: compact lazy search index; lease sweep point lookup (thread-sidebar `status`)                                                                            | 141 → 18 MB synthetic                                |
| ai-accounts: quota history in SQLite; ambient polling 5 min                                                                                                       | 27.7 MB heap and 13.5 MB rewrite per reading removed |
| phone-pairing, project-automations, backlog start recovery, settings-shell open requests, hmr-gate crash recovery, dshx keyed teardown, dshx zod-view decode once | tests                                                |

## Rules for every change

- One logical change per jj revision, Conventional Commit title, body says why with the numbers.
- Never restart, kill, profile-by-restart or snapshot the live Host (:3080) or attach to its inspector (127.0.0.1:9230).
  Measure on a scratch Host from an APFS clone of `~/.dsh` on another port and inspector port; verify the inspector pid.
- Rebuilt client bundles hot-reload into the user's open page; batch rebuilds and tell the user when Host halves need a
  restart.
- Fix at the owner: owned plugin in place, native package through a recorded fork, core gaps in
  [dsh-host-gaps](../dsh-host-gaps.md).

# Performance: what made the live GUI slow, and what fixed it

How to measure: the [`live-performance-audit`](../.agents/skills/live-performance-audit/SKILL.md) skill. Budget:
250 ms per interaction and per request, on a Host whose event loop is not stalled.

## Per-thread polls in background main tabs (2026-11-12, issue #142)

Scratch Host (`dshx dev up`, every bundle `profiles/web` loads, three seeded threads in the jj `sample` project),
headless Chromium, `har-capture.mjs --seconds 90 --switches 12 --switch-every 5 --visit 'tab:Threads'`: 90 s idle on
the landing thread, 12 switches over the three threads 5 s apart, then 90 s idle again. Calls are counted per
`dshx-batch` call, not per POST.

Main tabs keep every visited thread's composer, header and transcript mounted. Four per-thread reads polled for every
mounted thread, so after visiting three threads each one ran three or four times over: session-undo `history` and
queue-reorder `scheduled-sends/list` (15 s each), preview `devServers` (10 s) and chat `chat-resume/available` (30 s
while a Retry or Resume shows). Each now polls only for the thread the main view shows
(`@dshfiles/plugin-ui/hooks/session-on-screen`, the `Composer` contract's `current`, or preview's `onScreen`); a thread
off screen still reads once when it mounts, so a side-panel composer shows its controls. The multi-host interaction
feed asked a live event stream every 15 s; it now asks once a minute (a dropped stream already re-reads when it turns
live again), and a non-live status no longer triggers an extra read.

| Calls per minute (same script)    | Before | After |
| --------------------------------- | ------ | ----- |
| idle, landing thread only         | 40.0   | 40.0  |
| while switching                   | 143    | 104   |
| idle after visiting three threads | 74.4   | 44.5  |
| `session-undo/history`, after     | 11.3   | 4.3   |
| `scheduled-sends/list`, after     | 11.3   | 4.3   |
| `preview/devServers`, after       | 18.4   | 6.5   |
| `chat-resume/available`, after    | 5.7    | 2.2   |
| `multi-host/sessionInteractions`  | 4.8    | 1.0   |

The interaction-feed row is a separate 150 s idle capture after rebuilding multi-host and user-questions, which
bundles its own copy of the feed (reads at 61 s and 121 s, against every 15 s before). Regression checks: `undo-history-poll.test.ts`, `scheduled-sends-poll.test.ts`,
`dev-server-poll.test.ts`, chat `tests/resume-interrupted.test.tsx`, multi-host `interaction-feed.test.ts`.

Still polling at idle on one thread (owners for the next pass): thread-sidebar's usage-limit row reads
`ai-accounts/quotaContinuations` every 15 s with no continuation; traces `traces-alerts/feed` every 15 s; the
on-screen thread's undo history and scheduled sends every 15 s (no Host event announces a new checkpoint or
schedule); multi-host `threadList` and `list` every 30 s. Per switch, `browser-traces/export` (1) and
`jujutsu-composer/context` (≈1, the duplicate noted on 2026-11-09) remain.

## Folder locations expire spread out (2026-11-12)

The live traces showed bursts of 70–80 `jj root` spawns in one repository scan: every registered folder's location is
cached for 30 minutes, and one scan fills them all, so they all expired together. Each folder's entry now lives
30 minutes plus its own offset in a 15-minute window (a hash of its path). Regression check:
`repository-views.test.ts` "spreads the re-locates of folders cached by one scan instead of re-locating them all in one
later scan" (80 folders: 80 re-located in the scan at 31 minutes before, under 20 after, all 80 by 46 minutes).

| 80 folders located by one scan     | Before                  | After                              |
| ---------------------------------- | ----------------------- | ---------------------------------- |
| `jj root` in the scan at 30 min    | 80                      | the few whose offset passed        |
| spread of the re-locates           | one scan                | 30–45 min, at most 6 in any minute |

## Thread workspace scans pinned to commits (2026-11-12)

Same live window: `thread workspaces list` spawned 74 `jj log` reads at about 2.1 s each, 88 s of jj in 39 minutes. One
read answers every thread workspace of the repository (58 on dshfiles): its unlanded revisions and, the expensive half,
`latest((::main ~ ::<name>@) ~ empty(), 1001)`, evaluated again by each workspace's `contained_in` mark (revset alone
1.4 s, unlanded halves alone 0.1 s). It already runs with `--ignore-working-copy`; `latest(…, 1001)` is the only bound
that keeps the displayed count; `--at-op` would key on the same moving head; concurrent identical reads already share
one process through `JjViewReads` and the single-flight scan. What it lacked: the view-read cache keys on the operation
head, which any agent's snapshot moves, so every scan paid for all 58 workspaces although one or two had changed.

Fix: `workspace list` now also prints each workspace's working-copy commit, the target is read as commit ids, and the
query names those commits instead of `<name>@` and the bookmark. A workspace's halves are then a function of two commit
ids, kept in a 512-entry map; a scan reads only the workspaces whose working copy or target moved. Same output on the
dshfiles repository (byte-identical for all 58). Regression check: `threads-list.test.ts` "re-reads only the
workspaces whose working copy or target moved since the last scan" (two workspaces read again after another
workspace's operation before, none after; one after one thread moves; all after `main` moves).

Replay of the live window on the dshfiles store (read-only, `--at-op` at the operation current every 32 s, 74 scans):

| `thread workspaces list` halves read | Before (every workspace) | After (moved workspaces only)               |
| ------------------------------------ | ------------------------ | ------------------------------------------- |
| `jj log` spawns                      | 74                       | 34 (40 scans need none)                     |
| per scan, median                     | 2,631 ms (55–58 read)    | 0 ms (0 read); 1–3 workspaces 105–237 ms    |
| jj time in 39 minutes                | 198.7 s                  | 10.0 s, of which 2.9 s the first, cold scan |

The replay times the old query (workspace names and the bookmark) and the new one (commit ids, only the workspaces
not read at an earlier sample) at each sampled operation; `jj log` over all 58 workspaces by name and by commit id
printed the same bytes in the same 2.8–3.4 s, and one workspace alone took 105–118 ms.

## Inbox thread titles from the activity cache (2026-11-12)

Same live window (17:36–18:15): `jj-integration attention reconcile` ran 102 times at 4.6 s mean, and 19 of the 47
`session activity list` spans in it were reconcile's own. Each lists every Session through the controller (3,257 records,
1,302 ms mean live) only to read the titles of the ready or blocked threads' last Session.

Fix: reconcile reads titles from `SessionActivity.display`, the 30 s cache every repository scan already refreshes
right before reconcile reads the views. A rename can reach the inbox one pass late. Regression check:
`attention-provider.integration.test.ts` "names a ready thread from the cached Session activity instead of listing
every Session per reconcile" (a `session activity list` child under the reconcile span before, none after).

| Per reconcile with a titled ready or blocked thread | Before                       | After             |
| --------------------------------------------------- | ---------------------------- | ----------------- |
| full Session list reads                             | 1                            | 0 (display cache) |
| that read, live Host (3,257 records)                | 1,302 ms mean (19 in 39 min) | —                 |
| that read, scratch Host on cloned Sessions (3,257)  | 134–151 ms                   | —                 |

Scratch: `dshx dev up --skip-build` with jj-integration, activity-timeline, traces, session-controller and
session-persistence-jsonl, then an APFS clone (`cp -c -R`) of the live `sessions/` into its home; spans read from the
scratch traces store. Its thread workspaces own no Session, so reconcile there never listed before or after; the
per-reconcile count comes from the regression check and the live traces.

## Inbox diff stats survive other workspaces' operations (2026-11-12)

The live traces store (copied, 17:36–18:15, after the Host's last boot) put `jj diff` at 516 spawns in 39 minutes,
13.2/min and 54 % of every jj process the Host started, all under `jj-integration attention reconcile`: each pass (2-minute
safety tick plus Session settles) runs `jj --ignore-working-copy diff --stat -r <unlanded commit ids>` per ready thread.
The view-read cache keyed them on the store's operation head, which other agents move every few seconds, so it almost
never hit. Steady Host event-loop stalls in that window were rare (4 over 100 ms in 35 minutes, max 286 ms), so the
measurable steady cost is spawned processes, not main-thread time.

Fix: `@dshfiles/jj-cli`'s `JjViewReads` keys a `diff` whose every `-r`/`--from`/`--to` value is a union of full commit ids
by its arguments alone (256-entry LRU): the ids fix the trees, so the output is the same at any head. Any other diff
still keys on the head. Regression check: `jj-view-reads.test.ts` "answers a diff over full commit ids across
operations, and re-reads a diff that names @" (two spawns before, one after).

Probe: scratch Host (`dshx dev up --plugin @dshfiles/jj-integration --plugin @dshfiles/activity-timeline --project`)
on a repository with 12 ready thread workspaces, a logging `jj` first on the Host's `PATH`, and a driver that lands one
operation from a non-thread workspace every 15 s for 6.5 minutes (26 operations, three safety reconciles):

| Host jj spawns in 6.5 min | Before | After |
| ------------------------- | ------ | ----- |
| `diff`                    | 36     | 0     |
| `log`                     | 17     | 17    |
| other                     | 11     | 11    |
| total per minute          | 9.8    | 4.3   |

## "@Mention thread" resolves one Session, not the corpus (2026-11-12, `b:450`)

The tab menu's **@Mention thread** item dispatches a client event; the mounted composer
(`@dshfiles/thread-sidebar`'s input seat) awaited `ctx.remote.sessionReferenceResolver.candidates` before it inserted the
chip. That native read (`@deepseek-ai/dsh-session-reference`) lists every Session through `sessionQuery.listSessions`
and labels each one before it filters by the query, so resolving one known id costs the whole corpus per click. An
isolated E2E run showed 239.73–271.78 ms for the click and 361–371 ms to the chip, but those numbers include
Playwright actionability and `expect.poll` overhead; the probe here timestamps the menu-item `pointerdown` and the
chip's first paint inside the page, so it measures the app, not the harness.

Probe: scratch DSH (`dshx dev up`, ten owned bundles), 820 synthetic cold Sessions cloned from the scratch instance's
own headers and projection cache (the live corpus is ~808), then 8 repetitions of right-click tab → click
`@Mention thread` → wait for `[data-composer-chip="reference"]`. Runs alternate between the parent build and the fixed
build on the same machine; `menu open` (right-click to menu visible) is the load control. Load average stayed ~25–40
on 10 cores across the runs, with one before run's later samples stretching under it.

| Click → chip                          | Before (parent) | Before (recheck) | After (one-Session read) | After (recheck) |
| ------------------------------------- | --------------- | ---------------- | ------------------------ | --------------- |
| median                                | 388 ms          | 581 ms           | 47 ms                    | 47 ms           |
| spread                                | 245–631 ms      | 251–845 ms       | 45–47 ms                 | 45–48 ms        |
| `sessionReferenceResolver.candidates` | 205–597 ms      | 220–803 ms       | —                        | —               |
| `thread mention resolve` (new)        | —               | —                | 1–8 ms                   | 1–11 ms         |
| menu open (load control)              | 62 ms median    | 68 ms median     | 64 ms median             | 62 ms median    |

Fix: `@dshfiles/thread-sidebar` exposes `thread-mention-candidate/resolve`, one bounded Host read that finds the live
Session through `ctx.agents` (or the stored header through `ctx.sessionPersistence.stat`, no corpus listing), labels it
from the projection registry or the projection cache with the same `title`/`subagent` keys the native resolver uses,
and formats the canonical mention with the native `formatSessionReferenceMention` codec. The client tries it first and
keeps the native resolver, including its remote-thread fallback, for a self reference, a missing Session, an
unreadable store, or an older Host. The Host unit opens one `thread mention resolve` span with the target Session id
and whether the request was a self reference, never a title; `dshx.features.json` lists it with its `recordSpans()`
test.

Regression checks: `mention-candidate.test.ts` fails if the read lists the corpus (its fake persistence and
`sessionQuery` record any list call) and fails if the span disappears or carries the title.

## Compaction engine setups replayed on recorded threads (2026-11-12, `b:2ng6`)

Five recorded threads (tool-heavy, large tool results, images, a 128k model, skills with subagents) replayed through
the real agent loop under four compaction setups. Keeping both engines automatic (the seed) wins: demoting or removing
the stock row loses 158–968 recorded steps to unrecovered overflows on any thread with an image, because the owned
engine refuses image summaries on routes without image pricing. Turning on the root pruner cuts checkpoints 9–45 % but
adds up to 19 % uncached tokens. `loadedSkills: names` is now on in the seed (skills kept after a checkpoint 11–34 % →
37–100 %, under 0.5 % more tokens). Table, method and what would settle the pruner question: the
[context-compaction README](../plugins/@dshfiles/context-compaction/README.md#engine-setup-comparison-2026-11-12-b2ng6).

## Decoded logs share repeated replay signatures (2026-11-12, `b:rfp1`)

A pre-fork `assistant/message` stores each provider reasoning signature on the message source and again on the terminal
stream chunk; `JSON.parse` made each copy its own heap string, so every decoded log held two. The owned
`session-persistence-jsonl` scanner now keeps one copy of each 256+ character string a log repeats; values are unchanged,
so provider replay and transcripts read the same events. Same fixture, real forked persistence plugin, heap after GC:

| 400 messages, 3.3 MB unique signatures | Before  | After   |
| -------------------------------------- | ------- | ------- |
| Decoded log retained                   | 7.24 MB | 3.93 MB |
| `scanLog` alone                        | 7.39 MB | 4.07 MB |

Not measured: a scratch Host A/B through `dshx dev` and the live Host (the change needs a Host restart; the live Host
read 441 MB RSS on 2026-11-12, see [RAM usage](ram-usage.md#what-the-memory-was)).

## Session list cache-hit tail (2026-11-12, `b:17rs`)

After the corpus cache, misses no longer cost anything; the tail sat on cache hits. Stored traces of the Host started
2026-11-12 00:56 (read-only `traces.db` query, 75 `session list read` hits after the first 90 s, 3,194 rows, 3,181
cold) named two owners, both in `@dshfiles/session-controller`'s `ApiSessionList`:

1. **Every hit waited on the store probe.** Once a second a list first re-stamped the store's 805 project directories
   (`session corpus revalidate`) and awaited it: 54 ms on average, but 616-1,263 ms in the slowest reads, which it
   dominated. The probe issued all 805 `stat`s at once, queueing them on libuv's four-thread pool ahead of every Session
   log read and append the Host made meanwhile.
2. **The list loop itself spent ~25 ms of CPU** rebuilding each cold row's summary (projection view, metadata lookup,
   object spreads) on every call, more than the 16 ms work slice, so a busy Host stretched it over yields: one hit spent
   1,084 ms outside the probe. Boot-time hits (4.3 s and 8.1 s while plugins activated) are the same loop plus the
   first projection views and metadata recovery.

Fix: a list waits at most 100 ms on a due probe, then serves the cached corpus while the probe finishes and announces
what it finds with `api-session/added` (span attribute `revalidation: settled | background`); the probe keeps eight
`stat`s in flight; each cold row's full summary is memoized per record and dropped on the Session's events and when its
metadata settles. Regression tests in `tests/host/list-corpus-cache.test.ts` (a blocked probe no longer blocks the list;
a warm list reuses the row) fail on the previous `list.ts`.

| Measure                                         | Before              | After                             |
| ----------------------------------------------- | ------------------- | --------------------------------- |
| Live hits, p50 / p95 / max                      | 42 / 864 / 1,486 ms | not measured (needs Host restart) |
| Same reads with the probe wait capped at 100 ms | —                   | 42 / 474 / 1,184 ms (projection)  |
| Warm list CPU, 3,200 cold rows (scratch, A/B)   | 25.0 / 23.0 ms p50  | 8.6 / 7.1 ms p50                  |

The projection only subtracts the probe time above 100 ms from each stored read; the CPU A/B ran both implementations
in one vitest process (`process.cpuUsage` per list, 40 lists, load average ~100 on the machine). Live after numbers need
a Host restart, which is the user's call.

## Repeated plugin-client reads: per-plugin request census (2026-11-12)

b:510 reported 38 requests in about 18 s with `aiActivity`, `graphPage`, `modelCatalog`, `listProviders`,
`listConfigurableProviders` and `describe` repeating. The census is `har-capture.mjs` with a fixed workload: load,
idle 15 s, six thread switches 3 s apart over three seeded threads, then the Backlog panel (`tab:Work>button:Backlog`)
and the revision graph (`tab:Land>button:History`) for 15 s each. `--initiators` names the calling functions of each
core read. Scratch only (`dshx dev up`, four `tool-call-thread` seeds); counts are calls, batched or not.

```sh
node .agents/skills/live-performance-audit/scripts/har-capture.mjs --seconds 15 --switches 6 --switch-every 3 \
  --visit 'tab:Work>button:Backlog' --visit 'tab:Land>button:History' --out census.har
node .agents/skills/live-performance-audit/scripts/har-summary.mjs census.har --top 80
```

| Read (owner)                                       | Cause                                   | Before | After |
| -------------------------------------------------- | --------------------------------------- | -----: | ----: |
| `backlog/aiActivity` (backlog panel)               | 1 s poll while the panel shows          |     16 |     1 |
| `thread-sidebar-restart/autoRestartStatus` (strip) | 5 s `setInterval` refetch on every page |   10 ¹ |   1 ¹ |
| all `/api/` requests, focused workload             |                                         |    128 |   121 |
| dshx batch calls, focused workload                 |                                         |     73 |    59 |

¹ Full `profiles/web` scratch (the status strip mounts only there), load + 30 s idle + six switches.

The fix is event-driven invalidation, not a longer poll. The backlog Host tracks running AI work in a
`SubscriptionRef` and publishes `aiActivityChanged` on each idle↔busy flip; `aiActivity` carries the `ai-activity`
tag the event invalidates, so the page-wide resource store stops polling while the event is live and keeps the 1 s
poll only for an older Host. Thread-sidebar's automatic restart publishes `autoRestartChanged` when its status differs
from the last tick, and the strip reads through `useResource` with a 5 s fallback poll; a restarted Host is a new
connection generation, which re-reads it, so the reload-after-restart still fires.

Not changed, with the reason:

- `session/modelCatalog`, `llm/listProviders`, `llm/listConfigurableProviders`: one or two reads per page load, from
  the model selector (`joinPageRead`, shared key) and the Models onboarding store; none repeated during idle or
  switches. The live report's repeats need a Host change burst (settings, credentials, adapters), which both stores
  already coalesce.
- `settings/describe` (~120–250 KB): two to four reads per load, both from core's settings mirror (`run`, async
  stack cut); a Host-gap candidate, not an owned client.
- `credentials/describe` ×7 on load in the focused scratch: the stock `ui-settings-web-search` card
  (`readCredential`), which `@dshfiles/settings-web-search` replaces in `profiles/web`.
- `graphPage`: the revision graph keys its page set by repository snapshot generation, so it reads again only when
  the graph changed and the viewport needs a top-up; correct invalidation, left alone.
- `session-turn-admission/snapshot` every 3 s (10–16 per run): fixed on 2026-11-12, see below.
- `attention/list` (activity-timeline, 12 per run in the original census): addressed below.
- Core `agentPresets/list` (10, one per switch): next candidate.

### Shared attention reads (2026-11-12)

The glyph and Inbox panel each invalidated a plugin-local Query cache on `attention.changed` and polled even while the
channel was live. Thread Sidebar independently subscribed and read both Needs you and Other with a 200-item limit; the
Inbox used a 100-item limit, preventing sharing across the two plugin caches. The explicit Next Waiting shortcut also
reads on demand, but was not invoked in this workload. The list now carries an event-invalidated resource tag; the glyph,
panel and sidebar share a page-wide resource per view at 200 items, with the Inbox's original 100-item display limit.
One event subscription invalidates the views; a 15 s fallback runs only when that event is not live.

A fresh full-profile scratch Host with four fake-provider thread seeds ran the census command above, with `--initiators`,
before and after rebuilding the two plugins. Both captures completed; the Hosts were separately seeded, so total API
traffic is not a controlled performance comparison. The scratch doctor reported an unrelated phone-access port-in-use
error; all attention calls shown returned 200. Batched call payload digests identified the three baseline inputs as
Needs you/100 (glyph), Needs you/200 and Other/200 (sidebar); the final two are the shared 200-item views. A later burst
remains in both runs and may reflect a real change, not necessarily a duplicate. Batch transport does not expose a
separate initiator stack per call.

| Read / workload                | Before | After |
| ------------------------------ | -----: | ----: |
| `attention/list` calls         |      6 |     4 |
| Distinct attention list inputs |      3 |     2 |
| All `/api/` requests (context) |    115 |   121 |

### Waiting-turn admission pushes its changes (2026-11-12)

Chat's waiting-turn dock (`TurnAdmissionDock`, mounted with every open thread's composer) refetched
`session-turn-admission/snapshot` every 3 s. The session-controller Host now publishes `session-turn-admission`
`changed` on every queue change (hold, release, force start, drop, limit change) and, while a turn waits, on each
running-count change; `snapshot` carries the `turn-admission` tag the event invalidates, and the dock reads through
`useResource` with a 30 s fallback poll only while the event is not live (an older Host). Scratch census, same
workload both times (`dshx dev up` with session-controller, chat, thread-sidebar, rich-composer and their cooperators,
14 seeded threads, `har-capture.mjs --seconds 30 --switches 6`; the after run needed a scratch Host restart for the
new Host code):

| Read                                | Before | After |
| ----------------------------------- | -----: | ----: |
| `session-turn-admission/snapshot`   |     16 |     1 |
| all `/api/` requests, same workload |     66 |    51 |

## Jujutsu drag preview (2026-11-12; same probe before and after, starved machine)

Dropping a revision, bookmark or workspace on the revision graph waited for `jujutsu/prepare` ("Preparing a state-bound
preview…"): 466–770 ms on a scratch Host and 934 ms in one live sample ([graph prefetch](#jujutsu-revision-graph-prefetch-2026-10-30-baseline-2026-10-31-integrated-live-after-probe)).
No stored trace covered a prepare, so the probe is a test that runs the real `Mutations.prepare` over real jj on the
`dshfiles` store (106 workspaces): a rebase of `@` onto `@--` and a move of that workspace to `@-`, never confirmed.
The first round is cold (empty view-read cache); the rest are warm (same operation head). Before: the previous Host
files restored in a throwaway revision on top, alternated with after.

```sh
PREPARE_PROBE_REPO=<thread workspace> pnpm --dir plugins/@dshfiles/jujutsu exec vitest run src/mutation-prepare.probe.test.ts --testTimeout 600000
```

Attribution: jj subprocesses, all of it. Prepare took a full repository snapshot first: `root` → `status` →
{`log --limit 501 all()`, `diff @`, `git remote list`, `op log --limit 1000`} → `evolog` over ~460 commit ids →
(workspace actions) `workspace list` twice, each snapshotting the working copy → the target-state `log`. Host CPU
(parsing) and payload (the preview is at most 8 KB) were negligible; the panel already renders at the drop. The
500-row log never hit the graph's cached reads, which use other limits. After: one parallel round of
`--ignore-working-copy` view reads for only the named revisions, the target digest and, when the action needs them,
paths, remotes or workspaces; confirm still snapshots `@` and refuses a changed target.

Load average was 55–85 on 10 cores for every run (other agents' builds and E2E runs); one jj spawn cost 0.6–1.8 s
against 80–340 ms on an idle machine, so compare spawns and rows, not absolute seconds.

| Prepare                  | Before (2 passes)                  | After (3 passes)                                |
| ------------------------ | ---------------------------------- | ----------------------------------------------- |
| Rebase, cold             | 11.8 s, 11.6 s; 8 spawns, 5 serial | 6.8 s, 2.2 s, 7.8 s; 3 spawns, 1 parallel round |
| Rebase, warm p50         | 3.8 s, 4.0 s; 3–4 spawns           | 13 ms, 15 ms, 12 ms; 0 spawns                   |
| Workspace move, cold     | 13.5 s, 8.2 s; 6–10 spawns         | 3.7 s, 2.0 s, 4.6 s; 3 spawns, 1 parallel round |
| Workspace move, warm p50 | 7.9 s, 4.9 s; 5–6 spawns           | 198 ms, 8.8 s\*, 9 ms; 0 spawns                 |

\* A warm round that spawns nothing and still takes seconds (also one 16.5 s rebase round) is the probe process
descheduled on the starved machine, not jj.

The same drag in a browser: a fresh scratch DSH per variant (`dshx dev up` with Jujutsu, JjIntegration, MultiHost and
UiStyles; the sample project with three more revisions and the `shared-workspaces` seed; 1280×800), and a Playwright
probe over the scratch Chromium's CDP port that drags `feat: second change on first` onto `fix: sibling change` and the
`review-01` chip onto `feat: first change`, times drop → preview summary, then cancels. Both variants carry the new
client; only the Host files differ. Pass 1 ran right after boot in both variants and took 18–30 s, so it is left out.

| Drop → preview ready, passes 2 and 3 | Before           | After         |
| ------------------------------------ | ---------------- | ------------- |
| Rebase                               | 842 ms, 2361 ms  | 335 ms, 26 ms |
| Workspace move                       | 2885 ms, 6447 ms | 55 ms, 49 ms  |
| Hint on the hovered row              | 19–68 ms         | 29–122 ms     |
| Preview panel after the drop         | 11–95 ms         | 16–220 ms     |

The hint and panel times include Playwright's own pointer steps and the starved machine (load 50–65); neither waits on
the Host. At idle spawn costs, a cold prepare is one jj round (≈ 80–340 ms) and a warm one ≈ 10 ms; neither was
measured on an idle machine, and the live Host keeps the old path until a Host restart loads the new bundle.

## Pull-request watcher GitHub budget (2026-11-11)

`@dshfiles/pull-requests` read each watched pull request with its own `gh pr view`: one process and one GraphQL query
(1 point) per pull request per sweep. Backlog items can now own up to 300 watches, so a 10-minute sweep could spend
1,800 points an hour of the account's 5,000, shared with agents' own `gh` calls. It now reads fifty pull requests per
`gh api graphql` call, first with a fingerprint pass (state, `updatedAt`, mergeability, head commit, check counts) and a
full read only for those whose fingerprint changed, reads `rateLimit` in the same query and waits for `resetAt` below a
500-point floor (setting `githubPointsFloor`).

Unit probe `plugins/@dshfiles/pull-requests/tests/gh-call-budget.spec.ts` (real `GitHubCli`, monitor and JSON store; a
stub `gh` counting processes and charging GitHub's documented point formula). The same costs were charged live by
read-only `gh api graphql` queries against `cli/cli`: `gh pr view` one request; fifty aliases full 2 points (71 KB);
fifty aliases fingerprint 1 point (11 KB). Per hour assumes the default 10-minute sweep and no event refreshes.

| Watches | Before, per sweep      | After, first sweep  | After, quiet sweep | Per hour, before → after             |
| ------: | ---------------------- | ------------------- | ------------------ | ------------------------------------ |
|       5 | 5 spawns, 5 points     | 1 spawn, 1 point    | 1 spawn, 1 point   | 30 → 6 spawns, 30 → 6 points         |
|      50 | 50 spawns, 50 points   | 1 spawn, 2 points   | 1 spawn, 1 point   | 300 → 6 spawns, 300 → 6 points       |
|     300 | 300 spawns, 300 points | 6 spawns, 12 points | 6 spawns, 6 points | 1,800 → 36 spawns, 1,800 → 36 points |

The probe's two sweeps of 300 took 92 s before and 34 s after on this machine; most of the remainder is the JSON test
store's per-record writes, not `gh`. Not measured: the live Host (the change needs a Host restart) and event-refresh
volume, which costs the same per batch as a sweep.

## Attention store and live baseline (2026-11-11; investigation)

The live Host was not restarted or heap-censused. Load was 29.96 on 10 logical CPUs, so these are a congested-instance
baseline, not a controlled benchmark. The JSON attention unit was 313,423 bytes on disk.

| Probe                                        | Before                                                               | After        |
| -------------------------------------------- | -------------------------------------------------------------------- | ------------ |
| Host lag, 60 s (168 samples)                 | p50 72 ms; p90 613 ms; p99 2,447 ms; max 5,629 ms                    | Not measured |
| Five thread switches                         | Composer 317–506 ms; history 592–1,915 ms; 1–4 long tasks per switch | Not measured |
| Attention `changesSince`, 81 spans in 60 min | p50 0.315 ms; p95 1.125 ms                                           | Not measured |

A 60-second Host CPU profile reported 51.7 s busy and 22.9 s inclusive under agent-loop step. Machine contention and
inclusive samples preclude attributing this as the cause of a particular switch. The inspector was closed afterward.
The follow-up migration probe (a deleted final record re-imported from the retained legacy unit) is fixed in the
per-record backend and covered by its tests; the attention store now uses that layout, see below.

## Attention writes answer a delta, and the unit stores one record per thread (2026-11-11)

The v1 attention contract answered every write with the whole snapshot: at 2,000 unread threads that is a ~192 KB
answer for acknowledging one row, and the `thread_attention` unit rewrote its whole document (~313 KB on the live Host)
for the same change. Both are fixed without breaking an older Host or an older page.

Measured with a scratch script over the real JSON backend and the real Effect schemas (1,056 rows, Node 22, 5 writes
after warm-up; absolute times are disk-bound and machine-dependent, the ratio is the result):

| Measure                                      | Before                                    | After                                                             |
| -------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| Answer to one acknowledge, 1,056 unread rows | 192,407 B (full snapshot)                 | 291 B (`writeDelta`) — 661× smaller                               |
| One durable write over that unit, p50        | 22.93 ms (single document rewritten)      | 13.65 ms (one record document)                                    |
| Same, min/max                                | 11.46 / 33.86 ms                          | 6.17 / 31.03 ms                                                   |
| Host work per write                          | plan + rewrite whole unit, then read back | plan + write the changed records, delta computed in the same lock |

How it works:

- `thread_attention` declares `layout: 'per-record'`, so the storage backend writes one document per unread thread. The
  first open migrates the old whole-unit file, which is now crash-safe: the new tree is staged beside the unit, fsynced
  and published by one directory rename, its legacy global value and keys are validated first, and a marker document
  makes the tree authoritative so deleting the last record cannot re-import it later.
- The API keeps all six v1 write methods unchanged for older pages, and adds `writeDelta({ since, command })` plus a
  read-only `writeCapabilities` probe. A page probes once without writing; only a positive answer enables delta writes,
  and a failed delta write is never replayed through the v1 methods. The delta is computed from the committed state
  inside the same `SynchronizedRef` critical section as the durable write, so it names every change since the caller's
  revision, including concurrent finishes and drops.
- The page store serializes writes, merges a delta only when it still holds the revision that write was built on, and
  falls back to a full read when the answer is incomplete or the held revision moved. That fallback now queues a
  forced read instead of an ordinary one: the ordinary read reuses an in-flight request or honors the throttle, so a
  write that committed mid-refresh could leave the page on the pre-write revision until the next poll. An older Host,
  or a Host without the probe, keeps the v1 full-snapshot write path.
- Opening a unit that still has its legacy whole-unit file now adopts it eagerly, before any lazy read. A lazy domain
  only reads on demand, so the old path could boot an index from an unmigrated tree and, once its last record was
  deleted, re-import the retained legacy rows. `lazy-json-backend.test.ts` covers that delete-then-reopen shape and
  `lazy-reads.test.ts` covers the eager open, including the unsafe-key rejection it now surfaces at open.

Not measured: the live Host improvement. The change needs a Host restart to reach the running instance, and the delta
path needs a page reload; the numbers above are the mechanism's, not the GUI's.

## Memory re-digest skips unchanged threads (2026-11-11)

Live traces (30,000-span store, ~31 min retained at sampling) put `memory digest thread` at **27 spans, p50 3.57 s,
p95 20.67 s, max 21.95 s**, with 67 `memory jev ask` spans (p50 263 ms, p95 759 ms) in the same window. The digester read
the Session, asked Jev to classify up to 12 user messages and called the model _before_ reading its indexed cursor, so
every idle re-digest of an unchanged thread repeated the classifier and model calls.

The digest now reads `indexedThrough` before classifying and returns `unchanged` when the thread's last event is already
indexed and a stored digest exists. Verified by a new journey in `memory-services.test.ts`: the second digest of the
same thread leaves both the Jev-ask and the summarizer call counts unchanged.

| Measure                                          | Before                   | After                              |
| ------------------------------------------------ | ------------------------ | ---------------------------------- |
| Jev calls for a re-digest of an unchanged thread | up to 12 per attempt     | 0 (asserted)                       |
| Summarizer calls for that re-digest              | 1                        | 0 (asserted)                       |
| Live digest span duration                        | p50 3.57 s / p95 20.67 s | Not measured: needs a Host restart |

## Candidates measured and deliberately skipped (2026-11-11)

| Candidate                           | Current evidence                                                                                                                                                                                                                                          | Decision                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| P0-6 `preview/devServers` ×3        | 306 spans, p50 2.78 s, p95 11.67 s, 27 errors; three roots started within 0.334 ms but call arguments are not traced, so duplicate calls are unproven                                                                                                     | Keep open: a capture with a thread open and per-`QueryClient` count is needed before changing code      |
| P0-7 `jujutsu-composer/context` ×4  | 48 spans, p50 4.87 s, p95 24.50 s; one 22.6 s trace is dominated by inter-span waits, not jj alone                                                                                                                                                        | Keep open: needs a Workbench panel-visibility signal or an always-rendered ref target                   |
| P0-9 `backlog/list` 744 KB          | 0 `backlog/list` spans in the retained window; the panel still asks for `limit: 2000`                                                                                                                                                                     | Keep open: the fix is an API + product decision on paging                                               |
| P0-10 `settings/describe` 201 KB ×2 | Core `ui-settings` reads at apply and on the first reset; its row id is the settings namespace                                                                                                                                                            | Skipped: core, not an owned plugin (Host gaps 97/99)                                                    |
| C05 main-tabs subscriptions         | Source subscribes session/workspace/layout/adapter and recomputes before key dedupe; 0 of the 60 s CPU profile's samples name that render path, and the profile is 51.7 s busy with 22.9 s under agent-loop step, so this is unmeasured rather than cheap | Not optimized: needs a client CPU profile of a tab switch to price it                                   |
| C15 Memory read cards               | 3 notes / 34 digests when counted 2026-11-04; no current panel-render trace                                                                                                                                                                               | Skipped: no measured cost                                                                               |
| H12 usage chart projections         | 0 `usage charts read` spans in the retained window                                                                                                                                                                                                        | Skipped: no measured cost                                                                               |
| T02 remainder (slot registrations)  | Source calls `clientSlotRegistrations` twice per build; 0 slot measurements in the retained window, and the 471/72/401 → 147/49/104 ms receipt is a receipt build, not a slot query                                                                       | Not optimized: unmeasured, the double call is visible in source only                                    |
| T06 scratch preparation             | Serial builds identified; 0 stage spans in the retained window to attribute                                                                                                                                                                               | Not optimized: unmeasured, no stage spans to price                                                      |
| cordis-client-runner catalogs       | Entry `client.js` 331.7 KB; both generated catalogs parsed and evaluated at boot                                                                                                                                                                          | Done: catalogs load on first `cordis_inspect`; entry 38.9 KB (-88%), no catalog chunk requested at boot |

## Cordis inspect catalogs load on demand (2026-11-11)

The runner's generated Slot and API catalogs were 297 of its 332 KB Client entry and ran at boot; only a
`cordis_inspect` call reads them. `providers.ts` now reaches each through a literal `import()`, which our dshx fork emits
as a package-local lazy chunk fetched with `require.async` on the first query of that provider.

| Measure                     | Before                 | After                                                                       |
| --------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `dist/client.js`            | 331.7 KB               | 38.9 KB (-88 %)                                                             |
| Same, gzip                  | 55 KB                  | 11.7 KB                                                                     |
| Catalogs loaded at boot     | 297 KB (gzip 45 KB)    | none                                                                        |
| Entry evaluation at boot    | includes both catalogs | catalogs deferred                                                           |
| First inspect of a provider | 0                      | one chunk fetch (API 63.3 KB / 15.9 KB gzip, Slots 234.3 KB / 29.2 KB gzip) |
| Cold evaluation of both     | at boot                | deferred to the first inspect; not re-measured in a browser                 |

The boot page evaluates the entry only: it names no catalog chunk. Verified against the real loader, not a fixture:
a scratch DSH served `client.api-catalog.<hash>.js` and `client.slot-catalog.<hash>.js` at the exact
`/plugins/@dshfiles/cordis-client-runner/<chunk>?rev=<boot rev>` URL its `require.async` resolves to, 200 with the
chunk bytes and `text/javascript`. Node `node:vm` evaluation of the two chunks was 2.2 ms and 6.6 ms cold, but that
protocol differs from the browser's, so it is a floor, not the boot saving; no browser-side evaluation timing was taken.

DSH serves plugin resources as `public, max-age=31536000, immutable`, so a chunk name must change with its bytes. The
toolchain named chunks after the target's path, which would have frozen a rebuilt catalog in a warm browser; `dshx`
now hashes the target file's content (falling back to the path only when unreadable), and a rebuild of an unchanged
target keeps its name. `client-build.spec.ts` asserts both halves.

`native-fork.json` now lists `src/native/providers.ts` in the delta; `node scripts/native-fork-diff.mjs
cordis-client-runner` reports no undeclared change.

## Workbench main-seat baseline (2026-10-26)

Measured an existing live instance before builds or browser E2E load; no live restart or deployment. Its private profile name and endpoint are omitted.
The machine had 12 logical CPUs and load averages 7.00 / 8.35 / 8.87.

| Probe                                              | Before implementation deployment                                                                                         | After deployment                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Host RPC, 20 seconds / 39 samples                  | p50 86 ms; p90 1,596 ms; p99/max 5,555 ms                                                                                | Not measured: live Host remains unchanged                          |
| Host CPU, 20-second sample                         | 19,908 ms busy; inclusive subprocess-local querySystemctl/rangeActive 8,011 ms, spawn 6,099 ms, Jujutsu runJjAt 3,787 ms | Not measured                                                       |
| Two thread switches in a separate live browser tab | DOM 918 / 908; long tasks 160 / 120 ms; stabilization 312 / 343 ms (includes 150 ms quiet window)                        | Scratch acceptance is separate, not a comparable live after sample |

The pre-existing Host stalls exceed the 250 ms budget and must not be attributed to the new workbench. The CPU sample
is inclusive and concurrent agent subprocess traffic was present; it identifies an existing cost, not a benchmark of
the unreleased UI. A production before/after claim requires the user's restart and the same probes on that version.

Recovery read-only sample at 06:03 Europe/Paris, before this thread's build/browser load: 75 authenticated credentials
RPCs over 10 seconds, all HTTP 200, p50 7 ms and p99/max 315 ms. Two thread selections in an isolated live browser tab
showed the composer in 128 / 991 ms, DOM 1,132 / 1,173, and one 124 / 116 ms browser long task respectively. The first
selection completed six HTTP API reads; only the existing `dshx-bdd4a2d6/list` request exceeded the budget (338 ms).
The other selection used the existing Session connection, so its HTTP list is not a full transport-byte measurement.
Machine load was 20.96 / 20.53 / 16.22 on 12 logical CPUs. The live page was still native mode: this is refreshed
baseline evidence, **not** proof of an after-deployment workbench improvement or regression.

### Controlled scratch comparison after the preview-navigation fix

At `6b52aa5a`, the same two small real Sessions (one prompt and a credential-free failed turn each) were switched by
real sidebar input in both modes: two warmup switches and six measured switches per mode. The timestamp starts at
capture-click and ends at the first visible, correctly bound history plus editable composer frame, confirmed over two
frames. These are descriptive six-sample nearest-rank percentiles, **not** a live deployment or large-history SLO.

| Scratch mode | p50      | p95 / maximum | Median whole-document DOM | Over 250 ms |
| ------------ | -------- | ------------- | ------------------------- | ----------- |
| Native       | 111.9 ms | 118.1 ms      | 757                       | 0 / 6       |
| Workbench    | 32.8 ms  | 37.3 ms       | 901                       | 0 / 6       |

Per-thread median deltas were −80.7 / −76.0 ms. Native recorded four browser long tasks; Workbench recorded none.
Observed HTTP API requests had no failures, pending-at-ready requests or requests over 250 ms. WebSocket payloads and
live Host CPU/event-loop attribution are not measured by this comparison; the deployment-after cells above remain
unverified. The setup also freshly proves that Plugins stays selected after replacing the second thread preview.

[Full redacted measurements](../plugins/@dshfiles/workbench/docs/evidence/workbench-switch-performance-2026-10-26.json). Reproduce with the pinned raw-core and
system-Chromium overrides from `verify-dsh`, built artifacts, `DSHX_E2E_PREWARM=0`, and Playwright's
`workbench-performance.feature.spec.js` target. Full run receipt:
`.dsh-e2e-evidence/1793034685726-c9d93c3c-9cb3-430b-8010-50178a2a3899/manifest.json`.

The final source was measured again at `4a1f4c76`: Native p50 **115.3 ms**, p95/max **123.5 ms**; Workbench p50
**33.2 ms**, p95/max **36.8 ms**. Both modes retained the same 757/901 median DOM counts. All twelve interactions and
observed HTTP API requests stayed below 250 ms. [Repeated redacted measurements](../plugins/@dshfiles/workbench/docs/evidence/workbench-switch-performance-2026-10-26-final.json).
This confirms the controlled result, not a production or large-history after-deployment claim.

## Scratch switch audit (2026-11-04)

No live DSH process at `127.0.0.1:3080` was restarted or load-tested. The isolated `strobe-bench` profile passed `dshx dev doctor` with 226 active entries and all 75 bundles loaded. The corrected `workspace-nav/new-thread-composer` reach now clicks `New thread` and verifies `Send message` plus the seeded sample (91 / 22 / 14 ms).

Strobe did not produce benchmark results: `strobe bench --check` failed 0/4 cases before their hooks because `overCDP` timed out after 30 s connecting to fresh Chromium on macOS. Treat its timing as unproven; the fallback probes below are separate evidence.

Host attribution stayed below the 250 ms budget: a 15 s `host-lag` probe reported p50 4 ms, p90 7 ms, p99 43 ms, max 67 ms and no stalls above 250 ms. Two 10 s Host CPU captures during switches found only 8–9 ms busy with no DSH/dshfiles frames. No Host gap was evidenced. Machine load immediately before the final browser profile was 9.09 / 9.13 / 9.68 on the 10-core Mac; treat these timings as descriptive, not a performance SLO.

| Scratch interaction                   | Before                                                                                                 | After                                                                                                                                             | Interpretation                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual-unread unfinished-draft switch | 3 requests: 2 `dshx-2113d713/clearUnread` + `session/page`                                             | 2 requests: 1 `clearUnread` + `session/page`                                                                                                      | Reproduced and fixed one redundant `@dshfiles/thread-sidebar` write; selection effect owns cross-Session clearing, direct clearing remains for reselecting the active Session.                      |
| Short completed-thread switch         | 28 requests, 18 KB WebSocket; one sample 192/195 ms composer/history, another 501/507 ms at load 12.75 | Not an apples-to-apples timing comparison; after a rebuild, a different finished-attention state emitted one `acknowledge` and one `clearUnread`. | Keep counts separate from variable timings and attention state.                                                                                                                                     |
| CDP browser CPU profile               | —                                                                                                      | 245 ms + 53 ms long tasks; top plugin-script sample 152 ms at `qV` in the `/plugins/` response                                                    | The response aggregates all 75 client bundles and exposes no useful per-plugin source map; this profile cannot safely assign the long task to one plugin. No CPU optimization was inferred from it. |

The request-channel owners observed in the switch probe were `thread-sidebar` (`2113d713`), `ai-accounts` (`2c5a0dae`, `21995261`, `b3419035`), `preview` (`16a2d652`), `multi-host` (`9ca8a5fa`), `jj-integration` (`e1cc781b`), `session-undo` (`69ad52d4`), `session-controller` (`70188033`), and `annotations` (`624001b6`). `dshx-99e8ae68/status` was not mapped; native routes also included `agentPresets/list`, `credentials/describe`, `llm/*`, `schedule/list` and `session/modelCatalog`. These are owners present in the trace, not claims that each endpoint is redundant.

Verified: `dshx dev open workspace-nav/new-thread-composer` reached the corrected action; a scratch UI probe reduced the exact manual-unread draft flow from 3 requests / 2 clears to 2 / 1; focused selection test, plugin typecheck, build and Host import passed. Unverified: Strobe timing (macOS CDP timeout), isolated source attribution within the `/plugins/` aggregator, and an apples-to-apples timing improvement for the normal completed-thread switch. `features:check` still reports 12 unrelated pre-existing `workspace-folder-picker` coverage issues.

## Why earlier attempts stalled

Several audits planned from source reading, request logs and small scratch fixtures, then proposed new helper
plugins or concluded that the fix needed a DSH core patch. Neither was right. The costs below only showed up when the
live GUI was measured per interaction (DOM size, long tasks, bytes per click, a CPU profile of the running Host), and
the biggest one lived in a native client package, where the fix is a fork of its Loader row, a route this
repository already used for the composer.

## Findings (live profile, October 2026)

| Cost                                                                                    | Evidence                                                                                                                                                                       | Fix                                                                                                                                                                                                           | Owner                                     |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Host event loop blocked up to 6 s; every request queued behind it                       | `host-lag` max 5.96 s; CPU profile: 7.4 s/min in `settings.describe()` reached from dshx `SettingsScope.get()` per Session event ([profile](host-stall-profile-2026-10-19.md)) | settings read cached on the Loader entry's fiber, `fiber.config` and `options.config` identities                                                                                                              | dshx                                      |
| Thread open mounted 1.9k–42k DOM nodes, 0.4–14 s to history                             | DOM per row: collapsed historical Turn groups (17 px) held 1k–7k nodes each, kept mounted and hidden for browser find                                                          | `@dshfiles/chat` forks the native Chat row: newest 24 rows mounted, older ones as the reader scrolls up, collapsed groups mount on first open                                                                 | chat                                      |
| Each switch fired 10–20 requests, several over 250 ms                                   | request list per click                                                                                                                                                         | `@` skill and MCP sources read on first `@` query (no `warm`); MCP quick panel reads `list` with a stale time instead of `refresh` (which reconciles every MCP client); prompt-stash snapshots stale for 30 s | thread-sidebar, mcp-servers, prompt-stash |
| New thread's first prompt lost when another New thread opened before isolation finished | 4/4 prompts lost on a scratch Host                                                                                                                                             | first send isolates on its own: provision, `connectWorkspace`, copy draft/attachments/references into that Session, send there                                                                                | jj-integration                            |
| Opening window of 26 MB on Anthropic threads                                            | `snapshot-bytes`: `replayState.blocks` (thinking signatures) sent twice per assistant message, 17 of 26 MB                                                                     | `@dshfiles/session-controller` forks the native Session controller row: the browser copy drops replay blocks, and threads open on the latest Turn (20–120 messages)                                           | session-controller                        |
| `session/list` re-read every cold Session log                                           | Host CPU profile: `summarizeCold → readZstdPrefix`, 1.4 s per minute of switching                                                                                              | cold projection columns kept until the Session attaches, appends or detaches                                                                                                                                  | session-controller                        |
| jj reads 80–340 ms each, up to 875 ms per composer `context` and 815 ms per `threadAt`  | the store has 52 workspaces; every jj spawn loads the repository view                                                                                                          | `--ignore-working-copy` reads reused until the store's `op_heads` change                                                                                                                                      | jujutsu, jj-integration                   |
| Rebase idle guard folded all ~800 stored Sessions before checking one workspace         | ~18 s cold `sessionController.list()` fold; unrelated Sessions do not affect the decision                                                                                      | Guard reads live Agent status and projections only for that workspace's Session ids (typically 1–3); bulk reads remain for views and repository-wide cleanup. Post-change Host latency is not yet measured.   | jj-integration                            |
| "Load earlier" had to be clicked                                                        | —                                                                                                                                                                              | older rows and pages load as the reader scrolls up; an open widens itself at most three steps                                                                                                                 | chat                                      |

Before and after on the same 10 threads (live, `switch-probe.mjs`):

| Per click                | Before              | After                                                                |
| ------------------------ | ------------------- | -------------------------------------------------------------------- |
| DOM nodes                | 1.9k–42k            | 1.9k–3.0k                                                            |
| Long tasks (total / max) | up to 2.3 s / 1.6 s | up to 1.5 s / 0.9 s; most clicks under 0.5 s                         |
| Requests fired           | 18–36               | 9–14                                                                 |
| History visible          | 0.4–2.7 s, one 14 s | 0.3–1.3 s for threads under 5 MB; 3.3 s at 5.4 MB and 6.2 s at 26 MB |
| Host lag p99 (60 s)      | 522 ms              | 126 ms                                                               |

The slow remainder tracked the bytes of the opening window, not rendering. After the Session controller fork and
the jj caches (live, same probe, 2026-10-20 02:00–03:00):

| Per click                       | After the first round                       | Now                                                                            |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| Opening `session/follow` frame  | 1.8 MB / 26.3 MB on the two sampled threads | 0.97 MB / 2.4 MB                                                               |
| History visible                 | 0.3–1.4 s; 6.2 s at 26 MB                   | 0.3–0.6 s; the 26 MB thread 0.5 s warm, 1.4–1.7 s on a Host's first open of it |
| Composer `context` / `threadAt` | up to 875 ms / 815 ms                       | ≤ 277 ms / ≤ 138 ms                                                            |
| Host lag p99 (70 s)             | 126 ms                                      | 75 ms                                                                          |

## Startup HAR and page-load profile (2026-11-04)

A HAR taken 37 s after a Host start showed a ~2.4 s window with no span at page load, a 13.9 s `editTimes`, and a
thread that failed to open ("All fibers interrupted"). On a warm Host a scripted page load stalls ~0.65 s; a CPU profile
of the live Host during that load (20 s, 5.8 s busy) names the owners below.

| Cost                                                     | Evidence                                                                                                                | Fix                                                                                       | Owner              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------ |
| Page load blocks the Host on `pluginManager/listBundles` | ~1.0 s of synchronous `readFileSync`/`readdirSync` in core `readPluginMeta` per call; 185 KB response; called each load | labels cached on the Host per set of Loader rows, served by `settings-shell/bundleLabels` | settings-shell     |
| Alert evaluation every minute                            | `alert engine evaluate` p50 532 ms, p95 5.3 s; each rule read walked all 100k spans (135–236 ms sync SQLite)            | `spans_end` index: 24–46 ms per rule on a copy of the live store                          | traces             |
| `editTimes` for a 100-revision page                      | one `jj evolog` per commit: 13.9 s in the HAR, 31 s sequential                                                          | one batched `evolog`, walked per commit: 2.3 s with identical results                     | jujutsu            |
| Cold local thread opens asked every remote host          | multi-host `owns` ran `session/list` over SSH per runtime before the history read                                       | ids from this Host's own list answer locally                                              | session-controller |
| Thread open failed with "All fibers interrupted"         | concurrent `owns` joined the fiber `FiberMap.run(onlyIfMissing)` interrupts                                             | join the running discovery                                                                | multi-host         |
| Session log lookups                                      | core `findLog` scans all 726 project directories per lookup; one tail read spent 4.4 s in `stat`, 18 ms reading         | open                                                                                      | core (Host gap)    |

After, on a scratch DSH with every owned bundle (`dshx dev up`, 79 bundles, 342 Loader rows; machine load ~24 on 10
cores), ten alternating calls of each on the same Host, with a cheap RPC pinging alongside:

| Call                                | p50 / max        | Ping stall while it runs (p50) | Bytes  |
| ----------------------------------- | ---------------- | ------------------------------ | ------ |
| `pluginManager/listBundles` (old)   | 1,019 / 3,073 ms | 1,012 ms                       | 182 KB |
| `settings-shell/bundleLabels` (new) | 38 / 609 ms      | 27 ms                          | 153 KB |

Each page load now sends one `bundleLabels` and no `listBundles`. Whole page loads on that machine stayed noisy
(slowest early request 0.6–2.0 s, led by core `settings/describe`, `credentials/describe` and
`dynamicCordisRunner/*`), so the per-call comparison is the evidence. The scratch trace store was migrated with
`spans_end` on boot.

### Steady Host costs from the same profile

**hmr-gate bundle watch.** The profile showed hmr-gate `statSync`-ing every client bundle every 500 ms (232 ms per
20 s). It now watches bundle directories and their package directories with `fs.watch` and reads only the bundles an
event names with async `stat`, plus a 10 s safety re-read ([bundle-watcher.ts](../plugins/@dshfiles/hmr-gate/src/host/bundle-watcher.ts)).
Scratch benchmark, not the live Host (Node 22.23.3, 170 bundle files in temp directories, 20 s idle after a 1 s
settle, two runs each):

| Mode                   | Bundle reads | Sync main-thread `stat` | Process CPU |
| ---------------------- | ------------ | ----------------------- | ----------- |
| No watcher (baseline)  | 0            | 0 ms                    | 37–51 ms    |
| Old: 500 ms `statSync` | 6,800        | 53–56 ms                | 121–123 ms  |
| New: `fs.watch` + 10 s | 340 (async)  | 0 ms                    | 67–95 ms    |

A live 20 s Host profile after deployment is still pending; the Host half changes, so it needs a user-approved restart.

**Telemetry export attributed to shared-streams.** shared-streams' Host code only registers a worker route and an
index tap. Every owned Host bundle embeds the dshx runtime, and the process-wide tracer
(`Symbol.for('@dshfiles/dshx.tracing.v3')`) is installed by whichever bundle loads first, so the profile names that
bundle's file. The ~260 ms per 20 s is the dshx OTLP batch exporter
([otlp-exporter.ts](../tooling/dshx/packages/dshx/src/tracing/otlp-exporter.ts)) JSON-encoding spans and POSTing them,
by default to this process's own traces receiver. The owner is dshx tracing, not shared-streams.

The traces receiver now publishes an in-process handoff with its endpoint (`deliverTraces`): the dshx span exporter
passes each encoded batch as an object, so the Host's own spans skip `JSON.stringify`, the loopback HTTP request and
the receiver's `JSON.parse` ([host-edges.ts](../plugins/@dshfiles/traces/src/host-edges.ts)). The receiver still
decodes the object with its OTLP schema, counts it as a `/v1/traces` request and serializes it only when a forward URL
is set. Scratch benchmark, not the live Host (Node 22.23.3, load ~30 on 10 cores, 2,000 eight-attribute spans in four
512-span batches, receiver decode excluded on both sides, five rounds):

| Path                                 | Wall per 2,000 spans | Process CPU |
| ------------------------------------ | -------------------- | ----------- |
| Old: JSON POST to the local receiver | 14–69 ms             | 13–81 ms    |
| New: in-process `deliverTraces`      | 2–12 ms              | 2–19 ms     |

A live 20 s Host profile of both halves is still pending: every owned Host bundle embeds dshx, so it needs the
rebuilt bundles and a user-approved restart.

## Thread-content search (palette `#…`)

One search took 21 s to 1.4 min and stalled every other request (`modelCatalog`, `credentials/describe`, `state`,
`pending` at 1.3–4.8 s together). Measured per phase on a clone of `~/.dsh`, then on live:

| Cost                                                                                                                                        | Evidence                                                     | Fix                                                                                                                                    | Owner                  |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Each memory message hit decoded its thread's whole Session log to read one message (up to 40 per search, 4-entry cache)                     | finder phases: memory 10–12 s, `store.search` 93 ms          | 2 000-character excerpt per indexed message; the palette finder never reads logs                                                       | memory                 |
| Every search re-read 944 log headers and folded 80 titles by decoding whole logs                                                            | records 4.6 s cold                                           | titles from the Session list's cached projections, list kept until a Session is created or disposed, core title folds kept per Session | memory, session-search |
| Worker ingest re-read each changed log whole (up to 69 MB) per pass, and a line split across frames pinned four active logs (69 MB) forever | worker health `behindBytes` constant; cursors never advanced | positional 2 MB windows, frames of a split line joined, yields between sessions                                                        | session-search         |
| The search query scored, measured and built `snippet()` for every match (~100 000 for a common term)                                        | 8.4 s for `plugin` on the live index                         | rank first through FTS5's ordered `rank` scan (best 2 000), snippets for returned rows only                                            | session-search         |
| The conversation filter read every matched document's row from a 1.1 GB index while the file cache is evicted (24 GB, ~100 MB free)         | cold `plugin` 2.9 s with filters, 1.2 s without              | `conversation_documents` FTS table for the 90 000 user/assistant messages both callers search                                          | session-search         |

Result on live (2026-10-20, after the session-search and memory fixes, within one loaded page): the finder answers in
12–54 ms and the worker's own search in 8–33 ms; a palette search shows results in 0.3–0.9 s including typing and the
200 ms debounce. A replaced session no longer scans the index (slowest ingest pass after a restart 1.9 s, was 14.7 s).

### Thread search follow-up (2026-10-30)

The live palette reproduced an 11.5 s `findThreads` request (HTTP 200, 12 results); its server span was 10,086 ms,
with only a 673 ms SSH child span. A direct memory search for the same term took 137 ms and the session-content worker
reported 2 ms. The live corpus held 2,244 Sessions, 1,629 digests and 24,538 indexed messages. The unexplained parent
wait is around the record preparation, not the search engines.

Host-lag measurements were not simultaneous with that request: one separate probe recorded p99/max 101 ms with no
stalls above 250 ms; a later 10 s probe at 23:07 recorded p99/max 562 ms and two >250 ms stalls at load average 12.34.
Neither proves or excludes Host scheduling delay during the 22:29 search.

`memory` called `sessionController.list({})` with a 10 s timeout to obtain titles, then read only the `title` projection.
Omitting `projections` makes the Session-list service read every registered projection, so the caller now requests only
`title` via `sessionTitleListRequest`. A second trace showed a superseded `findThreads` request aborted after 6,173 ms;
previously the title-list call had its own independent 10 s timeout. The current code forwards the API cancellation signal
to that list request and no longer swallows cancellation.

The current `SessionListRequest` has no session-id filter or page size, and `ApiSessionList.list` still traverses and
sorts the full corpus. The title allowlist reduces projection work per row, not the number of rows. A targeted
`readTitleSnapshots` alternative is not automatically faster: a cold read of 57 titles took 3.1 s. If the live probe
remains slow after deployment, use its trace to choose the next optimization rather than infer from a scratch corpus.

| Live `findThreads` probe | Before                                                     | After                                                            |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Server span              | 10,086 ms                                                  | Not measured: the live Host still serves its old bundle.         |
| Superseded request       | Aborted at 6,173 ms; title read had an independent timeout | Cancellation now reaches the title read; live effect unmeasured. |

The remaining validation is the same live search after integration and a user-initiated Host restart; neither was
performed here.

### Live recheck (2026-10-31; before deployment)

On the current Host (PID 61372), a real palette content query returned its first result in 9.53 s (12 results). The
`@dshfiles/memory/findThreads` span lasted 8.885 s; its only child was an SSH command lasting 636 ms. The remaining
8.25 s has no phase-level spans, so this still identifies the slow work unit but not its internal cost. The pending
CPU-profile permission and deployment decision remain necessary before a live after-measurement.

A separate 60 s Host-lag probe reported p99 25 ms, max 483 ms, and one stall above 250 ms. It was not simultaneous
with the search, so it neither attributes nor rules out Host scheduling delay during the 9.53 s interaction. This is
still a pre-deployment baseline, not evidence about the current JJ changes.

The current workspace now adds count-only spans for caller-project resolution, finder record preparation, session
listing, title reads, per-session project resolution (including the number of distinct non-empty working directories),
content search, and memory search. They add no query text, session IDs, or paths and are covered by a `recordSpans()` test. This is diagnostic instrumentation, not a latency fix; the new spans will appear only after the
Host change is integrated and the user restarts the live process.

## First open of a thread (2026-10-20)

Opening a cold thread used to resume its Agent right after the snapshot went out: agent restore, `dsh-context` and
the projection cells (`materializeCells`) held the Host's main thread for about 1.2 s, and the browser's first frames
waited behind it. `@dshfiles/session-controller` now leaves the Agent cold on open (a log that stops inside a turn
still resumes, so its crash closers land), and `@dshfiles/rich-composer` resumes it on the first draft edit through
its `agent-warmup` API, while the person types. Cold Host, same probe: the 358 KB thread 2.1 s → 0.76 s to history,
the 69 MB thread 2.1–3.4 s → 1.5 s; a warmup call answers in about 0.2 s.

The opening then stopped decoding the whole log. The JSONL backend writes one independently decodable zstd frame per
append, so `follow` decodes only the newest frames (further back until the opening window settles) and folds the
cached projection checkpoint over that tail with `sessionProjections.restore`. Live, forked, subagent, torn, migrating
and mid-turn logs keep the full read. On a clone of the live Host, 52 of 52 openings were identical to the full read
(cursor, `hasMore`, every record, every projection). Live, cold: the 69 MB thread 1.5 s → 0.54 s to history.

## Slow New thread under machine load (2026-10-21)

`session/create` took 6.5 s, `threadAt` 3.6 s and `page` 2.9 s in one click. No revision on `main` touched the path
in a way that explains it: the only change on it (the free-name check before a thread workspace is provisioned) adds
one `jj workspace list`, 80–200 ms. The machine was the cause: load 54–82 on 10 cores from three `dshx dev up`
instances nobody stopped (each a Host, a browser host and headless Chromium) plus three e2e runs. The live Host sat at
80–97 % CPU with event-loop stalls up to 1.8 s (p50 97 ms, p90 371 ms). Its own top costs were spawning child
processes (agents' bash calls and the `jujutsu` per-workspace `jj log` fan-out over 45 thread workspaces, 1.7–2.7 s
per 20–30 s) and session-log probes. The response is automatic: leaked scratch instances stop after an idle lease
(dshx), and idle thread workspaces are cleaned up on a schedule (`@dshfiles/jj-integration`).

### The session list that "took 150 s"

The same day, a read-only `dshx sessions list --json` on the live Host measured 150 493 ms and 241 937 ms, which made
every thread workspace read as `activity-unknown` and stopped the automatic cleanup from removing anything. It was the
same machine, not the code: the identical call is **0.56–0.79 s** on the rebooted Host at load 8–12, and the cleanup
preview then resolved every Session (`Skipped 43: 35 too-recent, 4 has-work, 4 busy` — no `activity-unknown`), because
it reads activity in-process with no 3.7 MB payload behind it. A 190x swing follows the load, not the code.

The payload was worth fixing: 1140 Sessions, 3.7 MB compact (7.3 MB pretty), of which 3.4 MB is projections no
list consumer needs to fold for every row — `aiAccountsCost` 1.0 MB, `turnOutline` 666 KB, `imageLimits` 224 KB,
`modelSelection` 145 KB, `sessionStats` 131 KB.

### Projection selector for the Session list (2026-10-21)

`SessionListRequest` now carries an optional `projections` allowlist
([`@dshfiles/session-controller`](../plugins/@dshfiles/session-controller)). Omitted reads every registered column,
exactly as before; an empty array asks for no projection block; unknown keys are ignored deliberately, so a client can
ask a newer Host for a key an older Host does not project. The Host passes the selector into
`sessionProjections.cachedSnapshot` / `sessionProjectionCache.cachedSnapshot`, which view only the selected rows, so an
unasked column is never decoded or put in the response. `sessionListMetadata` is still read internally for `blank` and
`updatedAt`, and a filtered cold read is never memoized in `coldProjections` (only a full read is), so it cannot poison
a later full read.

Callers ask for what they consume: jj-integration's activity fold requests `title` and `userQuestions`; `dshx sessions
list` requests no projection columns (its `sessions digest` and search still use the full list); the client catalog
requests eight columns it reads from list rows — `title`, `sessionListMetadata`, `turnOutline`, `userQuestions`,
`subagentTiming`, `threadSidebarModelRoute`, `subagent`, `tokenUsage` (the sidebar lineage and the jj panel read the
last six) — and leaves the rest to the opened Session's baseline. That client set is still broad, and `turnOutline`
remains its largest cost.

Measured on the same 1184-Session corpus, compact JSON of the response value unless stated. The old Host is the live
`:3080`; the fork ran on a scratch `:3199` Host cloned from the same `~/.dsh`. The machine was starved throughout
(`uptime` load average 38–68 on 10 cores, from Chrome, VisualJJ and other agents), so wall times are inflated; the
payload numbers are the meaningful comparison.

| Read (1184 Sessions)                               | Before (live, load 38.17) | After (fork, load 38–42)                  |
| -------------------------------------------------- | ------------------------- | ----------------------------------------- |
| `dshx sessions list --json`, pretty                | 7.80 s, 7 567 023 B       | 12.05 s, 386 975 B                        |
| same, compact                                      | 3 895 882 B               | 279 447 B                                 |
| full list, selector omitted (the remaining cost)   | 3 895 882 B               | 3 902 067 B compact, 33.08 s (load 38.50) |
| selector `[]` (dshx)                               | full list                 | 289 415 B compact, 3.39 s                 |
| selector `['title','userQuestions']` (jj activity) | full list                 | 482 848 B compact, 2.81 s                 |
| client catalog's eight columns                     | full list                 | 1 551 500 B compact, 6.74 s               |

The command's payload dropped 92.8% compact (94.9% pretty). The remaining 279 KB is ids, times, flags and `cwd` for
1184 rows; the client still pays 1.55 MB because `turnOutline` (666 KB), `userQuestions` (62 KB) and `tokenUsage`
(106 KB) are rendered per row in the sidebar, and jj-integration pays 483 KB for `userQuestions`. Removing those needs
the sidebar to compute per-row facts from a narrower field, not another list algorithm.

**`turnOutline` replaced by a count (2026-11-10).** Measured per projection on 2026-11-04 from the live projection
cache (read-only, 158 Sessions), the eight columns totalled 172.5 KB: `turnOutline` 78.6 KB (45.5 %), `tokenUsage`
36.9 KB (21.4 %), `userQuestions` 17.1 KB (9.9 %), each of the other five 2.8–5.6 %. Its only list-side reader was the
jj-integration panel, which needs the number of prompted turns per thread (163 B for the whole corpus). jj-integration
now registers a `promptedTurnCount` projection, counted the way `turnOutline` marks a prompted turn, and the
session-controller fork lists it in place of `turnOutline` (about −78 KB, 45 % of the listed projection bytes on that
corpus). An opened thread still gets `turnOutline` from its own baseline. Checked by
`plugins/@dshfiles/jj-integration/src/prompted-turn-count.test.ts` (count equals the outline's prompted entries) and
`plugins/@dshfiles/session-controller/tests/client/session-state-eviction.test.ts` (the list asks for the count, not the
outline). A live list payload after deployment is not yet measured.

## First send no longer waits for its thread workspace (2026-10-22)

A New thread's first Send used to sit through the whole chain before the prompt moved: the `destination` jj read, the
workspace `provision` (claim a prewarmed spare: `jj new` under the repo lock, a registry write and a second destination
read) and `connectWorkspace` (`session/create`). Measured on 2026-10-19 on this Host: `POST /api/session/create` alone
was **1.7 s quiet, 6.1 s with `session/list` in flight, 9.5 s worst**, and on 2026-10-22 at load 59 (`uptime`) the Host
stalled at p99 **1.39 s**, max **3.05 s** (`host-lag.mjs`, 30 s), so each awaited RPC absorbs a stall. The composer
stayed blocked on "Preparing thread-…" for the sum of them; the user's report is that it "waits X seconds doing nothing".

The work now starts while the draft is written instead of on Send:

- `jj-integration` prepares the destination once the New thread composer holds text or attachments: the same
  `destination`/`provision`/`connectWorkspace` chain, run against the pending move, with its blank Session retained. The
  first Send takes the prepared destination and Session, copies the draft/attachments/references and submits — no
  provisioning or Session creation on the send path. A send that arrives before the preparation finishes awaits the
  same promises instead of starting them twice; a failed preparation falls back to the old path.
- An abandoned or re-targeted draft keeps the claimed workspace as this project's spare (`findSpare`), so the next New
  thread reuses it instead of provisioning another; a warm expires after 45 s and becomes a spare too.
- The created thread takes the view only while the New thread screen it left is still the visible main view: its own
  blank Session, no main `panelId` (the jj panel, Settings) and its conversation screen actually visible (the Start page
  hides the main outlet rather than unmounting it). Otherwise the send still lands and a toast offers the thread. A
  journey can't race that reliably under load, so `mainViewWaitsOnNewThread` is covered by unit tests
  (`thread-warmup.test.ts`) instead.
- `main-tabs` cancels a pending main-view navigation when the Start page opens (`tab.new`, ⌘T / the "+" button), so a
  New thread created earlier cannot replace the page the user chose.

Verification: `jj-integration.new-thread-preparation-browser-journey` (no workspace for an untouched New thread; the
draft claims one; a reload keeps it; the send runs in that prepared workspace instead of provisioning another) plus the
existing deferred-submit journey. Wall-clock before/after on the live Host is not in this table yet: the change only
reaches `:3080` after the profile restarts, and the probe cannot create threads on the user's Host, so the evidence here
is the removed awaits (three RPC chains off the send path) and the journeys, not a re-measured send latency.

## A New thread's click opens the composer before `session/create` (2026-10-22)

The first-send work above left the click itself blocking: `UiWorkspace.startSession` awaited `connectBlank` →
`sessions.create` (`session/create`, the same 1.7 s quiet / 9.5 s loaded RPC) before `replaceMain` revealed the
composer, so the New thread button did nothing visible for the whole round trip, and text typed in that window landed
in the previous Session's draft.

[`@dshfiles/workspace-nav`](../plugins/@dshfiles/workspace-nav) is the owned fork of
`@deepseek-ai/dsh-client-ui-workspace` that removes the wait at its owner (the native package's `connecting` and
`mainReference` state is private, so no slot could reach it):

- `startSession`/`openWorkspace` ask `ctx.sessions.createOptimistic` for the identity: the
  [`@dshfiles/session-controller`](../plugins/@dshfiles/session-controller) fork records a provisional blank list row
  synchronously, then sends `session/create` in the background and keeps the row alive across a list pull.
- `replaceMain` runs at the click: the composer binds to the provisional Session, `beforeOpen` moves the draft and
  references, and the saved selection records it. The hero renders from the provisional row's `blank` flag
  (`rich-composer`'s `ConversationMainPanel` gate), so it no longer waits for a Session row at all.
- The Session's history opening and its Session RPCs (prompt, queue, cancel, rename, attachment read) wait for the
  creation to settle, because the Host refuses a Session it has not created yet. A refused creation removes the
  provisional row, shows the create-failed notice and returns the view; a Host that declines a blank reuse returns
  another identity and the view follows it.
- `connectWorkspace` stays waiting on purpose: jj-integration's thread warmup resolves a thread workspace's blank
  Session before sending into it.

Every entry point goes through that one service, so the sidebar `+`, the main-tabs `+`, the command palette, ⌘N
(`session.new`), the hero project picker and the schedule dialog all open their composer at the click.

Verification: `tests/new-thread-request.test.ts` (the reuse and fresh-Session choice), the session-controller suite,
`node scripts/native-fork-diff.mjs workspace-nav session-controller`, and a scratch DSH
(`dshx dev up --plugin @dshfiles/workspace-nav --plugin @dshfiles/session-controller --plugin @dshfiles/rich-composer`)
where `dshx dev open workspace-nav/new-thread-composer` clicks New session, finds the composer and the project chip with
zero console errors, and the Host creates the Session afterwards. Wall clock on the live Host is not in this table yet:
the change only reaches `:3080` after the profile restarts, so the click-to-composer number is still the RPC's 1.7–9.5 s
budget removed from the click path, not a re-measured latency.

## E2E HTTP cache cost (2026-10-23; scratch, not live GUI)

Playwright 1.56.1 / Chromium 141.0.7390.37 disables HTTP cache whenever HTTP
routing is enabled. The shared E2E origin guard intentionally retains routing.
No product optimization or isolation change was made.

The controlled local fixture (`pnpm --dir tooling/dshx run benchmark:browser-cache`)
loads 12 cacheable scripts three times in each fresh context:

| Context                       | First load asset hits / transfer bytes | Repeated load asset hits / transfer bytes |
| ----------------------------- | -------------------------------------- | ----------------------------------------- |
| Route-free controlled fixture | 12 / 101,904                           | 0 / 0                                     |
| Exact-origin route guard      | 12 / 101,904                           | 12 / 101,904                              |
| Unrelated API route           | 12 / 101,904                           | 12 / 101,904                              |

A separate scratch sample booted `home` + `multi-host` using `dshx dev up
--plugin @dshfiles/home --plugin @dshfiles/multi-host --skip-build`, with its own
state root, home and port. Four root navigations retained an exact-origin HTTP
guard throughout. The page's Navigation Timing load duration was 1,272 ms on
first visit and 352.2 / 564.1 / 441.4 ms on repeats. Each visit made one expected
document navigation and zero unexpected reloads. Every sample recorded at least
2 script-initiated assets (335,118 transfer bytes), 2 CSS URLs (27,473 bytes),
and no font URLs. Total resource entries were 34 / 35 / 35 / 35.

These asset counts are **lower bounds**: the sample classified JavaScript by
script initiator and omitted fetch-loaded plugin bundles. These are not whole-app
byte totals, suite-wide savings, or warm-cache timings. The machine had 10 logical
CPUs and load rose from 9.93 to 20.71. A network-idle wait timed out at 15 seconds
because DSH keeps making requests; that wall duration is not readiness latency.
Use explicit client readiness for future samples, classify fetched bundles by
URL/content type, and collect representative journey reload counts before
estimating suite savings. Scratch doctor passed; all fixture-owned processes
were stopped. Token-free raw sample and measurement script were retained under
`/private/tmp/dsh-nav-measure.dU0QZm/` (temporary local evidence only).

## Chat inline integration offer (2026-10-24)

The chat turn-tail and header control each read `threadAt` for the same open Session, but used different query keys (chat: repository path + Session id; header: repository path only). The chat could therefore miss the header's already-refreshed status and wait for a second Host read after a Turn ended. Both controls now share the Session-scoped key and request the same viewer-scoped status; path-only invalidations still refresh the panel and all Session views. Different Sessions remain isolated.

Evidence: the live `:3080` Host probe (10 s, before the fix) measured p50 4 ms, p90 20 ms, p99 1,136 ms, max 1,136 ms, with one >250 ms stall; machine load was 25–31. This confirms Host stalls can magnify an unnecessary extra read, not that they explain all user-visible delay. The live page had no selected thread or integration offer, so no honest click-to-offer before/after timing was available. In the scratch E2E run, `jj-integration.turn-end-integrate-browser-journey` passed (1.7 min total journey); no comparable pre-change run was taken. `thread-query-keys.test.ts` verifies shared Session keys, per-Session isolation, and path-prefix invalidation. Do not treat the E2E wall time or Host-lag sample as a measured latency improvement.

## Browser interaction traces

`thread switch`, `new thread`, `panel open` and `composer send` are root spans of service `dshfiles-web` (see
[observability](observability.md#browser-interactions-dshfiles-web)). They do not replace the probes: `switch-probe.mjs`
still owns DOM size, bytes and request counts. What they add is attribution per click, kept in the Traces panel:

| Read in the trace                                                           | Classifies the cost as                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| a Host `<api id>/<method>` server span (or its `jj` child) ≫ 250 ms         | Host work or Host stall (confirm with `host-lag.mjs`)                |
| browser `client` span ≫ its server child                                    | browser queue or transport (requests waiting for a connection)       |
| `longtask` events, `dshx.interaction.long_task_ms` near the span's duration | rendering on the main thread                                         |
| a long interaction with no slow child and no long task                      | a native request (`session/follow`, `session/create`): no Host child |

Find them with `traces_search` (`service: "dshfiles-web"`, `operation: "thread switch"`, `minDurationMs: 250`) or the
Traces panel's service filter; `traces_list_services` gives p50/p95/p99 per interaction, which is the before/after
number to keep in this file once a Host restart has loaded the forwarding route. An outcome of `timeout` (10 s) or
`superseded` is not a duration: filter on `dshx.interaction.outcome=completed`.

First reading (2026-10-24, scratch `dshx dev`, not the live GUI, so no budget claim): one sidebar `thread switch`
took 210 ms to the transcript paint; its four dshx calls (`jujutsu-composer/context`, `jj-threads/threadAt`,
`jj-threads/destination`, `chat-resume/available`) each stayed open 520–680 ms in the browser and were then cancelled
by the switch (`dshx.api.outcome=aborted`). The `threadAt` and `destination` Host spans took 19–25 ms, so most of
their browser time was waiting (the "client span ≫ server child" row); `context` was Host work (660 ms, 459 ms of it in
`jj log`). Worth measuring on :3080 before reading more into it.

## JJ reference lookup request storm (2026-10-25)

The user-provided live DevTools captures show **63 requests** with `registerRepository` pending, followed by captures with
many `referenceGraph` calls (roughly 9.8 kB each). The source confirms an N×M request pattern in
[`chat-reference-overlay.tsx`](../plugins/@dshfiles/jujutsu/src/chat-reference-overlay.tsx): both inline-title lookups
and hover previews independently register the Session repository, fetch project/workspace paths, register up to 31
candidates in parallel, then request one graph per candidate. They used different query keys, so the same reference
could run that full search twice. Inline titles are requested as references enter the viewport, not just on hover.
This is a confirmed source-level cause consistent with the captures; the live receiver could not accept new traces
(`traces_status`: port 4318 already in use), so there is no server-span attribution for those exact captures.

The first fix shared preview/title query identity and cached project discovery and repository registrations for 30 s. A
follow-up now gives inline titles a separate local-title query key and checks only the Session repository. On a local miss,
the chip keeps its literal token; it does not fetch project/workspace paths or search other repositories during a thread
switch. Hover still performs the full cross-repository lookup and carries the Session id so that explicit preview can
update the chip. This removes cross-repository N×M fan-out from thread switches. A local title still needs one graph read
per distinct reference (repository registration is cached); a cold foreign-reference hover can still fan out to 31
candidates. Tests cover local-key isolation and caching, repository-registration caching, and Session id on preview events.
No matched live before/after interaction exists, so savings remain unmeasured.

The two scoped chat-reference scratch journeys now pass after the local-only title refinement (2/2, 69 s); foreign references keep
their literal token until hover, then the preview resolves and updates the chip. The full Jujutsu browser run before this
refinement passed 9/14; its two chat-reference failures are resolved by the scoped rerun. Three unrelated failures remain:
a duplicate-button strict-mode failure in stale-repository recovery, a missing composer review surface, and a
workspace-cleanup menu-item timeout.

A live read-only probe on :3080 also measured three unrelated sidebar switches at **66, 66, and 22 requests**, versus
9–14 in the older table above. The first two took about 31 s to visible history and had ~7.5k DOM nodes; the third took
9.6 s. Long tasks were 1,021 / 250 / 151 ms total. Host lag over 20 s was p50 4 ms, p90 15 ms, p99 112 ms, max 1,583 ms
(one stall); machine load was 9–16. The switch request lists included `repositories` (up to 17.0 s), `session/page`
(up to 12.4 s), `active` (up to 9.1 s), `session/create` (9.4 s), and several repeated `available`, `pending`, credential,
and model-catalog reads. These are browser request durations, not isolated server times, and the sample is not the
reference-preview reproduction. The first two switches also spent ~31 s in the probe's composer/history readiness
waits, so their totals include requests accumulated during those timeouts and are not a like-for-like rate comparison
to earlier successful, shorter switches. The Host profile sampled 14.4 s busy of 60 s, led by Cordis apply (4.3 s), subprocess
spawning (3.6 s), usage tool-source sync (2.9 s), and JJ process work (1.9 s); that indicates additional Host load, but
sampling under concurrent activity does not assign those costs to the clicks.

### Options to reduce plugin requests after this scoped fix

1. **Demand-drive queries (best next low-risk pass):** only poll what the selected tab actually renders, stop hidden-tab
   polling for historical charts, and avoid unconditional mount refetches when event invalidation or a short freshness
   window suffices. Confirmed source candidates: Traces keeps status/list/stats polling while its non-trace tabs are
   active ([`panel.tsx`](../plugins/@dshfiles/traces/src/panel.tsx), [`queries.ts`](../plugins/@dshfiles/traces/src/queries.ts));
   Usage charts poll every minute in the background ([`charts.tsx`](../plugins/@dshfiles/usage/src/charts.tsx)); AI Accounts
   forces quota-continuation reads on every mount ([`quota-continuations-query.ts`](../plugins/@dshfiles/ai-accounts/src/quota-continuations-query.ts)).
   These are source-confirmed opportunities, not yet measured against the live clicks.
2. **Batch cold-hover lookup only if it still misses budget:** replace the JJ client's per-repository hover fan-out with
   one owned-plugin lookup method that resolves a reference across registered projects inside the Host. Preserve
   ambiguity behavior, cap concurrent JJ subprocesses, forward cancellation, and trace one work unit. This could remove
   HTTP queueing, but it still needs a live measure because JJ subprocess work remains. It is no longer needed for thread
   switches after title queries were removed. Do not patch DSH core for this.
3. **Add request budgets and ownership tests:** per representative interaction, assert endpoint counts, polling cadence,
   visibility gating, cancellation, and stale-data behavior. A source audit can flag `refetchIntervalInBackground`,
   `refetchOnMount: 'always'`, raw timers, and large `Promise.all` API fan-outs for review, but should not auto-rewrite them.
4. **Share reads narrowly, not with one global cache:** Query clients are intentionally per plugin bundle; a global cache
   risks mixing owners, contexts, and invalidation lifetimes. Share a query module/client only when multiple surfaces
   truly consume the same contract and have the same freshness and authorization scope. Prefer one Host read-model API
   where aggregation/batching is the actual shared behavior.

Prioritize by measured request count × cadence × Host cost, then re-run the same live probes. The current switch sample
shows a broader regression against the previous baseline, but it does not identify a single owner for those slow calls;
keep it separate from the JJ reference fix until per-request server timings and the exact thread-switch journey are
captured again.

### Multi-host Session ownership lookup (2026-10-25)

A fresh one-switch probe on `127.0.0.1:3080` observed 55 requests; `dshx-9ca8a5fa/sessionRuntime` took 8.2 s and `session/page` took 4.9 s in the browser. Host-lag probes around the same interval had p50 4 ms, p90 32 ms, p99 403 ms, and max 702 ms; machine load was 20–21 and memory pressure was warning. The trace receiver still had no fresh spans because port 4318 was occupied, so browser duration is not treated as isolated server time.

The slow `sessionRuntime` route belongs to `@dshfiles/multi-host`. Its old path called `resolveOwner` for an unclaimed ID; the remote source's `owns` implementation then tried `session/list` against configured runtimes sequentially. Private remote-runtime inventory/status observations are omitted. The source path is consistent with delay from unavailable remote calls, but the missing server trace prevents assigning all 8.2 s to SSH.

The optimization now uses an existing session-source ownership claim instead of discovering owners for unknown IDs. The remote source indexes Session-to-runtime ownership from its successful list and reuses that mapping, avoiding an extra remote `session/list` when resolving a known owner. Direct source discovery for actual Session routing remains unchanged. Focused tests assert that an unclaimed local ID does not invoke owner discovery and that a listed remote Session resolves from the local index. The live Host still runs the old bundle, so a matched live after-measurement is pending a user-approved Host restart; no restart was performed.

## Request-latency follow-up (2026-10-25)

The unavailable-status failure backoff and map-level usage-registry snapshot optimization are already on the candidate line; the rows below record only additional work from this workspace.

| Follow-up                      | Change                                                                                                                                                                                                                                                                                         | Proof and remaining limit                                                                                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JJ repository inventory        | [`repository-views.ts`](../plugins/@dshfiles/jj-integration/src/repository-views.ts) serves last-good inventory immediately, coalesces background refreshes, and preserves explicit fresh scans for cleanup. One pre-change trace spent 10.1 s in 68 `jj log` calls.                           | 10 focused cache/API tests pass. Live Host still runs the old bundle; no after number yet.                                                                                                                                           |
| Worktree snapshot              | [`host.ts`](../plugins/@dshfiles/worktree-memory/src/host.ts) now decouples process inventory and stop from Session metadata; cached labels refresh in the background. The pre-change snapshot waited 8.073 s on metadata.                                                                     | 15 worktree-memory tests, typecheck/build/Host import passed. Live after-measurement is unavailable; one old cold SSH probe took 1.207 s, so this path can still exceed 300 ms; PID/startedAt identity validation remains unchanged. |
| Remote runtime status          | [`runtime-status.ts`](../plugins/@dshfiles/multi-host/src/runtime-status.ts) adds last-good/pending responses and coalesced background refresh; its 45 s failure TTL matches the candidate policy instead of adding a longer cooldown. The query polls every 5 s only while refresh is active. | Snapshot/API tests pass. Explicit reconnect still performs network work synchronously; live requests are not remeasured.                                                                                                             |
| Cold history tail              | [`tail-log.ts`](../plugins/@dshfiles/session-controller/src/tail-log.ts) adds bounded fallback reasons and stat/lookup/identity/read/scan/decode durations to the existing span; prior reads reached 6.33–7.33 s for a 1.24 MB/254-frame log.                                                  | The tail persistence test asserts these fields and cached-open behavior. No algorithmic change yet: use live phase data to choose one safely.                                                                                        |
| Partial usage-registry changes | [`trace-repo.ts`](../plugins/@dshfiles/usage/src/store.ts) updates only tool rows whose category or owner differs, complementing the candidate's whole-snapshot no-op guard and retaining the skill-row exclusion.                                                                             | Trigger-based regression test proves unchanged rows do not update and changed metadata still applies; live CPU savings are unmeasured.                                                                                               |
| Trace pruning                  | [`trace-repo.ts`](../plugins/@dshfiles/traces/src/trace-repo.ts) skips the empty expired-trace transaction.                                                                                                                                                                                    | 15 trace-store tests pass; there is no evidence this guard materially changes CPU.                                                                                                                                                   |

Other workspace polling changes stop question/quota retries after errors and avoid remote status lookups when no started-here thread needs them. Focused checks pass, but none of these workspace changes are delivered to the live Host: the client HMR watcher is absent, and Host changes require the user to restart. Re-measure only after deployment, under normal machine load, with the same probes.

## Repeated remote status probes and usage sync (2026-10-25)

| Path            | Live baseline                                                                                                                                                                                                                         | Change                                                                                                                                                                                            | Verification                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote status   | In a 10-minute trace window, `multi-host/runtimeStatus` ran 59 times (p50 1.93 s, p95 9.59 s, p99 10.75 s); `ssh command` ran 141 times with 39% errors (p95 8.89 s). Failed SSH attempts commonly took about 8–9 s.                  | Cache only recent connection failures for 45 s; reuse query data for 15 s and back off failed status/ping polling to at least 60 s. Explicit reconnect and successful connection clear the error. | Policy/cache tests and multi-host typecheck pass. Live after-measurement is pending a user-approved Host restart; the current live Host still serves old code. |
| Usage registry  | The 30-second Host profile attributed 2.42 s to `syncToolSources` inside a transaction. The read-only usage DB contained about 292k tool rows for a registry of 256 names.                                                            | Compare the last successfully synchronized name/source/owner snapshot and skip the transaction when it is unchanged; still pass the current registry to log indexing.                             | Snapshot/indexer tests and usage typecheck pass. Live after-measurement is pending a user-approved Host restart.                                               |
| Host event loop | A 60-second live sample had 372 observations (p50 5 ms, p90 117 ms, p99 833 ms, max 4.61 s; 17 stalls over 250 ms). Load was 11–16 on a 10-core machine and later rose to 30, so these wall times are not attributable to one plugin. | The fixes remove repeated work in the confirmed usage and remote-status paths; they do not address general machine contention.                                                                    | No live after-sample yet: neither changed Host bundle is active on `:3080`, and profiling during a build would distort the comparison.                         |

The bounded profile also sampled Activity Timeline and background-job work; those owners are separate and need their own trace-backed follow-up rather than speculative edits here. The client/Host bundles were not activated on the live Host, so no latency improvement is claimed yet.

### A restart alone did not change these numbers (2026-10-25)

The live Host was restarted at 21:33, but the multi-host bundle it loaded had been built at 20:00, before either fix landed, so the old client cadence and the missing Host failure cache stayed in place. The 30-minute window after that restart measured `multi-host/runtimeStatus` 251 times (about 84 per 10 minutes, p50 3.02 s, p95 9.51 s) and `ssh command` 136 times per 10 minutes with 34% errors: the same shape as the baseline above, during heavier-than-baseline machine load. An honest after-measurement therefore needs a restart that follows a fresh `dshx build multi-host` (the checkout now builds both halves); a page reload alone delivers only the client cadence change.

## Request-volume pass (2026-10-26)

One hour of stored dshx spans on the live Host (`traces.db`, `dshx.api.caller = client`) held **4,393 browser RPCs = 73/min**; the top three endpoints were 60% of them. Core native routes (`session/*`, `credentials/*`, `agentPresets/*`) carry no spans, so the browser total was about 19/min higher in the DevTools capture that started this pass.

| Endpoint (1h)                            | Baseline                                                  | Cause found                                                                     | Change                                                                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thread-sidebar-attention/state` (1,134) | 18.9/min, 194 duplicate calls inside the same 100ms       | three pollers (5s tab strip, 15s sidebar, 10s backlog), three per-bundle caches | one page-wide store, one 30s poll, writes adopt their snapshot, 2s refresh coalescing ([attention-client-store.ts](../plugins/@dshfiles/thread-sidebar/src/attention-client-store.ts)) |
| `annotations/list` (887)                 | 14.8/min, every 4s with the popover closed                | badge poll on the always-mounted composer action                                | 4s open / 60s closed, focus refresh while closed ([list-poll.ts](../plugins/@dshfiles/annotations/src/list-poll.ts))                                                                   |
| `jj-threads/threadAt` (658)              | 11.0/min, 51ms each, never unmounts                       | 5s poll of a status that only local mutations change                            | 2s queued / 60s idle, turn-end and mutations still invalidate ([thread-status-poll.ts](../plugins/@dshfiles/jj-integration/src/thread-status-poll.ts))                                 |
| `jujutsu/registerRepository` (118)       | 2/min but 9 calls in one 100ms, 47 errors                 | one call per project path from the reference preview                            | one `registerRepositories` batch, bounded concurrency, per-path null rows ([repository-batch.ts](../plugins/@dshfiles/jujutsu/src/repository-batch.ts))                                |
| `worktree-memory/snapshot` (108)         | 1.8/min, 8.8s each, **934s = 26% of Host handler time/h** | 30s badge poll ran the full process probe                                       | cheap `pressure` method for the dot, full snapshot every 180s for the detached pill ([panel.tsx](../plugins/@dshfiles/worktree-memory/src/panel.tsx))                                  |
| `jujutsu-composer/context` (80)          | 64/80 failed, every 60s                                   | remote bookmarks decoded as JSON lines                                          | plain-line decoder plus regression test ([composer-context-core.test.ts](../plugins/@dshfiles/jujutsu/src/composer-context-core.test.ts))                                              |
| every `useApiQuery` mount                | no cache; one cache per plugin bundle                     | completed reads were thrown away on unmount                                     | page-wide 30s completed-read cache, manual refetch/reconnect always fetches ([query-cache.ts](../tooling/dshx/packages/dshx/src/api/query-cache.ts))                                   |
| plugin updates, multi-host polls         | 60s builds check, 15s thread list, 30s status             | fixed cadences for rarely changing facts                                        | 300s build check, 30s thread list, 60s status ([sidebar-shell.tsx](../plugins/@dshfiles/thread-sidebar/src/sidebar-shell.tsx))                                                         |

Projected from the baseline cadences: roughly 73/min to the low 30s/min for browser RPCs, and the worktree probe from 26% to about 5% of handler time. **Not yet measured live**: the Host bundles only change after the user restarts `web`, and the scratch-profile probes were not run in this pass.

## Composer context subprocess fan-out (2026-10-26)

Live traces show the Jujutsu composer context is usually fast on cache hits (84–146 ms in recent samples), but cold reads can exceed the request budget: across 25 calls in 15 minutes, p95 was 870 ms and p99 1.38 s. One 466.8 ms thread switch contained a 355 ms client `jujutsu-composer/context` span and a 351 ms Host span with 12 child spans, including two separate `jj log` calls for the same base revset (one returned bookmarks; the other returned commit ids). A 60-second authenticated Host-lag probe recorded 558 samples (p50 5 ms, p90 7 ms, p99 54 ms, max 298 ms; one sample exceeded 250 ms), so the composer subprocess fan-out is a specific candidate rather than evidence of a sustained Host stall. The separate browser switch probe did not find a matching sidebar row, so no controlled click timing is claimed. The latest 20-call window from the unchanged live bundle spans about 19 minutes: median 158 ms, range 80–378 ms, one call above 300 ms, and six above 250 ms. Its slowest call still had 12 child spans. This remains baseline, not an after-measurement.

The composer now reads the base commit id and bookmarks in one bounded `jj log` query. On a cold composer context this removes one subprocess (12 children to 11 in the measured span shape); an integration test exercises the combined template against a real repository. A scratch DSH loaded the changed Host bundle and passed `doctor` plus the `composer-context` reach: the seeded file appeared, and captured browser evidence had zero console, page, request, HTTP, or warning errors. Its 55 ms click step is a UI journey timing, not an equivalent measurement of the context RPC. The live Host still serves the old bundle; this change has no live after-measurement, and no performance gain is claimed until the Host is updated and the same interaction is remeasured.

Residuals: one native `session/list` call in the same recent window took 959 ms and has no child breakdown, so its internal owner remains un-attributed at the native boundary. `multi-host/runtimeStatus` returned its cached response in under 1 ms while a background SSH refresh took 8.07 s; that remote wait is outside the local request path, but remote operations cannot satisfy a universal 300 ms bound. Native per-switch catalogs remain Host gap 69 as noted above.

### Trace-store pruning follow-up (2026-10-26)

A 30-second V8 profile of the live Host sampled 1.604 seconds of non-idle CPU; `@dshfiles/traces` pruning accounted for 565 ms inclusive. The read-only store was near its span cap (38,629 traces, 99,978 spans) and at its 200,000 metric-point cap. SQLite's retention query scanned the received-time index and sorted into a temporary B-tree; resource cleanup scanned all spans and logs into a temporary union even though only five resources existed. A later read-only Host-lag probe recorded 568 samples (p50 4 ms, p90 5 ms, p99 27 ms, max 153 ms) with no stalls above 250 ms.

A fresh read-only live-DB probe on a 10-core machine (load 3.8) measured separate medians after one warmup: span count 12 ms, metric count 34 ms, all ordered trace rows 177 ms (38,276 rows), and resource sweep 72 ms; logs were empty. These are independent query timings, not an end-to-end measurement; their ~295 ms sum excludes Zod parsing and deletion and is not a request-latency claim. The pruning implementation now uses bounded oldest-trace pages, indexed resource checks, and cached log/metric counts. Focused tests and build/typecheck evidence are recorded by the performance thread; no live before/after has been measured because the running Host still serves the old bundle. A synthetic in-memory SQLite comparison (15.838 ms median for the full-scan/sort path versus 0.744 ms for a candidate aggregate/bounded-page/indexed check) is a query-shape estimate, not production evidence.

## Quota forecast history batching (2026-10-26)

A live forecast render with seven enabled accounts sent seven successful `ai-accounts/history` requests. Request-start through response-body-read times were 133–292 ms; the bodies totalled 2,137,208 bytes (37,148–495,259 bytes each). One combined response would exceed dshx's 1,048,576-byte JSON limit. Even the two largest captured bodies sum to 944,594 bytes, leaving room for the batched envelope without dropping forecast history.

| Path                          | RPCs / quota-table scans      | Payload and timing                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before                        | 7 / 7                         | 2,137,208 bytes total; 133–292 ms per response through body read                                                                                                                                                                            |
| After, verified by query test | 4 / 4 (batches of 2, 2, 2, 1) | All seven histories retained; the seven-account test asserts the exact four-call grouping. No post-change 7-account live timing was captured: the live Host was not restarted, and the scratch browser journey uses two synthetic accounts. |

The Host scans quota storage once per batch, and the client falls back to the unchanged single-account endpoint when an older Host lacks the batch route or a batch contract fails. The scratch `quota-forecast` browser journey passed with its two fake accounts. The package-wide E2E command exited 1 on four other journeys (the plan-title assertion, two quota-recovery journeys, and model-effort fast-mode); those paths are outside this change. The scratch `dshx dev open` path was corrected to expect the real no-account empty state; its screenshot intentionally had no history requests.

## Jujutsu revision graph prefetch (2026-10-30 baseline; 2026-10-31 integrated live after-probe)

| Measure                                                   | Live baseline                                      | Thread change                                                                            | After in scratch DSH                                       | After on integrated live Host                                                          |
| --------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| First graph row after selecting the `dshfiles` repository | 2.98 s; the initial `jujutsu/load` span was 2.12 s | No change to the initial `load` request                                                  | 288 ms; separate Host, not like-for-like                   | 1.87 s; one `load` request; not attributable to this change                            |
| Graph-page requests while opening the graph               | 20; one took 11.86 s, with 11.69 s in `jj evolog`  | Initial fill floor 200 → 40 revisions; lookahead 8 → 2 viewports (minimum 2.4 → 1.2 kpx) | 9 requests (145–222 ms each), 44 visible revisions         | 6 requests (301–1007 ms); 70 revisions loaded, 35 rendered in the viewport             |
| Browser long tasks during graph opening                   | 29 tasks, 2.20 s total, 321 ms max                 | No DOM/rendering change                                                                  | 0 during the scratch graph-open probe                      | 2 tasks, 359 ms total, 192 ms max; measured from repository selection through API idle |
| Workspace drag to preview readiness                       | Live baseline probe did not produce a preview      | No drag or preview code changed                                                          | p50 583 ms over 3 runs (466–770 ms); each preview canceled | 934 ms in one live sample; canceled and source stayed on its original revision         |

The integrated live probe used the existing Host (PID 61372), the same `dshfiles` repository, and a fresh authenticated 1280×800 browser after `checkout sync` rebuilt the Jujutsu client. The focused result is 20 → 6 graph-page requests, with 70 revisions loaded; the first `jujutsu/load` path is unchanged, so the first-row timing difference is not evidence that this patch sped up that request. Machine load was still above 10 cores (12.31/15.92/15.39 before the after-probe, versus 11.54/14.89/22.18 at baseline), so absolute latency and long-task totals are not a controlled causal comparison. The graph-open long-task observer started immediately before repository selection. Drag preview remains outside the patch: one live sample took 934 ms and was canceled; there is no live before-sample, and the scratch p50 is a different Host.

The live browser showed one unrelated `[deepseek-account] account read failed {field: profile}` console error and one request failure in the network-idle run; no page or HTTP errors occurred, and a follow-up showed no failed or HTTP requests. The GUI also showed an unrelated restart notice for `@dshfiles/memory`; no Host restart occurred. The approved 60-second Host CPU profile failed at `Profiler.stop` with `Warning: Detected unsettled top-level await` (exit 13), produced no artifact, and left inspector port 9229 closed with Host PID 61372 still serving. No second profile was attempted while system load remained above 10 cores.

## Effect-native migration, Phase 6.2 (2026-11-03; controlled scratch before/after)

Both sides were measured the same way, on the same machine, in the same session: **BEFORE** is jj bookmark `main`
(`kpmmvlzx`, the pre-Effect baseline) checked out into its own workspace (`jj workspace add ../eff-w-perf-main -r main
--name eff-w-perf-main`, `pnpm install --frozen-lockfile`, full `turbo run build`); **AFTER** is this branch's workspace,
built the same way. Every number comes from a scratch `DSH_HOME` (`/tmp/dshx-boot-profile-*`) and a scratch `dshx dev`
instance. The live Host on port 3080 was never touched, restarted, or measured.

| Probe                                                             | BEFORE (`main`)                                  | AFTER (branch)                                       | Delta                           |
| ----------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- | ------------------------------- |
| Cold scratch Host boot, spawn → authenticated RPC (14 pairs)      | median **5,357 ms** (IQR 4,739–7,029; 3.4–9.0 s) | median **5,929 ms** (IQR 5,547–6,974; 3.8–11.7 s)    | **+11 %**, spread overlaps      |
| Same boot, 42 pooled runs per side                                | median 4,677 ms (IQR 4,083–5,685)                | median 5,341 ms (IQR 4,709–6,075)                    | +14 %                           |
| Boot including scratch-profile prep, end to end                   | median 7,032 ms                                  | median 7,213 ms                                      | **+3 %**                        |
| Host event-loop lag, idle                                         | p99 16–242 ms (median 24), max 43–257 ms         | p99 18–65 ms (median 34), max 42–90 and one 1,154 ms | noise-level; one AFTER outlier  |
| Host event-loop lag, 4 concurrent `session/list` streams          | p99 46–894 ms (median 116), max 198–894 ms       | p99 24–241 ms (median 39), max 26–346 ms             | AFTER steadier across 5 rounds  |
| Host event-loop lag, 8 concurrent `session/list` streams          | p99 30–606 ms (median 57), max 36–606 ms         | p99 46–710 ms (median 96), max 50–710 ms             | no clear change across 6 rounds |
| `dist/index.js` total, all owned Host bundles                     | 17,084,560 B = **16.29 MiB** (82 bundles)        | 18,303,870 B = **17.46 MiB** (83 bundles)            | **+7.1 %** (+1.16 MiB)          |
| Same total, gzipped                                               | 4.29 MiB                                         | 4.65 MiB                                             | +8.4 %                          |
| Tracer overhead, 300k `flatMap` steps (`bench/effect-tracer.mjs`) | +46–51 ns/step, span + recording on              | +43–48 ns/step, span + recording on                  | ≈ −3 ns/step                    |
| Thread switch, first click onto a thread with history             | median 476 ms, p90 710 ms, 18/18 over 250 ms     | median 506 ms, p90 637 ms, 18/18 over 250 ms         | ≈ +30 ms, same over-budget set  |
| Thread switch, second click onto a short thread                   | median 196 ms, p90 242 ms, 1/10 over 250 ms      | median 200 ms, p90 220 ms, 1/10 over 250 ms          | ≈ +4 ms, same over-budget set   |

**Five largest owned Host bundles** (`dist/index.js`, bytes on disk):

| Rank | BEFORE (`main`)          | AFTER (branch)             |
| ---- | ------------------------ | -------------------------- |
| 1    | `secret-catalog` 788,646 | `secret-catalog` 1,033,943 |
| 2    | `pulls-review` 760,231   | `ai-accounts` 810,451      |
| 3    | `ai-accounts` 739,594    | `memory` 533,934           |
| 4    | `memory` 454,976         | `jj-integration` 497,220   |
| 5    | `multi-host` 445,358     | `multi-host` 485,335       |

`effect` itself stays external: every bundle imports it as a bare `"effect"` specifier and no `effect/internal/*` code is
inlined. The growth is our own code plus newly imported runtime packages — 32 bundles now import `@effect/platform-node`
or `@effect/sql-sqlite-node` (0 on `main`), and `@dshfiles/jj-cli` is a new bundle. `pulls-review` shrank 760,231 →
232,534 B because its removed facade code went away.

**Method and commands.** Boot: a probe that calls `prepareComposedBootProfile` + `LocalBundleModel.listLocalBootBundles`
from the workspace's own `tooling/dshx/packages/dshx/dist`, spawns `dsh --profile dshx-boot --port <free> --no-open`
with `ScratchProfileRuntime.hostEnvironment`, and stops the clock at the first authenticated
`POST /api/credentials/describe` — not at "the log printed a URL". Runs were interleaved (alternating order per pair, 14
pairs, plus 42 unpaired runs) while recording `sysctl vm.loadavg`. Lag: the skill's `host-lag.mjs` 4 ms RPC sampled every
100 ms while 0/4/8 concurrent `session/list` streams held the Host busy (`node /tmp/lag-under-load.mjs <url> 20`). Switch:
the skill's `switch-probe.mjs` with `MATCH='^perf thread'` in a headless Chromium, ten clicks per side, interleaved.
Bundles: byte size of every `plugins/@dshfiles/*/dist/index.js`. Tracer: `node
tooling/dshx/packages/dshx/bench/effect-tracer.mjs`, min of 30 interleaved rounds, run three times interleaved against
both builds.

**Machine/load caveat.** This machine (10 logical CPUs) sat at load 3.5–24 throughout, drifting within a single paired
run, and the concrete evidence page hit its own memory pressure. Boot medians moved 3.4–9.0 s on `main` alone, so the
+11 %/+14 % boot delta is inside the spread: per-pair deltas ranged −2,952 to +2,577 ms while the median pair cost
+723 ms. Treat the boot row as "roughly half a second more on a noisy machine", not as a resolved percentage. The lag
rows are worse: p99 moved by more than 10× between rounds on the _same_ build (BEFORE x4 ranged 46–894 ms), so only the
idle p50 (3–5 ms both sides) and the absence of a systematic AFTER-only stall are meaningful there — the point is that no
build-specific stall appears, not that one side is faster. The switch rows come from the same noisy window, and the
AFTER side recorded one 1,154 ms idle outlier that no BEFORE run matched and that no build-side cause explains.

**Verdict against the budget (≤ +10 % boot, no new >250 ms interaction).** Boot: **not a clean pass, not a proven
regression** — spawn → authenticated RPC is +11 % on paired medians (+14 % pooled), while the end-to-end scratch boot
including profile preparation, which is what a user waits for, is +3 %. Because the paired spread overlaps and load
moved during every run, this is reported as unproven either way rather than claimed as a pass. Interactions: **pass** —
no new over-250 ms interaction appears; the same 19 of 28 clicks exceeded 250 ms on both sides, and the over-budget path
is the pre-existing first-click-on-a-thread-with-history cost (`session/page`, the per-switch catalogs and the snapshot
fan-out), not a new one. Bundle size is **+7.1 %**, inside the boot budget's spirit but a real growth that the external
`effect` decision does not absorb. Tracer overhead is unchanged within noise (≈45 ns/step with recording on, both sides).

Reproduce: `node .agents/skills/live-performance-audit/scripts/boot-probe.mjs <workspace>` (cold boot, one JSON line per
run: `prepareMs`, `spawnToFirstOutputMs`, `spawnToUrlMs`, `spawnToReadyMs`),
`node .agents/skills/live-performance-audit/scripts/lag-under-load.mjs <launchUrl> 20`,
`MATCH='^perf thread' LAUNCH_URL=<launchUrl> node .agents/skills/live-performance-audit/scripts/switch-probe.mjs 3`, and
`node tooling/dshx/packages/dshx/bench/effect-tracer.mjs`. The two new probes live beside `switch-probe.mjs`; the BEFORE
workspace has no `bench/effect-tracer.mjs`, so that one file was copied there temporarily and removed after the run.
Launch URLs are secrets and are not recorded here.

## Plugin performance sweep validated on the live GUI (2026-11-08)

Method: the [`live-performance-audit`](../.agents/skills/live-performance-audit/SKILL.md) probes against the running
Host, after it was restarted onto `jj:main` @ `836ef334` (the plugin sweep). Host `pid 44684`, started 12:58:21, 286
plugins / 230 active, checkout `/Users/astahmer/dev/dshfiles`. Machine: 10 logical CPUs, load average 4.8–7.5, no build
or e2e run of ours in flight. Probes: `host-lag.mjs`, `switch-probe.mjs` plus a by-title variant (the sidebar shows three
rows and a cross-project click re-renders the list, so index-based clicking walks off the end), the `thread switch`
interaction spans and per-plugin spans already stored by the traces plugin, and direct calls through the agent tools
(`thread_list`, `find_threads`, `grep`, `list_thread_questions`).

Host health, settled (60 s, 560 samples): p50 3 ms, p90 9 ms, p99 65 ms, max 150 ms, no stall. The first minute after the
restart still had p99 97 ms / max 806 ms with two stalls; one coincides with `preview/devServers` running its `lsof`/`ps`
port probes for 2.6–3.0 s, the other had no span of that length (unspanned native work during warm-up).

### Recorded wins, re-measured

| Interaction                                         | Sweep record                                 | Live now (same Host, 2026-11-08)                                                                                                      | Verdict                                                                                                                      |
| --------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `thread-actions/list` (sidebar page, `thread_list`) | 5,751 → 1,151 ms model; 250 → 50 title folds | cold 14,312 ms; warm 3,532 ms at `limit 50`, 2,540 ms at `limit 5`                                                                    | folds reduced as claimed (the limit only costs ~22 ms per folded title), but a fixed ~2.5 s remains: the native Session list |
| New thread                                          | not in the sweep                             | composer ready 633 ms, one 533 ms long task, 15 requests, none >250 ms                                                                | over budget; client render, not RPC                                                                                          |
| Thread switch (sidebar click)                       | 5,751 → 1,151 ms of sidebar fold work        | n=7 interaction spans: p50 1,073 ms, range 801–3,235 ms; 1–2 long tasks of 497–1,352 ms each                                          | over budget; see attribution below                                                                                           |
| Memory finder (`find_threads`)                      | 1,402–1,679 → 4–5 ms for the digest loop     | end-to-end 2,576 ms = native Session list 1,580 ms + titles 678 ms + project resolve 219 ms; the fixed loop is not measurable (≤5 ms) | loop win holds; the finder is still slow at the native list                                                                  |
| Prompt stash keystroke                              | 1,058 → 1.57 ms at the 50 × 8,800-char cap   | live library holds 3 prompts: 33–42 ms wall per keystroke including driver overhead, 0 long tasks                                     | cap case not reachable live — unproven end-to-end                                                                            |
| fff-search single-file `grep`                       | 1,515 → 0.88 ms (root-level file, one match) | root-level file: 2.4 ms (2 matches), 3.0 ms; 14.4 ms for a no-match file                                                              | holds — the whole-tree scan is gone                                                                                          |
| session-undo guard read                             | 318 → 0.051 ms                               | `session undo history read` p50 0.063 ms, p90 0.18 ms, max 1.27 ms (n=295)                                                            | holds                                                                                                                        |
| agent-questions `listTargets` (60 s reconcile)      | 422 → 0.014 ms                               | per-minute reconcile spans 0.06–0.56 ms; `list_thread_questions` reports `nativeSessionsScanned: 5` instead of the persisted corpus   | holds                                                                                                                        |

### Attribution of interactions over 250 ms

Read from the `thread switch` interaction traces (one per sidebar click) and the spans under them:

- **A 0.5–1.4 s main-thread long task starts at click time**, before any request leaves the browser. It is client render
  work on composer mount; the fan-out below only runs after it. This is the largest single term in a switch and it is
  not Host time.
- **Mount-time RPC fan-out queues behind the six HTTP/1.1 sockets.** Every one of these shows a client duration far above
  its server duration: `ai-accounts-serving-account/snapshot` 504–752 ms client vs 6–7 ms server, `ai-accounts/read`
  484 ms vs 242–260 ms (a 82–148 ms keychain read inside), `preview/devServers` 285 ms vs 7 ms (3.0 s when it runs the
  port probes), `ai-accounts-model-fast-mode/status` 281 ms vs 6 ms, `ai-accounts/usage` 281 ms vs 7 ms,
  `multi-host/sessionRuntime` 390 ms vs 173 ms, `annotations/list` 399 ms vs 5 ms, `session-undo/history` 399 ms vs 5 ms.
- **Host-side costs that are over budget and have an owner:** `jujutsu-composer/context` 509–2,167 ms (a `jj workspace
root` of 337 ms and a `jj log` of 554 ms inside), `jujutsu/referenceTitles` 605 ms (two `jj root` calls plus a `jj log`),
  `secret-catalog-setup/referenceStatus` 727 ms (external `secret` CLI: `print` 358 ms + `get` 312 ms), `ai-accounts/read`
  242–260 ms (keychain).
- **Errors seen in the same traces:** `ai-accounts/quoteRoutes` fails with `LegacyHandlerFailed` (`dshx.defect: true`),
  and `jj-threads/destination` aborts when the switch supersedes it. Filed separately; neither is a perf regression.
- `session/page` still reaches 255–906 ms per switch, and 8.8 s once on a cold page load, without a matching server span —
  same unresolved ownership as the note below.

### What this does and does not prove

Proven: the fold-reduction wins (thread titles, memory digest loop, fff single-file scope, session-undo guard,
agent-questions targets) are live, and none of them is what a user waits for any more. Not proven: the two client-side
wins at their benchmark scale — prompt stash has 3 prompts in this profile, so its cap case never runs, and the 0.5–1.4 s
composer-mount long task is not attributed to a single owned plugin without a browser CPU profile.

## Idle indexing and first-build disk writes (2026-11-08; scratch, not live GUI)

A scratch Host with the full web composition (94 bundles) on a synthetic 2,800-Session corpus, DSH 0.2.1-rc.2,
Node 22.23.3, 4 cores. Every number is taken after 110 s of settle, over a 120 s idle window, from `/proc/<host>/stat`,
`/io` and `/status` (worker threads included). Probe: boot, seed `<home>/sessions`, settle, sample; the per-pass numbers
come from `session-search/tests/idle-pass.bench.spec.ts` (`IDLE_BENCH=1`).

| Measure (idle Host, 2,800 Sessions) | Before               | After            |
| ----------------------------------- | -------------------- | ---------------- |
| Host CPU                            | 6.53 % of a core     | 0.23 %           |
| syscalls (read + write)             | 2,086 /s             | 19 /s            |
| bytes read / written                | 489 / 489 KB per min | 4 / 4 KB per min |
| settled RSS                         | 541 MB               | 526 MB           |

The owner was the session-search worker's ingest loop, which re-walked the whole corpus every 5 s even when nothing
changed:

| Cost          | Before                                     | After                                         | Why                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| one idle pass | 354 ms CPU / 462 ms wall                   | 33 ms / 30 ms                                 | the log walk used promise fs calls (294 ms of thread-pool round trips); the worker owns its thread, so sync calls; one cursor query per pass instead of two per Session                                                      |
| idle poll     | every 5 s                                  | 5 s doubling to 60 s, back to 5 s on any wake | every committed Session event already nudges the worker, so the poll only catches outside writers                                                                                                                            |
| first build   | 10.6 s, 285 MB written for an 8.6 MB index | 4.2 s, 42 MB written for 8.3 MB               | Sessions commit in groups (64 or 250 ms, a savepoint each) instead of one FTS5 segment per transaction; read buffers sized to the file instead of a zero-filled 2 MiB window (13 % of build CPU); constant SQL prepared once |

Boot, same scratch Host (`--cpu-prof` through `NODE_OPTIONS`, 2,800 Sessions): about 8.3 s of main-thread CPU before
the Host settles, and no owned plugin reaches the top 30 self-time owners. Node internals and module compilation
(`compileSourceTextModule` 1.3 s) lead, then cordis, Effect, zod, `dsh-app-boot` and the JSONL persistence reading
every Session header (`readGenerationHeader`, zstd). That is core work, and the launcher already sets
`NODE_COMPILE_CACHE` (`scripts/launcher-config.mjs`), so there is no plugin-side lever left at boot. The session-search
worker's first build of the same corpus costs about 3.7 s of CPU on its own thread.

Ruled out: marking a new index's backfills done changes nothing, because the worker's first backfill runs before any
document exists and finishes at once (285.1 MB written either way).

## Thread-switch lag and background list churn (2026-11-09, live Desktop GUI)

Measured on the live Desktop app (headless Chromium using its own session, read-only). The Host answered every switch
request in under ~0.4 s. The window's main thread was the bottleneck: each sidebar click held it for 0.3–0.55 s, and
viewing a running thread allocated about 800 MB in 25 s (the Desktop window's RSS swung between 0.9 and 1.7 GB).

| Cost (browser CPU / sampled heap profile)                                                         | Owner              | Fix                                                                             |
| ------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------- |
| ~75 ms per click: every palette action unregistered and re-registered, each notifying the palette | thread-sidebar     | `history` read through a ref, so `paletteActions` no longer changes per switch  |
| Every manager flush rebuilt every list row, so every list consumer re-rendered all rows           | session-controller | `projectList` keeps unchanged rows (`shareRecord`) and skips an unchanged `set` |
| Each list update re-derived a hex panel id for every Session × view (~10 MB per update)           | rich-composer      | the workbench catalog is republished only when ids or titles change             |

Before/after, same thread open and the same burst of activity in it (30 s window, sampled heap profile):

| Metric                                  | Before               | After                 |
| --------------------------------------- | -------------------- | --------------------- |
| Allocated per Session update            | 2.2 MB (120 MB / 55) | 1.5 MB (46.5 MB / 31) |
| List flush path (projectList subtree)   | 36 MB                | 3 MB                  |
| Palette registrations per sidebar click | whole action list    | 0                     |

Not attributed: three ~4 s main-thread freezes, all within one minute (one on New thread, not a switch). The Desktop
window has no remote-debugging port, so their content needs a DevTools Performance recording of the window itself.
The remaining ~0.8 s per click is native style/layout of the new transcript.

## Still open

- Loading older history in a cold thread (scrolling up past the opening window) and the first command still read the
  whole log once; the opening no longer does.
- Third-party `dsh-context` read each Session's whole log on its first visit (up to 2.4 s per switch); it is no
  longer in the web profile.
- Native per-switch catalogs (`skills/list`, `commands/list`, `schedule/list`, `agentPresets/list`, `session/modelCatalog`)
  answer under 250 ms on a warm Host but still run on every switch: Host gap 69.
- `session/page` reached 4.9–12.4 s in noisy browser switch probes without matching server spans. That is not isolated
  Host time, so leave ownership unresolved pending a clean capture rather than declaring a core gap.
- Main-thread work on open is ~0.6 s spread over many small tasks; no single leaf above 80 ms.
- The sidebar list's fixed ~2.5 s is the native Session list, not the plugin: `thread-actions/list` costs 2,540 ms at
  `limit 5` and 3,532 ms at `limit 50`, so the fold count is no longer the lever (same owner as Host gap `b:17rs`).
- The 0.5–1.4 s composer-mount long task behind thread switch and New thread is unowned: attribute it with a browser CPU
  profile before changing a plugin, rather than guessing from the plugin list.

## RAM sweep (2026-11-08)

Measured on the live Host (pid changes per restart; `heapUsed` after a full GC via SIGUSR1 + CDP on 127.0.0.1:9229)
and on scratch Hosts booted from a copy of the same home. A scratch read before ~100 s of settle scatters ±90 MB, so
every number below is taken after 110 s.

| Change                                             | Before                            | After                                                               | Where                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| session-search index (un-merged FTS5 postings)     | 2,010 MB                          | 182 MB after a compaction, compacted hourly on bloat                | `optimize` + VACUUM in the worker; searches 15–47 ms → 1–2 ms. The index re-bloats as Sessions are archived, so the size between compactions is higher |
| projection cache (derived per-Session checkpoints) | 325 MB / 202.8 MB heap            | 17 MB / ~15 MB heap                                                 | 14-day prune; since 2026-11-09 orphans only (it deleted idle threads' only cheap metadata, see ram-usage.md)                                           |
| WAL beside usage / traces / memory                 | 246 / 160 / 102 MB                | ≤ 32 MB each                                                        | `journal_size_limit` + `wal_autocheckpoint` in sqlite-store                                                                                            |
| job history index                                  | 20,000 rows / 13.2 MB             | 1 day / 8.9 MB                                                      | settled jobs leave after 24 h                                                                                                                          |
| quota history JSON                                 | 12.6 MB, 90 days                  | ~4 MB, 30 days                                                      | the panel's longest window                                                                                                                             |
| raw usage requests                                 | unbounded, +7.3 MB/day            | 90 days hot, older rows cold                                        | `requests_archive`, reports read both                                                                                                                  |
| traces spans / metric points                       | 100 k / 200 k                     | 30 k / 60 k                                                         | defaults lowered; the 72 h window was unreachable                                                                                                      |
| per-client stream buffers                          | unbounded (650 k chunks retained) | 4,096 frames + 8 MB follower, 1 MB events, 4,096 chunks per attempt | control queue, `follow()`, dshx events, assistant attempt, hmr-gate backpressure                                                                       |
| worker isolates                                    | Host's 4 GB limit                 | 512 MB search, 256 MB fff                                           | `resourceLimits`                                                                                                                                       |
| browser query cache                                | 5 min                             | 1 min                                                               | +133 MB across 20 threads measured before                                                                                                              |
| `~/.dsh`                                           | 11 GB                             | 4.3 GB                                                              | all of the above plus 874 MB dead index and 570 MB fff stores                                                                                          |

What the measurement ruled out: Effect schemas are 3.6 % of the fixed heap (~22 MB) and 4.1 has no compile step to
exploit; the session-log corpus is only 25 MB of the fixed heap; more transcript virtualisation is not a lever (the
DOM is already windowed); hidden plugin panels are 300–700 nodes.

Still open, with the measured size: lazy hydration for the storage domains whose core specs never declare per-record
reads (67 MB; the `storage-domain` and `storage-json` forks shipped and the per-record ones already hydrate lazily),
per-session client state LRU (100–110 MB per tab), lazy Host halves for panel rows (80 MB, needs a dshx primitive or the
plugin-manager facade), and one shared Effect `HostContext` per activation (20–40 MB, est.).

### Plugin SQLite opens, measured (2026-11-08)

The 60.9 MB attributed to lazy plugin SQLite does not reproduce as opening the files. Opening one store in isolation,
with the same `@dshfiles/sqlite-store` layer, its migrations and its repository construction, costs **0.5 MB of heap**
and 1.4–1.6 MB of RSS per store on this corpus: usage 0.5, traces 0.5, alerts 0.5, backlog 0.9 (including its item
hydration), and the 173 MB session-search index 0.1 MB of heap / 1.1 MB of RSS because `node:sqlite` keeps its pages
in native memory. Scratch boots from a pristine copy of the same 3.6 GB home agree: traces off 597 MB, usage off
587 MB, backlog off 590 MB against 586 MB all on — inside the ±15 MB boot-to-boot noise.

`session-search` is the only one of the four whose activation moves the needle: 495 MB of heap with it disabled against
586 MB all on. That is **not** its SQLite store: the Host bundle (`dist/index.js`) contains no `node:sqlite` import and
no `DatabaseSync`, and only `dist/search-worker.js` opens `index.sqlite`. The 90 MB is what registering the
`sessionQuery` engine enables downstream, so attribute that separately before treating it as a store cost.

`usage` is the one target whose store opened at activation with nothing reading it, so its repo now builds the store on
the first read (`SqliteStore.deferred`, `usage/src/store.ts`): activation dropped from 0.5 MB to 0.1 MB of heap, and the
first read pays 0.6 MB. `traces` stays eager on purpose: `RetentionWorker` prunes at boot, a write that needs the
store. `backlog` hydrates every item, alias and lease into its in-memory view at activation (`BacklogStore.layer`), and
`session-search`'s Host half never opens its index at all.

## Long threads (productivity pass Q4, 2026-11-09)

Scratch DSH, a 200-turn fake-provider thread, WebKit 1440×900; median of the A/B runs on the same instance.

| Interaction | main | Q4 | Verdict |
| --- | --- | --- | --- |
| Open the thread from another thread | median 383 ms (A/B, same instance) | median 375 ms | no regression; already over 250 ms before Q4 |
| DOM after open | 4,490 nodes, 53 turns | 4,496 nodes, 53 turns | +6 (rail controls); find bar and Turns sheet mount on demand |
| Find a match in turn 5 → highlight | impossible (browser find misses unloaded turns) | median ≈980 ms | over budget; the cost is the existing jump to an unloaded turn (`loadThrough` mounts every turn from it to the tail: 12,140 nodes) |

Still open: a jump to an unloaded turn (rail click or find hit) should mount the target turn's neighbourhood instead of
everything from it to the tail. Owner: the chat fork's `transcript-window.ts`. The `dshfilesTurnMarks` Host fold reads
four event types by hand (no schema decode per event), so it adds no measurable Host cost on this thread.

## Cold Session reads proportional to the Session (2026-11-09, U6)

Scratch Host on a clone of the live home (2,929 logs in 793 project directories, two SSH runtimes in multi-host),
`session/page` over HTTP and `session/follow` over `/api/remote.mux`, cold = first request after a Host start, warm =
repeated. Spans from the clone's trace store (`session tail read` `stat_ms`), Host CPU profile on the scratch inspector.

| Request                                  | Before                                             | After                                                                                                                | Owner                                                                                                          |
| ---------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| page/follow, empty New chat draft        | 8.2–9.5 s cold and warm                            | unchanged (8.7–9.6 s)                                                                                                | `@dshfiles/multi-host` `owns()` lists every runtime over SSH for an unknown id (Host idle: 172 ms CPU in 14 s) |
| same, runtimes removed (Host-owned part) | page 0.4–0.7 s / follow 2.9 s cold; 0.1–0.2 s warm | page 0.2 s / follow 0.2 s cold (boot lag, lookup 0 ms); 6–19 ms warm; 35–46 ms once the listing is over a minute old | session-controller history + persistence fork lookup                                                           |
| follow, 90 MB thread, first after start  | 9,114 ms                                           | 147 ms                                                                                                               | session-controller `MirroredSessions.resolve` asked the sources before this Host's own store                   |
| page/follow, 90 MB / small thread, warm  | 10/6 ms, 5/6 ms                                    | 24–55 / 19–52 ms, 9–27 / 12–33 ms (machine load 5)                                                                   | already tail- or size-bounded                                                                                  |

Causes: an unknown id cost two persistence lookups per request (tail stat, then `observeSession`'s stat), each a
sequential walk of all 793 project directories (75 ms idle, 1.7–2.9 s behind the boot listing, which also held every
first read behind the root-wide encoding walk); and a stored thread opened before this Host's first list merge was sent
to `multi-host`'s ownership check. The sessions API transcript fallback read through `readSession`, which lists the
whole corpus first; it now observes the one Session.

## Thread switch main thread and requests (2026-11-09, U5/U8)

Scratch Host on an APFS clone of the live home (`:3111`), headless Chromium, alternating two threads with history,
CPU profile per click mapped through the combo bundle's source maps, every request mapped to its initiator. Load 3–7
on 10 cores. Warm switch = a thread visited earlier in the same page.

| Cost found per switch                                                                                                       | Owner fix                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| every `sessions.list` change rebuilt the workbench panel catalog and hex-encoded sessions × views ids (≈200 ms)             | rich-composer: catalog kept when ids/titles are equal; encoded ids cached                                  |
| sidebar palette rows re-added one by one, each re-registering every palette action and re-diffing it per listener (≈110 ms) | command-palette: row groups replaced in one change, snapshot rebuilt only when dirty                       |
| first click opened the notification `AudioContext` synchronously (≈120 ms)                                                  | thread-sidebar: unlock in idle time after the gesture                                                      |
| each release rebuilt every list row, so every `sessions.list` subscriber deep-diffed the whole catalog                      | session-controller client: unchanged rows and projections keep their identity; no-op sets skipped          |
| `ai-accounts/read` re-announced unchanged routes: 2 × `llm/adapters-updated` → 5 `session/modelCatalog` reads               | ai-accounts Host: announce only when the file, setup candidates or discovered models changed               |
| header label and seat re-read `agentPresets/list`; picker re-read accounts, usage and `sessionRuntime` on mount             | agent-preset shared roster (60 s, cleared on roster change); picker reads accounts when open, catalog 30 s |
| release retired the Session generation: switching back reopened `session/follow` and repaged history (`session/page`)       | session-controller client: last 3 released generations stay open (LRU), local drafts retire as before      |
| seat ResizeObserver wrote then read layout; width controls rewrote unchanged custom properties                              | rich-composer fork: reads before writes, unchanged values not written                                      |

| Warm switch | Before                      | After                       |
| ----------- | --------------------------- | --------------------------- |
| composer    | 610–732 ms                  | 221–333 ms                  |
| history     | 714–758 ms                  | 225–337 ms                  |
| long tasks  | 2–4, 548–690 ms, max 410 ms | 1–2, 121–219 ms, max 142 ms |
| DOM nodes   | 1,740–3,026                 | 1,736–3,026                 |
| requests    | 11–19                       | 3–4                         |

Still above target: the new thread's React mount and its first layout (chat scroll restore, composer selection reveal,
width measure) are ~100–200 ms of main thread; keeping the last views mounted needs a main-view retention contract
that does not count hidden views as `mainView`, and transcript virtualization (U5) for the DOM budget.

## Page reload to interactive (2026-11-09, U4)

Scratch Host on an APFS clone of the live home (`:3141`), headless Chromium with a persistent profile,
`reload-probe.mjs` reloading one thread with history: cold = HTTP cache cleared, warm = second and third reload.
Load 4–6 on 10 cores; CPU profiles (200 µs) mapped to each combo section's plugin.

Serving is already right: combos and chunks are `immutable` for a year and gzip-encoded (no brotli); a warm reload
transfers 0.5 MB (the Vite `/assets/*` shell files have no `cache-control` and are revalidated — core). The cost is the
main thread: 122 boot rows, 38 MB of decoded JS, then plugin setup.

| Reload (thread with history) | Before            | After                                    |
| ---------------------------- | ----------------- | ---------------------------------------- |
| composer + transcript, cold  | 1.95 s            | 1.66–2.01 s                              |
| composer + transcript, warm  | 1.87–1.96 s       | 1.58–2.10 s                              |
| JS decoded / on the wire     | 38.2 MB / 13.8 MB | 31.8 MB / 11.5 MB                        |
| page main thread (profile)   | 2.31 s busy       | 2.05 s busy                              |
| boot `/api` requests (HAR)   | 53, 26 duplicates | 43, 16 duplicates                        |
| longest task                 | 0.83–0.94 s       | 0.80–1.03 s (unchanged owner, see below) |

Changes: `effect` and its Schema/Option/Result subpaths moved into `@dshfiles/shared-runtime` (every Client bundle
inlined ~110 KB of it: 7.4 MB over 63 rebuilt plugins, +0.76 MB in the supplier); five plugins that bundled it
privately now consume the supplier. settings-shell keyed its plugin-page projection on the locale revision, so every
namespace a plugin registered at boot rebuilt every page (130 ms; now 20 ms), and re-published equal search entries
(6 requests; now 1).

The longest task is one chain on the critical path between `session/list` and the sidebar paint, ~0.7 s:
session-controller `projectList` → rich-composer `workbench-views.tsx` `sync` registers one workbench panel per
session × conversation view, one at a time → each registration runs the workbench registry listeners:
`tab-panels.tsx` `readSourceNames` (lists every source, 0.38 s) and `workbench-view.tsx` `takeOpenRequests` →
`NewViewTabs.sourceId` (`new-view.ts:21`), whose failing `decodeUnknownResult` builds a `SchemaError` with a stack
per panel (0.27 s). Not fixed here: those three plugins were being edited concurrently.

## Boot and switch duplicate requests (2026-11-09)

Scratch Host on an APFS clone of the live home (`:3263`, its own copy of the profile `node_modules` so the two new
forks could be linked), headless Chromium, warm reload of a page landing on a thread, every `/api` request with its CDP
initiator stack mapped to the combo section that sent it.

Almost every boot duplicate had one cause: each owner read at setup, before the connection was up, then read again on
the first `connection/reset`, which the gateway emits for the page's first connected generation too. Change events
are only delivered from that generation on, so an owner now holds its boot read until then and treats only a later
reset as a reconnect.

| Duplicate                                | Owner                                      | Fix                                                                                          |
| ---------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `session/modelCatalog` × 4               | model-selection × 2, settings-subagent × 2 | boot read waits for the first generation; settings-subagent forked, reads via `joinPageRead` |
| `agentPresets/list` × 2                  | agent-preset                               | boot roster read waits for the first generation                                              |
| `ai-accounts-serving-account` per switch | ai-accounts                                | idle snapshot keyed by the Session's `updatedAt`, kept 10 min; running still polls           |
| `schedule/list` per header mount         | stock `ui-schedule`                        | forked: one source per Session; a remount keeps the read until `schedule/changed`/reset      |

| Warm reload, thread landing | Before                                                             | After                                                             |
| --------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `/api` requests (12–25 s)   | 48                                                                 | 36–39                                                             |
| duplicate calls             | 8: modelCatalog 3, agentPresets 1, describe 1, cordis 2, runtime 1 | 5–6: describe 1, cordis 2, sessionRuntime 1–2, fast-mode status 1 |
| warm switch, owned requests | ai-accounts snapshot 1                                             | 0                                                                 |

Second pass (same day, scratch Host `:3472`, headless Chromium, three warm reloads landing on a thread then six
switches; batch entries counted one by one):

| Duplicate                                     | Owner                                         | Fix                                                                                                                         |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `dynamicCordisRunner/syncInspectManifest` × 2 | stock `cordis-client-runner`                  | forked ([`@dshfiles/cordis-client-runner`](../plugins/@dshfiles/cordis-client-runner)): no sync before the first generation |
| `dynamicCordisRunner/inventory` × 2           | stock `ui-cordis`                             | forked ([`@dshfiles/cordis-cards`](../plugins/@dshfiles/cordis-cards)): read waits for the first generation                 |
| `multi-host/sessionRuntime` × 2               | model-effort-picker (two pickers), multi-host | one in-flight catalog load per Session; both owners read through `joinPageRead`                                             |
| fast-mode `status` × 2                        | model-effort-picker `FastModeIndicator`       | page-wide `useResource` with a 5 s stale time                                                                               |
| `jujutsu-composer/context` × 2 per switch     | jujutsu composer bar, chips, header toggle    | each surface's return-to-visible refresh joins the read in flight (`cancelRefetch: false`)                                  |

| Measured                    | Before                                                           | After                |
| --------------------------- | ---------------------------------------------------------------- | -------------------- |
| warm reload `/api` calls    | 62–63, 9–10 duplicate                                            | 58–60, 5–6 duplicate |
| owned or forked boot dups   | describe, syncInspectManifest, inventory, sessionRuntime, status | describe only        |
| warm/cold switch duplicates | 1 per switch (`context` or `sessionRuntime`)                     | 0                    |

Left: stock `ui-settings` still reads `settings/describe` at setup and on the first reset. It cannot be forked like the
others: the Host settings namespace is the Loader row id (`ui-settings`, read by its own developer-tools form,
`agent-preset` and `settings-shell`) and the Loader keys rows by id, so a replacement row would move that preference.
The other repeats in a 15 s reload window (`quotaContinuations`, `threadList`, `multi-host/list`, `traces-alerts/feed`)
are polls, not boot duplicates.

## Live page load after the data-fetching work (2026-11-10)

The 2026-11-06 fresh-load HAR of the live GUI (158 requests in 143 s, 99 % of request time queued, the first request
left the browser queue after 115.6 s) drove a batched dshx transport (`/api/dshx-batch`, see
[the API guide](../tooling/dshx/docs/guides/api.md#several-reads-of-one-tick-share-one-http-request)), the page-wide
resource store ([guide](../tooling/dshx/docs/sdk/resource-store.md)), `joinPageRead` for shared native reads, the
`settings-models` / `settings-web-search` forks and the P0 poll fixes. All of it is on `main` and was served by the live
Host restarted on 2026-11-10 at 16:15. One headless load of that Host, 100 minutes after the restart, machine load
9–13 (other agents running):

```sh
node .agents/skills/live-performance-audit/scripts/har-capture.mjs --seconds 60 --summary --out <scratch>/fresh.har
```

| Measure                                   | 2026-11-06 (user's browser, 143 s) | 2026-11-10 (headless, 60 s)                    |
| ----------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| `/api` requests                           | 158                                | 53 (27 of them `dshx-batch` POSTs)             |
| first request left the browser queue      | 115.6 s after the first was issued | 0 ms                                           |
| share of request time queued (`blocked`)  | 99 %, p95 113 s                    | 0 %, p95 0 ms                                  |
| request time p50 / p95                    | 4.3 s / 113 s                      | 43 ms / 2.77 s                                 |
| server time (`wait`) p50 / p95            | 5 ms / 1.4 s                       | 35 ms / 2.52 s                                 |
| aborted in the queue                      | 26                                 | 0                                              |
| `session/modelCatalog`                    | 16                                 | 1                                              |
| `credentials/describe`                    | 13                                 | 2 (one body)                                   |
| `llm/listProviders` + `listConfigurable…` | 8 + 8                              | 1 + 1                                          |
| `changes.summary` 404s                    | 8                                  | 0                                              |
| bytes received                            | 7.8 MB                             | 6.1 MB (`session/list` 3.5 MB, batches 2.0 MB) |

The two captures differ in browser (the user's, with every other tab and the `shared-streams` worker, against a
headless page with none), so the queue numbers compare the page's own demand, not the user's socket pool. The slow
reads left in this load are Host-side, not queueing: `session/list` 3.5 s server time for 3.5 MB (core),
`worktree-memory/scratchHosts` 3.7 s ×2, `ai-accounts/read` 2.5 s, `permissionPresets/catalog` 2.1 s (core).

That `har-summary.mjs` could not see inside a `dshx-batch` POST, so the 27 batches mapped to "unmapped dshx-batch" and
the 174 KB answer repeating every ~15 s (at 17.7, 31.3 and three times at 55.3–55.7 s) had no owner. The next section
attributes them.

## Batch-aware page load and the owned reads it named (2026-11-10, evening)

`har-capture.mjs` now records request bodies (Playwright's `content: 'omit'` HAR dropped them, so every POST had the
same digest and duplicate counts were wrong) and keeps, for each `/api/dshx-batch` POST, every call's endpoint
(`dshx-<channel hash>/<method>`), an envelope digest without its `traceparent`, and the byte size of its NDJSON answer
line. `har-summary.mjs` expands a batch into its calls, so each row names its owner, its largest answer (`maxKB`) and
its median repeat interval (`every·s`). Headless one-tab load of the live Host, 60 s, machine load 23–31:

| Measure                         | Before (summary without batch expansion) | After                                                             |
| ------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| rows attributed to an owner     | 26 of 51 (25 `unmapped dshx-batch`)      | every row; 50 calls in 27 batches expanded                        |
| repeating ~174 KB batch answer  | unattributed                             | `thread-sidebar-attention/state`, 176.6 KB per read               |
| duplicates (same method + body) | 27 extra (every POST body empty)         | 2 extra                                                           |
| heaviest batch call at load     | hidden in a 944 KB batch                 | `jj-threads/repositories` 741.5 KB                                |
| slowest batch call at load      | hidden                                   | `multi-host/projectOrigins` 8.96 s (`multi-host project origins`) |

### Fixes and their numbers

| Read                             | Owner and cause (trace)                                                                                                                                                     | Before                                                                                  | After                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `worktree-memory/scratchHosts`   | The whole time is the `worktree-memory probe` span (`ps` spawn) queued behind the page-load Host work; `ps` alone takes 0.10 s. "Twice" is the load read plus the 30 s poll | 1381 ms at load, 63 ms at the 30 s poll; 4.1 s worst trace; one `ps` per reader per tab | first read 20 s after mount; one probe per 15 s for every reader, concurrent readers joined (unit test); live after: pending |
| `ai-accounts/read`               | `ai accounts read` 341 ms: keychain spawn 139 ms (p50 47 ms), the rest untraced Host time before it; every read rebuilt routes, pool and profiles                           | route rebuilds per unchanged read: 1; fixture 2.4–12.9 ms per read                      | rebuilds per unchanged read: 0; fixture 1.6–28 ms per read (load 21–35: no measurable difference)                            |
| `thread-sidebar-attention/state` | ~1000 unacknowledged records re-read whole on every `changed` event and 30 s poll                                                                                           | 176.6 KB per change (synthetic 1200 records: 214.5 KB)                                  | `changesSince`: 272 B per finished turn, 136 B per opened thread; first read of a page unchanged                             |
| 13 `retry: 1` queries (P0-3b)    | usage, activity-timeline, agent-communication, thread-sidebar inbox overrode `retryOnceUnlessTimedOut` with no stated reason                                                | a client timeout retried once                                                           | not retried; other failures still retried once                                                                               |

```sh
node --test .agents/skills/live-performance-audit/scripts/har-*.test.mjs
pnpm --dir plugins/@dshfiles/worktree-memory exec vitest run src/process-probe.test.ts
pnpm --dir plugins/@dshfiles/ai-accounts exec vitest run src/read-route-snapshot.test.ts
pnpm --dir plugins/@dshfiles/thread-sidebar exec vitest run src/attention-store.test.ts src/attention-client-store.test.ts
```

The worktree-memory first-read delay and the retry changes are client-only; the scratch cache, the route snapshot
and `changesSince` are Host changes and take effect only after the user restarts DSH. A page against an older Host
reads the whole attention state as before. Live after-numbers for all four need a build in the canonical checkout
(and, for the Host halves, a restart) and the same capture.

Still slow in this load and not owned by these fixes: `session/list` 1.36–3.1 s for 3.55 MB (core),
`settings/describe` 200.8 KB ×2 (core, Host gap rows 97 and 99), `multi-host/projectOrigins` 8.96 s, and the
attention writes (`acknowledge`, `clearUnread`, `markUnread`), which still answer the whole 177 KB snapshot.

## Project origins and the Land repositories view (2026-11-10, night)

Both slow reads of the evening load were in owned plugins.

**`multi-host/projectOrigins` 8.96 s.** The trace of the same Host shows why: `m1-perso`, the one visible SSH host, is
asleep, and `ssh` (`ConnectTimeout=8`) exits 255 after 8.2 s (`multi-host runtime pool connect` → `ssh command`,
`SshUnreachable`). The origin read already batched one `ssh` per host, bounded local `git` spawns at 8 and cached
results for 5 min, but it waited for that `ssh` before answering, so the sidebar's remote-thread grouping waited 9 s
after every cache expiry. The read now waits at most 1.5 s for a remote host: a slower host answers `origin: null`
with `pending: true`, its one `ssh` keeps running detached and fills the cache, and concurrent callers join it
instead of starting another. The sidebar asks again every 3 s while `pending` is set. Local origins are cached until
the project's `.git/config` changes (mtime and size, one `stat` per path), so `git remote set-url` shows at once
instead of after 5 min. The span carries `dshx.multi-host.origin_requests`, `origin_local_reads` and `origin_pending`.

**`jj-threads/repositories` 741 KB.** A headless load of the live GUI decoded the answer: 772 KB for 12 repositories
and 48 thread workspaces, of which `unlanded` is 736 KB (95 %): 3,647 revisions, up to 577 in one workspace. Every
listed consumer needs only the counts (pending, conflicted, undescribed), the tip and a short list. `repositories`
takes an optional `revisionLimit`; with it each thread keeps its newest revisions and carries `unlandedSummary`
(totals over all of them), and the Land page asks for 10 and shows “+N older revisions”. `threadAt` still returns one
thread in full, the agent tool still lists everything, and an older Host ignores the field and answers in full.

| Read                                       | Before                                 | After                                              | Evidence                                                                              |
| ------------------------------------------ | -------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `projectOrigins`, unreachable host         | 8.96 s live (`ssh` 8.2 s); 3.76 s unit | ≤ 1.5 s, then `pending`; one `ssh` per host joined | `project-origins.test.ts` with a 2.5 s `ssh` stub: two calls answer in 1.5 s, one run |
| `projectOrigins`, `remote set-url` locally | stale for up to 5 min                  | next read                                          | `caches a local Git origin until its .git/config changes`: local reads 1, 0, 1        |
| `repositories` payload, Land page          | 772,957 B                              | 91,623 B (−88 %)                                   | `revisionLimit: 10` applied to the live answer captured headless                      |

The origin change is a Host change and the sidebar's 3 s re-ask is client-side; `revisionLimit` needs both halves (a
new page against the old Host still gets the full list). Live after-numbers need a build in the canonical checkout
and the user's restart, then the same one-tab `har-capture.mjs --summary`.

## Session-log tool catalog bytes (2026-11-10)

Every request series appends a `request/header` with the assembled tool catalog (~280 KB for the 468-tool live
preset). The owned [session-persistence-jsonl](../plugins/@dshfiles/session-persistence-jsonl/README.md) fork stores
a catalog once per Session artifact and writes a 288-byte digest reference for every later repeat; readers get the
rehydrated event. The agent loop is unchanged on purpose: `reason: "series"` resets `ToolHistoryProjection`'s declared
baseline, so dropping or slimming that event would change the provider request, while the storage layer removes the
same bytes with no reader change.

Measured read-only on the 75 live logs written on 2026-11-10 (75.7 MB decompressed):

| Catalog bytes                                    | Share of log bytes | Note                                                           |
| ------------------------------------------------ | -----------------: | -------------------------------------------------------------- |
| `series` headers                                 |     281–311 B each | were ~275 KB each before the fork (48 % of `session-6b9ec57a`) |
| first full catalog per log, 16.8 MB              |               22 % | one per Session; 0.28 MB of a ~1.3 MB subagent log             |
| full catalog rewritten on `resume`, 12 in 9 logs |      3.37 MB 4.4 % | the writer forgot its digests on Host restart; fixed below     |

The writer now resumes from the catalogs the artifact's committed rows hold when a Session reopens for write (never
from a torn final frame, whose rows the write path truncates and rewrites), and writes no reference into an unmarked
pre-fork artifact. Replaying four resume-heavy live logs through the fork, reopening the writer at each `resume`:

| Log (resumes)          | Plaintext before |              after | zstd before |             after |
| ---------------------- | ---------------: | -----------------: | ----------: | ----------------: |
| `532f8713` (5)         |          3.19 MB |            1.82 MB |      775 KB |            460 KB |
| `079d97e8` (2)         |          1.43 MB |            0.87 MB |      339 KB |            210 KB |
| `session-55691328` (2) |          8.13 MB |            7.58 MB |     1.61 MB |           1.48 MB |
| `584b1e78` (1)         |          1.21 MB |            0.94 MB |      302 KB |            238 KB |
| total                  |         13.96 MB | 11.21 MB (−19.7 %) |     3.02 MB | 2.39 MB (−20.9 %) |

With `@dshfiles/tool-search` the catalog changes after each search (36 tools and 33 KB, then 5 more per search), so
each search writes one new full catalog; the digest dedupe still removes every unchanged repeat. The remaining first
copy per Session (22 %) needs a catalog shared across Sessions, a separate artifact with export and pre-fork-harness
consequences; it is proposed, not built, in [native-fork waste](../plans/native-fork-waste/README.md).

```sh
pnpm --dir plugins/@dshfiles/session-persistence-jsonl exec vitest run tests/tool-catalog-dedup.test.ts
```

## Plugin storage list and review-mark batches (landed 2026-11-09)

Two storage costs measured during the plugin sweep shipped with their callers:

| Cost                                             | Before                              | After                         | Change                                                              |
| ------------------------------------------------ | ----------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `pluginStorage.list` walk, 7,500 `run/` keys     | 15 pages, 19.5–20.3 ms median       | `listAll({ prefix })`, 1.8 ms | one snapshot and one sort; `list` and its cursor contract unchanged |
| `automations.list` / `store.runs(25)`            | 24.5–25.8 / 23.8–24.8 ms            | 6.7–7.0 / 6.3–6.5 ms          | the two callers read `run/` in one pass                             |
| `diff-viewed` 50-mark bulk on a 7,000-mark store | 709 ms median, 50 document rewrites | 13.7 ms, 1 rewrite            | `KvTable.putMany` / `StorageTable.putMany`, one publish per batch   |

Both were benchmarked in scratch stores at landing (not the live GUI). They were not re-measured on 2026-11-10: the
machine's load average was 33 on 10 cores, which makes millisecond numbers noise.

## Memory system prompt sections per model request (2026-11-10)

Every model request runs `system-prompt/assemble`, and memory's hook adds its start block and the project's
workspace-scripts section. The live traces (240 min, 786 calls) put `memory system prompt sections` at p50 41 ms,
p95 2.4 s, max 12.8 s. Its children named the owner: `memory start block` p50 0.2 ms (the block is frozen per agent
and its rendering cached per project, scope and memory version), but `memory project path` p95 1.6 s (max 11 s) and
`memory ensure project scripts` p95 522 ms. The workspace-scripts lookup called the uncached `projectPathFor` and
`ensureProjectScripts` each time: about nine `realpath`/`stat`/`exists`/`mkdir` calls per request. No process spawn
and no SQL; the seconds were those calls queued behind the Host's libuv pool on a machine at load 30–38.

The fix in [`workspace-scripts.ts`](../plugins/@dshfiles/memory/src/workspace-scripts.ts) resolves the project through
the shared `ProjectPaths` cache (now with a 10-minute time to live, so a folder that later gains `.jj` is refiled) and
caches each project's scripts for 5 minutes. A hit touches no file; the section's text is byte-identical across turns,
so the prompt prefix stays cache-stable.

| Per request (scratch bench, 200 calls, load 28–35)     | Before (p50 / p95 / max)    | After (p50 / p95 / max)                |
| ------------------------------------------------------ | --------------------------- | -------------------------------------- |
| workspace-scripts lookup, thread workspace of dshfiles | 1.4–1.9 / 12–19 / 90–121 ms | 0.001–0.003 / 0.005–0.011 / 1.7–2.5 ms |
| file-system calls                                      | ~9                          | 0                                      |

The live after-numbers need the canonical build and a user restart of the Host; they are not measured yet. Re-check
with `traces_breakdown` on `memory *` grouped by operation: `memory project path` and `memory ensure project scripts`
should drop to one call per project per TTL.

```sh
pnpm --dir plugins/@dshfiles/memory exec vitest run src/workspace-scripts.test.ts
```

## Session residency bound (2026-11-10)

A long-lived browser tab kept roughly twenty Session instances resident: every visited thread's Sidebar Session view
stayed because its tabs are keep-mounted (Workbench side panel, editor tabs), and each view holds a whole Session with
its live follow. `jj:okllznnp` pinned tab resources; this bound bounds the views themselves. The plugin now keeps a view,
its resource pins and its kept-mounted bodies only for the on-screen Session plus the `residentThreads` most recently
shown others (`dshfiles-sidebar-right`, default 4, `0` = the old unbounded behaviour).

Scratch DSH (`dshx dev up`, 14 synthetic threads created through New thread, no provider turns), probe
`.agents/skills/live-performance-audit/scripts/session-residency-probe.mjs` with `ASIDE=1`, 14 visits; the setting was
changed live through Settings › Plugins › `@dshfiles/sidebar-right`. Fresh page per row; counts are after GC and a
reconnect.

| `residentThreads`    | instances | scopes | `sidebarView` retains | `threadSidebarAside` retains | open `session/follow` | heap  |
| -------------------- | --------- | ------ | --------------------- | ---------------------------- | --------------------- | ----- |
| `4` (default)        | 9         | 9      | 5                     | 5                            | 9                     | 94 MB |
| `0` (old, unbounded) | 14        | 14     | 14                    | 13                           | 13                    | 94 MB |

`workbenchPanel` stayed at 4 and `mainView` at 1 in both runs. Heap is flat because these synthetic threads carry no
real history; the lever here is instance and follow-stream count, not bytes: the default held 5 thread views for 14
visited threads instead of 14. Real history makes each resident Session cost its transcript window, which is what the
~20-instance tab was holding. A live-tab after-number still needs the canonical build and a user restart.

### With real history, and the unrendered-instance release (2026-11-12, `b:d5zd`, `b:db2p`)

Same probe (`ASIDE=1`, 14 visits, `TOP=15` for the largest node types, `EXPAND="Empty drafts"` because seeded logs
without a projection checkpoint list there), on a scratch DSH whose 14 threads each hold 120 provider-shaped turns
(~3 KB answer, a 2 KB reasoning signature on the source and the finish chunk; ~1.2 MB of events per thread, written
through the forked JSONL persistence). Before is the `jj:zrstxszz` build with `RESIDENT_UNMOUNTED_SESSION_LIMIT`
set to infinity, i.e. no release; after is the shipped limit of 4. `residentThreads` at its default 4.

| Build                          | heap after GC | instances | referenced | parked | `threadSidebarAside` |
| ------------------------------ | ------------- | --------- | ---------- | ------ | -------------------- |
| before (no unrendered release) | 84.9 MB       | 7         | 4          | 3      | 4                    |
| after (`jj:zrstxszz`)          | 84.9 MB       | 7         | 4          | 3      | 4                    |

Identical: with the sidebar-right view bound at its default, at most three instances are unrendered, below the
release limit of 4, so the release never engages on this workload; it only bounds `residentThreads: 0` or other
retainers. The page itself stays far below the 300 MB target after 14 long threads. Largest node types in the
snapshot: external string data 31.2 MB (script source), code 22.8 MB, `Object` 13 MB, strings 11 MB, arrays 10.1 MB,
closures 7.9 MB; no transcript-sized owner. So the scratch does not reproduce the 4–5 GB tab: the remaining candidate
owners are the live tab's DevTools retention (the 2.5 GB DevTools window recording thousands of POSTs) and growth
that needs hours of streamed turns, neither of which a scratch run can show; the live window must be measured with
DevTools closed (`docs/ram-usage.md`). Not run: the same A/B with `residentThreads: 0` (`dshx config` targets the
live runtime, so the scratch setting needs the Settings UI).

## Session-search index on `sqlite-store` (2026-11-11, copied live index)

The search worker opened its own `DatabaseSync` connection. It now builds on `@dshfiles/sqlite-store`
(`SqliteClient`), and the ingest pass is an Effect program: `runIngestPass` / `indexSessions` stage file reads,
frame decode and headers outside any transaction, then write a bounded group (64 sessions, 250 ms, or 8 MiB of
document text) inside one `sql.withTransaction`. Each commit re-reads the staged sessions' cursors and the archived
set, so a targeted search or archive change that landed during staging is skipped instead of overwritten. Searches read
on their own connection, so they do not queue behind a group commit, and a failing group rolls back every session and FTS
row in it (`tests/ingest.spec.ts`).

Proof used a copy, never the live file. A read-only SQLite online backup of `plugins/session-search/index.sqlite`
and its WAL (346 MiB) went to private scratch, and every run copied it again. The corpus was 120 frozen session logs
(36.3 MiB) the backup already indexed, so each run re-indexed by replacement (copied inode differs): 121 batches,
25,214 documents, until a pass reported no backlog. Queries were the real `SearchIndex.searchSessions` over five
terms — unfiltered and conversation-filtered — with one warm-up each, then 10 rounds (100 samples). Every response
digest matched the pre-migration digests. Node 22.23.3; load was 27–62 on 10 CPUs from unrelated work, so process
CPU and same-round pairs are the meaningful figures, not wall time across rounds.

| Signal                              | Before (`DatabaseSync`) | After (`SqliteStore`) |
| ----------------------------------- | ----------------------- | --------------------- |
| Replacement ingest, wall            | 6.39 s                  | 5.92 s                |
| Replacement ingest, process CPU     | 5.11 s                  | 5.42 s                |
| Replacement ingest throughput       | 3,946 docs/s            | 4,259 docs/s          |
| Search p50 / p95                    | 10.7 / 24.7 ms          | 10.0 / 21.7 ms        |
| Search p50 / p95 (second pair)      | 10.4 / 30.5 ms          | 9.9 / 22.6 ms         |
| Response digests, 10 fixed requests | baseline                | identical             |

The first port was not at parity: one SQL statement per document and one delete per mapped rowid cost 3.7× the CPU
(28 s vs 7.5 s of process CPU) and 3–7× the wall time. Batching the FTS5 inserts (100 documents per statement),
deriving contiguous rowids from `last_insert_rowid()`, writing the rowid map and conversation rows as multi-row
inserts, and deleting a replaced session's documents in 100-rowid chunks removed that overhead. The table above is
the batched version. Query latency is essentially unchanged because search SQL is untouched; the remaining CPU
difference is the Effect SQL statement layer, ~0.3 s over 25,214 documents.

To reproduce, take a read-only SQLite online backup of the live index (never open the live file read-write), copy
120 frozen session logs, run `runIngestPass` against a fresh copy until it reports no backlog, and measure
`SearchIndex.searchSessions` through the same `SqliteStore.layer` while comparing response digests. The harnesses
that produced this table were scratch files, removed with the private copy; the plugin suite remains the gate:
`pnpm --dir plugins/@dshfiles/session-search test`.

### Concurrent search during an ingest group commit (2026-11-11)

The group transaction held the worker's only connection, so a search that arrived while a group committed waited out the
whole transaction. `pnpm --dir plugins/@dshfiles/session-search bench:commit` measures it through the built worker: 64
Sessions / 4.88 MiB of document text fill one group, then every log gains two events so a second group commits while one
search at a time runs back to back. Eight runs (three before, five after) at load 36–42 of 10 CPUs from unrelated work;
wall drifts with load, so runs are reported as median (range) and process CPU beside them.

| Signal                                                   | Before (one connection) | After (read-only connection + 1 MiB chunks) |
| -------------------------------------------------------- | ----------------------- | ------------------------------------------- |
| Worker-reported slowest search during the commit         | 408 ms (190–950)        | **64 ms (38–263)**                          |
| Client p50 during the commit                             | 16.2 ms (9.6–26.6)      | 13.5 ms (9.8–17.2)                          |
| Client p95 during the commit (not comparable, see below) | 201 ms (25–417)         | 503 ms (265–576)                            |
| Idle p95 in the same runs (load reference)               | 72 ms (15–158)          | 80 ms (30–300)                              |
| Same corpus: documents, sessions, ordering digest        | 256 / 64, identical     | 256 / 64, identical                         |
| First-build process CPU (write path unchanged)           | 2 713 ms (2 621–2 778)  | 2 729 ms (2 582–2 736)                      |
| Delta-group process CPU (write path unchanged)           | 1 726 ms (1 517–2 079)  | 1 615 ms (1 496–1 750)                      |

The client-observed p95 is not comparable across variants: before the fix the bench's `health` RPC shared the writer and
often absorbed the pause, leaving the search RPC fast; after the fix `health` returns at once, so a search that lands
inside the worker's remaining synchronous work carries it. The worker-reported slowest search isolates the search path:
408 → 64 ms is the transaction queue the change targets. The residual ~1 s tail at this load is worker-thread scheduling,
not the transaction pass.

`search-worker.ts` opens a second read-only `SqliteClient` on the same WAL file after the writable store migrated;
searches and health read the last committed snapshot (the state a search between groups saw), while ingest keeps the only
writer and the one `sql.withTransaction` group commit. Document inserts stay inside that transaction, chunked by 100 rows
or 1 MiB of text so one synchronous FTS5 call no longer carries 6.4 MB. `tests/read-connection.spec.ts` proves a read
completes while a write transaction is open and fails with one connection; the group rollback and stale-cursor tests are
unchanged.

## Agent browser mirror cost (2026-11-11)

The mirror (`preview/mirrorFrame`) polls a viewport JPEG at quality 55 every 500 ms while the Agent browser tab and the
window are visible, and sends only a hash when the image did not change. Is that polling the cost? Probe
`.agents/skills/live-performance-audit/scripts/mirror-probe.mjs` runs the exact frame work — `page.screenshot({ type:
'jpeg', quality: 55 })`, SHA-1, image only when the hash changed — for four 60 s windows against a loopback fixture, and
reports frames/s, KB/s, and the CPU of the process taking the screenshots (in DSH this is the Host) plus the Chromium
process tree.

| Window        | Content                          | Calls | Frames | Bytes/s  | Screenshot CPU | Chromium CPU |
| ------------- | -------------------------------- | ----- | ------ | -------- | -------------- | ------------ |
| idle          | still page, viewer not polling   | 0     | 0      | 0        | 0.4 %          | 0 %          |
| still-poll    | still page, polling              | 115   | 1      | 0.1 kB   | 0.7 %          | 2.3 %        |
| animated-poll | CSS spinner, every frame differs | 112   | 112    | 17.4 kB  | 0.6 %          | 6.7 %        |
| dense-poll    | 24 text cards with animated bars | 112   | 112    | 209.7 kB | 0.9 %          | 11.1 %       |

The standalone probe indicates that polling is modest for these fixtures: Chromium uses 7–11 % of one core, and bytes
track page entropy, from ~17 kB/s for a spinner to ~210 kB/s for dense changing text. Its screenshot-process CPU is not
a DSH Host measurement. The probe prints one JSON envelope; `SECONDS`/`--seconds` and `ONLY=<window>` narrow a run.

A separate scratch DSH pass exercised the actual authenticated `mirrorFrame` Host API against an animated loopback CSS
spinner. During 60 seconds without polling, the Host accumulated 0.04 seconds CPU (0.07 % of one core). During the next
60 seconds, a browser called the API every 500 ms: 120 calls returned 120 changed frames, 1,392,176 response bytes
(23.2 kB/s), and the Host accumulated 0.04 seconds CPU (0.07 % of one core). CPU totals use `ps` process time, with its
coarse resolution; they exclude Chromium and cannot isolate small differences. This direct API driver did not mount the
Agent browser tab, so it does not measure its rendering or prove the UI's polling behavior. A scratch free-model route
returned 429; the page was opened through the authenticated preview API instead.

These numbers do not name Host polling as a significant cost, so the mirror retains polling rather than switching to CDP
`Page.startScreencast`. Full-rate video or canvas pages and real Agent browser tab rendering remain unmeasured.

## Live update and thread-open bytes on `/api/remote.mux` (2026-11-11)

Probe [`follow-stream-probe.mjs`](../.agents/skills/live-performance-audit/scripts/follow-stream-probe.mjs) on the live
GUI (headless Chromium, read-only): `updates` opens a working thread and groups every mux frame by stream endpoint and
frame/event type for N seconds; `switch` cycles sidebar threads and counts the visits that opened a new
`session/follow` (a cache miss). Load average 47–92 on 10 cores, so only bytes and counts are meaningful, not times.

What the wire carried before (live Host, built before these changes):

| Stream, frame                                     | Window | Frames | Bytes          | Per update p50 / max |
| ------------------------------------------------- | ------ | -----: | -------------- | -------------------- |
| `session/follow` opening snapshot, running thread | open   |      1 | 1,149–1,155 KB | —                    |
| `session/control` projection (all live Sessions)  | 90 s   |  1,032 | 770 KB         | 263 B / 28.5 KB      |
| of it `aiAccountsCost` (per-turn cost list)       | 90 s   |     80 | 281 KB         | — / 28.5 KB          |
| of it `turnOutline`                               | 90 s   |      9 | 110 KB         | — / 21.7 KB          |
| `session/follow` assistant-stream chunk           | 180 s  |    402 | 148 KB         | 372 B / 2.7 KB       |
| `session/follow` settled `assistant/message`      | 180 s  |      5 | 26.8 KB        | 3.4 KB / 14.1 KB     |

Two whole-value resends were the cost, and both now send what changed:

1. A settled `assistant/message` carries its recorded chunk stream, which repeats the message's text and arguments
   (three times with its block-end chunks): 459 KB of the 1.15 MB opening. The browser copy
   ([`browser-event.ts`](../plugins/@dshfiles/session-controller/src/browser-event.ts)) keeps only the record holding the
   first token, which is all Trajectory's first-token time reads. The experimental Session inspector no longer lists the
   chunks of a settled message.
2. `session/control` republished every projection value whole on each change. Each control stream now remembers the
   last value it sent per cell and sends later values as patches (array cut plus tail, changed object keys) when
   smaller: [`projection-patch.ts`](../plugins/@dshfiles/session-source-port/src/projection-patch.ts), encoded in the
   Session Controller fork, decoded by its client transport and by `multi-host`'s mirrored-runtime follower.

| Measure                                                     | Before          | After                                                 |
| ----------------------------------------------------------- | --------------- | ----------------------------------------------------- |
| opening snapshot, captured live frame replayed through fix  | 1,181 KB        | 774 KB (−34 %)                                        |
| settled `assistant/message` records in that snapshot (91)   | 606 KB          | 199 KB (−67 %); first-token time equal 91/91          |
| `aiAccountsCost` update at 30 → 35 turns (unit test)        | whole value     | < 1/5 of the whole value, decoded value equal         |
| live per-update bytes of `session/control` after deployment | 263 B / 28.5 KB | not measured: needs the canonical build and a restart |

Window cache and window rebuilds, measured and left as they are:

| Probe                                  | Result                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| `switch 6 3` (6 threads, 3 rounds)     | 11/12 revisits reused the open window (one reopened 1.25 MB) |
| `switch 12 2` / `EXPAND=1 switch 16 2` | the sidebar listed 7 threads; 7/7 revisits reused the window |
| `updates 180` on a running thread      | 0 new `session/follow` opens, 0 re-snapshots in 180 s        |

The Client keeps the last 3 released generations open
([`service.ts`](../plugins/@dshfiles/session-controller/src/native/client/sessions/service.ts) `PARKED_SCOPE_LIMIT`)
besides the 4 resident sidebar views, so one streaming thread cannot evict others by size, and a running thread's
window grows by appended events rather than being rebuilt. A byte budget would keep more threads open, but each open
generation holds a Host follow that also keeps its Agent from idle eviction; with every visible thread already a hit,
that Host residency buys nothing measured here.

```sh
S=.agents/skills/live-performance-audit/scripts
node $S/follow-stream-probe.mjs updates 180
node $S/follow-stream-probe.mjs switch 6 3
pnpm --dir plugins/@dshfiles/session-controller exec vitest run tests/browser-event.test.ts src/native/control.test.ts
pnpm --dir plugins/@dshfiles/session-source-port exec vitest run src/projection-patch.test.ts
```

## Long-lived tab heap: what held every visited thread (2026-11-12)

Scratch DSH (`dshx dev up`, every owned bundle `profiles/web` loads), seeded with 40 real thread logs copied from one
project (158 MB of decoded events, `cwd` rewritten to the scratch project). A headless Playwright Chromium opened each
thread through its `?thread=` URL (history push, no reload), 2.5 s per thread, two rounds (80 switches), settled 45 s,
then read `Runtime.getHeapUsage` after two `HeapProfiler.collectGarbage` calls and took a heap snapshot. Retainers come
from a dominator tree and shortest retainer paths over that snapshot; both runs used the same thread list and build
procedure. Before is `jj:vtzskmvy`, after is the three fixes below.

| Measure (after GC, settled)                       | Before   | After    |
| ------------------------------------------------- | -------- | -------- |
| page `heapUsed`                                   | 301.2 MB | 175.9 MB |
| heap snapshot, all nodes                          | 357.9 MB | 232.7 MB |
| Session instances alive (event window, assembler) | 41       | 9        |
| strings                                           | 76.9 MB  | 24.6 MB  |
| dshx plugin scopes left behind (`child` closures) | 39,187   | 87       |

What held the bytes, by owner:

1. **Every visited thread's whole Session** (41 of 41 alive; the controller itself kept 4 viewed + 3 parked). Two
   module-level maps that said "kept for the page's lifetime" held each thread's Session through its composer:
   `queue-reorder`'s queue editor and "Move to thread" actor (`session-queue-editor.ts`), and `send-after-upload`'s
   pending-send actor (`session-composer.ts`). Each Session brings its event window, projection values cache,
   conversation assembler (`contexts`, `inputs`, `contextsBySeq`) and composer: about 3 MB per thread on this corpus,
   more on threads with hours of turns. Both maps now drop an idle entry once the Session Controller no longer binds
   its Session; a busy edit, a pending send or a failed send stays, and an open edit record is persisted anyway. Fixing
   only the queue editor left 41 alive (271.7 MB): the composer map held the same Sessions.
2. **dshx plugin scopes.** A plugin's root scope kept one cleanup closure for every `keyed` run, child scope and early
   `add`/`provide` withdrawal, for the page's lifetime. Thread Sidebar re-registers its ~148 command-palette actions
   about twice per thread switch (1,485 adds in 10 switches), and each change reran Command Palette's `keyed` source,
   so a sidebar-click run of 80 visits left 69,089 scopes, one chain of them retaining 31.6 MB. `onDispose` now returns
   an unregister function and every early withdrawal uses it.

Not fixed, measured: 45 MB is bundle source (external strings) and 16 MB compiled regular expressions, both constant
across runs; the palette re-registration churn itself was fixed next (below).

```sh
pnpm --dir tooling/dshx/packages/dshx exec vitest run tests/plugin-context.spec.ts
pnpm --dir plugins/@dshfiles/queue-reorder exec vitest run src/session-queue-editor.test.ts
pnpm --dir plugins/@dshfiles/send-after-upload exec vitest run src/session-composer.test.ts
```

## Palette re-registration on thread switch (2026-11-12)

Same scratch DSH and 40 seeded threads; `registry-churn-probe.mjs 10` opens 10 threads through `?thread=` (2.5 s each)
and counts dshx registry traffic, five or more runs per side. Before is `main` at `b39671a8`. One early after-run saw
1,068 notifications once, never again in six more; the probe starts counting 6 s after the first row renders, so late
boot registrations can land in the window on a loaded machine.

| Over 10 switches                                   | Before    | After     |
| -------------------------------------------------- | --------- | --------- |
| `@dshfiles/command-palette.action` notifications   | 2,970     | 0         |
| palette entries written (Thread Sidebar)           | 1,485     | 0         |
| Command Palette listener time (its `keyed` reruns) | 64–68 ms  | 0 ms      |
| Workbench panel registry notifications             | 21        | 21        |
| page script time, whole switch (load 7–26, noisy)  | 1.8–2.1 s | 1.7–2.3 s |

Each switch replaces one Workbench `tab/*` occurrence (two registry notifications). Neither consumer lists
occurrences, but both rebuilt from the registry's new array: `registerWorkbenchPaletteActions` withdrew and re-added its
22 view actions on each notification, and the sidebar catalog (`SidebarCatalog`) took a new identity, which rebuilt the
folders and every header, destination and command action once per switch. The Workbench palette registration now
re-adds only an action whose view, label or aliases changed, and `SidebarCatalog.useCatalog` keeps the same array while
its content is unchanged. All 214 palette entries stay registered across switches. No other dshx registry or contract
notified during the switches; the native slot registry is not covered by the probe. The whole-switch script time is
dominated by rendering the opened thread, so the saved listener time is below its noise on this machine.

```sh
pnpm --dir plugins/@dshfiles/thread-sidebar exec vitest run src/workbench-palette.test.ts src/sidebar-catalog.client.test.tsx
```

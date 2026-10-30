# Performance: what made the live GUI slow, and what fixed it

How to measure: the [`live-performance-audit`](../.agents/skills/live-performance-audit/SKILL.md) skill. Budget:
250 ms per interaction and per request, on a Host whose event loop is not stalled.

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

[Full redacted measurements](workbench-switch-performance-2026-10-26.json). Reproduce with the pinned raw-core and
system-Chromium overrides from `verify-dsh`, built artifacts, `DSHX_E2E_PREWARM=0`, and Playwright's
`workbench-performance.feature.spec.js` target. Full run receipt:
`.dsh-e2e-evidence/1793034685726-c9d93c3c-9cb3-430b-8010-50178a2a3899/manifest.json`.

The final source was measured again at `4a1f4c76`: Native p50 **115.3 ms**, p95/max **123.5 ms**; Workbench p50
**33.2 ms**, p95/max **36.8 ms**. Both modes retained the same 757/901 median DOM counts. All twelve interactions and
observed HTTP API requests stayed below 250 ms. [Repeated redacted measurements](workbench-switch-performance-2026-10-26-final.json).
This confirms the controlled result, not a production or large-history after-deployment claim.

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

| Follow-up                      | Change                                                                                                                                                                                                                                                                                                                       | Proof and remaining limit                                                                                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JJ repository inventory        | [`repository-views-cache.ts`](../plugins/@dshfiles/jj-integration/src/repository-views-cache.ts) serves last-good inventory immediately, coalesces background refreshes, and preserves explicit fresh scans for cleanup. One pre-change trace spent 10.1 s in 68 `jj log` calls.                                             | 10 focused cache/API tests pass. Live Host still runs the old bundle; no after number yet.                                                                                                                                           |
| Worktree snapshot              | [`host.ts`](../plugins/@dshfiles/worktree-memory/src/host.ts) now decouples process inventory and stop from Session metadata; cached labels refresh in the background. The pre-change snapshot waited 8.073 s on metadata.                                                                                                   | 15 worktree-memory tests, typecheck/build/Host import passed. Live after-measurement is unavailable; one old cold SSH probe took 1.207 s, so this path can still exceed 300 ms; PID/startedAt identity validation remains unchanged. |
| Remote runtime status          | [`runtime-status-snapshot-cache.ts`](../plugins/@dshfiles/multi-host/src/runtime-status-snapshot-cache.ts) adds last-good/pending responses and coalesced background refresh; its 45 s failure TTL matches the candidate policy instead of adding a longer cooldown. The query polls every 5 s only while refresh is active. | Snapshot/API tests pass. Explicit reconnect still performs network work synchronously; live requests are not remeasured.                                                                                                             |
| Cold history tail              | [`tail-log.ts`](../plugins/@dshfiles/session-controller/src/tail-log.ts) adds bounded fallback reasons and stat/lookup/identity/read/scan/decode durations to the existing span; prior reads reached 6.33–7.33 s for a 1.24 MB/254-frame log.                                                                                | The tail persistence test asserts these fields and cached-open behavior. No algorithmic change yet: use live phase data to choose one safely.                                                                                        |
| Partial usage-registry changes | [`store.ts`](../plugins/@dshfiles/usage/src/store.ts) updates only tool rows whose category or owner differs, complementing the candidate's whole-snapshot no-op guard and retaining the skill-row exclusion.                                                                                                                | Trigger-based regression test proves unchanged rows do not update and changed metadata still applies; live CPU savings are unmeasured.                                                                                               |
| Trace pruning                  | [`store.ts`](../plugins/@dshfiles/traces/src/store.ts) skips the empty expired-trace transaction.                                                                                                                                                                                                                            | 15 trace-store tests pass; there is no evidence this guard materially changes CPU.                                                                                                                                                   |

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
| `jujutsu-composer/context` (80)          | 64/80 failed, every 60s                                   | remote bookmarks decoded as JSON lines                                          | plain-line decoder plus regression test ([composer-context-host.test.ts](../plugins/@dshfiles/jujutsu/src/composer-context-host.test.ts))                                              |
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

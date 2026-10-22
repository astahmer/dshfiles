# Performance: what made the live GUI slow, and what fixed it

How to measure: the [`live-performance-audit`](../.agents/skills/live-performance-audit/SKILL.md) skill. Budget:
250 ms per interaction and per request, on a Host whose event loop is not stalled.

## Why earlier attempts stalled

Several audits planned from source reading, request logs and small scratch fixtures, then proposed new helper
plugins or concluded that the fix needed a DSH core patch. Neither was right. The costs below only showed up when the
live GUI was measured per interaction (DOM size, long tasks, bytes per click, a CPU profile of the running Host), and
the biggest one lived in a native client package, where the fix is a fork of its Loader row, a route this
repository already used for the composer.

## Findings (live profile, October 2026)

| Cost                                                                                    | Evidence                                                                                                                         | Fix                                                                                                                                                                                                           | Owner                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Host event loop blocked up to 6 s; every request queued behind it                       | `host-lag` max 5.96 s; CPU profile: 7.4 s/min in `settings.describe()` reached from dshx `SettingsScope.get()` per Session event | settings read cached on the Loader entry's fiber, `fiber.config` and `options.config` identities                                                                                                              | dshx                                      |
| Thread open mounted 1.9k–42k DOM nodes, 0.4–14 s to history                             | DOM per row: collapsed historical Turn groups (17 px) held 1k–7k nodes each, kept mounted and hidden for browser find            | `@dshfiles/chat` forks the native Chat row: newest 24 rows mounted, older ones as the reader scrolls up, collapsed groups mount on first open                                                                 | chat                                      |
| Each switch fired 10–20 requests, several over 250 ms                                   | request list per click                                                                                                           | `@` skill and MCP sources read on first `@` query (no `warm`); MCP quick panel reads `list` with a stale time instead of `refresh` (which reconciles every MCP client); prompt-stash snapshots stale for 30 s | thread-sidebar, mcp-servers, prompt-stash |
| New thread's first prompt lost when another New thread opened before isolation finished | 4/4 prompts lost on a scratch Host                                                                                               | first send isolates on its own: provision, `connectWorkspace`, copy draft/attachments/references into that Session, send there                                                                                | jj-integration                            |
| Opening window of 26 MB on Anthropic threads                                            | `snapshot-bytes`: `replayState.blocks` (thinking signatures) sent twice per assistant message, 17 of 26 MB                       | `@dshfiles/session-controller` forks the native Session controller row: the browser copy drops replay blocks, and threads open on the latest Turn (20–120 messages)                                           | session-controller                        |
| `session/list` re-read every cold Session log                                           | Host CPU profile: `summarizeCold → readZstdPrefix`, 1.4 s per minute of switching                                                | cold projection columns kept until the Session attaches, appends or detaches                                                                                                                                  | session-controller                        |
| jj reads 80–340 ms each, up to 875 ms per composer `context` and 815 ms per `threadAt`  | the store has 52 workspaces; every jj spawn loads the repository view                                                            | `--ignore-working-copy` reads reused until the store's `op_heads` change                                                                                                                                      | jujutsu, jj-integration                   |
| "Load earlier" had to be clicked                                                        | —                                                                                                                                | older rows and pages load as the reader scrolls up; an open widens itself at most three steps                                                                                                                 | chat                                      |

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

## Still open

- Loading older history in a cold thread (scrolling up past the opening window) and the first command still read the
  whole log once; the opening no longer does.
- Third-party `dsh-context` read each Session's whole log on its first visit (up to 2.4 s per switch); it is no
  longer in the web profile.
- Native per-switch catalogs (`skills/list`, `commands/list`, `schedule/list`, `agentPresets/list`, `session/modelCatalog`)
  answer under 250 ms on a warm Host but still run on every switch: Host gap 69.
- Main-thread work on open is ~0.6 s spread over many small tasks; no single leaf above 80 ms.

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

## Still open

- Loading older history in a cold thread (scrolling up past the opening window) and the first command still read the
  whole log once; the opening no longer does.
- Third-party `dsh-context` read each Session's whole log on its first visit (up to 2.4 s per switch); it is no
  longer in the web profile.
- Native per-switch catalogs (`skills/list`, `commands/list`, `schedule/list`, `agentPresets/list`, `session/modelCatalog`)
  answer under 250 ms on a warm Host but still run on every switch: Host gap 69.
- Main-thread work on open is ~0.6 s spread over many small tasks; no single leaf above 80 ms.

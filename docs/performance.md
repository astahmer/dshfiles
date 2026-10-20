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

## Still open

- A Host's first open of a long thread decodes the whole Session log (69 MB compressed for the 26 MB thread): 1.4–1.7 s.
  That is `dsh-session-persistence-jsonl` loading the Session, below the controller.
- Third-party `dsh-context/detail` reads each Session once per Host (0.4–2 s), then answers in under 100 ms.
- Native per-switch catalogs (`skills/list`, `commands/list`, `schedule/list`, `agentPresets/list`, `session/modelCatalog`)
  answer under 250 ms on a warm Host but still run on every switch: Host gap 69.
- Main-thread work on open is ~0.6 s spread over many small tasks; no single leaf above 80 ms.

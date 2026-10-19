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
| Opening window of 26 MB on Anthropic threads                                            | `snapshot-bytes`: thinking signatures sent twice per assistant message, 65 % of the bytes                                        | —                                                                                                                                                                                                             | Host gap 67                               |
| `session/list` 3–13 s                                                                   | 944 Sessions, Host 73 % idle: every call re-reads each Session header                                                            | —                                                                                                                                                                                                             | Host gap 70                               |

Before and after on the same 10 threads (live, `switch-probe.mjs`):

| Per click                | Before              | After                                                                |
| ------------------------ | ------------------- | -------------------------------------------------------------------- |
| DOM nodes                | 1.9k–42k            | 1.9k–3.0k                                                            |
| Long tasks (total / max) | up to 2.3 s / 1.6 s | up to 1.5 s / 0.9 s; most clicks under 0.5 s                         |
| Requests fired           | 18–36               | 9–14                                                                 |
| History visible          | 0.4–2.7 s, one 14 s | 0.3–1.3 s for threads under 5 MB; 3.3 s at 5.4 MB and 6.2 s at 26 MB |
| Host lag p99 (60 s)      | 522 ms              | 126 ms                                                               |

The slow remainder tracks the bytes of the opening window, not rendering.

## Still open

- Bytes of the opening window: Host gaps 67 (replay state in `session/follow`) and 68 (client-chosen opening window).
- Native per-switch catalogs (`ui-skill` `skills/list`, `commands/list`): Host gap 69.
- Machine load: leaked `dshx-boot` scratch Hosts and editor jj servers pushed the load average to 60–120 on 10 cores
  during the audit, which inflates every number above.

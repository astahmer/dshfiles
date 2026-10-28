# Session open and the 250 ms request budget

> **Status: W1–W4 and W6 landed (2026-10-20); W7 is Host gaps 67–68.**
> **Resume here:** nothing owned is left; durable findings live in [docs/performance.md](../../docs/performance.md).

## Goal

Clicking a thread in the sidebar shows its latest messages within 250 ms and stays responsive; every request an
interaction issues answers within 250 ms on a Host whose event loop is not stalled.

## Measured (live :3080, 2026-10-19, before the dshx settings fix reached it)

Switch probe: load the GUI, click 10 sidebar rows in turn, and per click record time to the thread composer, time
until no WebSocket frame and no long task for 600 ms, long tasks, bytes and DOM size.

| Per click                          | Range                         |
| ---------------------------------- | ----------------------------- |
| Thread composer visible            | 150–750 ms                    |
| Settled (no frames, no long tasks) | 0.2–2.0 s                     |
| Main-thread long tasks             | 70–1,134 ms total, max 614 ms |
| `session/follow` opening bytes     | 0.3–33.5 MB                   |
| DOM nodes after open               | 1.9k–14.5k                    |
| Requests fired                     | 10–20, several > 250 ms       |

What a click costs:

1. **Rendering the opening window.** The core Session client opens history with `maxMessages: 500,
turnWindow: { minMessages: 50, minTurns: 2 }` (`dsh-api-session-controller` client, `HISTORY_PAGE_OPTIONS`); the
   Host pages correctly. On agent threads two Turns hold many steps: one sampled opening snapshot was 1.8 MB with
   78 assistant messages, 96 tool results and 96 tool calls. `ChatView` mounts every row of that window (6k–14.5k DOM
   nodes), which is where the 300–1,100 ms long tasks come from.
2. **Per-switch request fan-out** competing for six HTTP/1.1 connections and the Host event loop:
   - core: `skills/list` (×2, 0.25–5.7 s), `commands/list` (1.8–2.3 s), `schedule/list`, `agentPresets/list`,
     `session/modelCatalog`, marketplace `dsh-context/detail` (0.4–2.2 s, first read per session ~0.9 s);
   - owned: `thread-sidebar` `@` skill source (the second `skills/list`), `prompt-stash` `state`,
     `mcp-servers` `list`/`refresh`, `jujutsu-composer` `context`, `jj-integration` `threadAt`/`destination`,
     `ai-accounts` `quoteRoutes`, `thread-sidebar-attention` `state`.
3. **Host stalls.** Covered by [the Host stall profile](evidence/host-stall-profile-2026-10-19.md); the settings fix
   is on `main` but not yet running on :3080.

`session/list` on an APFS clone of the live corpus (944 Sessions) took 4–13 s with the Host 73 % idle: it re-reads
every Session header (first zstd frame) per call, so it is I/O-bound on the loaded disk. It runs at boot and on
reconnect, not per click.

## Work

| #   | Work                                                                                                                                                                                                                 | Owner                                                                 | Route                                                                                                                                                                                                   | Expected                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| W1  | Vendor `@deepseek-ai/dsh-client-ui-chat@0.2.1-rc.2` (MIT, `packages/client/ui-chat/src/client` at `dsh-v0.2.1-rc.2`) as `@dshfiles/chat`, byte-identical, disabling the native Loader row                            | new plugin                                                            | [native override](../../docs/native-plugin-overrides.md), like `rich-composer`: the flow slot's data hooks come from the package-private `nodeSources(binding)`, so a slot occupant cannot rebuild them | no behaviour change; e2e green                                  |
| W2  | Tail-window transcript: mount the last rows that fill the viewport plus overscan; mount older rows as the user scrolls up before asking the Host for older pages; turn navigation and find expand the window first   | `@dshfiles/chat` (`ChatView`, `use-chat-scroll`, `use-chat-viewport`) | local delta, recorded in the README like `rich-composer`                                                                                                                                                | DOM bounded (~2k), long tasks < 100 ms, first messages < 250 ms |
| W3  | Fetch `@` skills lazily on the first `@` trigger, cached per cwd and preset, invalidated on `agent-preset/selected`                                                                                                  | `thread-sidebar`                                                      | owned                                                                                                                                                                                                   | one fewer `skills/list` per switch                              |
| W4  | Stop refetching per switch what does not change per thread: `prompt-stash` state, `mcp-servers` list/refresh, `ai-accounts` quoteRoutes, `thread-sidebar-attention` state (stale times keyed by workspace or global) | owners                                                                | owned                                                                                                                                                                                                   | ≥ 6 fewer requests per switch                                   |
| W5  | Re-measure with the switch probe on :3080 after a sync and restart                                                                                                                                                   | —                                                                     | —                                                                                                                                                                                                       | before/after table here                                         |
| W6  | Record the core ones that stay > 250 ms (`skills/list`, `commands/list`, per-call header re-read in `session/list`) with numbers                                                                                     | `plans/dsh-host-gaps.md`                                              | Host gap                                                                                                                                                                                                | —                                                               |

Opening fewer messages (smaller `HISTORY_PAGE_OPTIONS`) would need a fork of the Session client data layer; W2 makes
render cost independent of the window, so measure W2 first.

## After W1–W2 (live :3080, 2026-10-20)

Same 10 threads, same probe; "history" is the time from the click until "Loading history…" is gone and rows show.

| Per click                | Before              | After               |
| ------------------------ | ------------------- | ------------------- |
| DOM nodes                | 1.9k–42k            | 1.9k–3.0k           |
| Long tasks (total / max) | up to 2.3 s / 1.6 s | up to 1.5 s / 0.9 s |
| History visible          | 0.4–2.7 s, one 14 s | 0.5–9.6 s           |
| `session/follow` bytes   | 0.3–26 MB           | unchanged           |

Most of the DOM came from collapsed historical Turn groups that kept every tool row mounted and hidden for browser find
(1k–7k nodes per 17 px group); they now mount on first open. What remains is data: the core Session client opens
history with at least 50 messages and 2 Turns, and the time to history now tracks the bytes of that window (26 MB took
9.6 s), not rendering.

| #   | Work                                                                                                               | Owner                                                        | Route                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| W7  | Open with a smaller history window (for example 1 Turn, 12 messages) and let the transcript window page older ones | `dsh-api-session-controller` client (`HISTORY_PAGE_OPTIONS`) | a fork of the Session client data layer, or a Host gap for a client-chosen opening window; measure which messages carry the bytes first |

## Measurement

- Switch probe: a Playwright script that clicks `[data-thread-main-action]` rows, with CDP WebSocket frame
  accounting and a `longtask` PerformanceObserver; keep it beside the e2e support when W2 lands.
- Cloned corpus: `cp -cR ~/.dsh/sessions` into a scratch home costs no disk, but cloned histories do not open in a
  scratch Host (no `session/follow` data), so transcript timing needs :3080 or a seeded long Session.

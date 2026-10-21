# Host stall profile — 2026-10-19

Why the live Web GUI on `127.0.0.1:3080` showed 10–16 s requests (graph, thread, palette, `session/create`) at once.

## Live Host lag and CPU profile

A probe posting `credentials/describe` (a ~4 ms handler) every 100 ms for 90 s: p50 4 ms, p90 52 ms, p99 522 ms,
max 5 961 ms. The event loop itself stalled, so every request queued behind it, whatever its own cost.

A 60 s V8 CPU profile of the live Host (SIGUSR1 inspector on 127.0.0.1, closed afterwards) spent 38 % of wall time on
the main thread. Owned work at the top:

| Inclusive     | Frame                                                      | Cause                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.5 s         | core `settings.describe`                                   | called from dshx `SettingsScope.get()`: memory `currentSettings` on every Session event (4.1 s), jj-integration `readSettings` via `threadsDirectory()` and `bookmark()` (2.3 s), thread-sidebar settled status (1.1 s) |
| 5.7 s / 3.9 s | core `configEditor.configuration` / `loadProfileDirectory` | inside each `describe()`: re-reads, parses and recomposes the whole profile from disk                                                                                                                                   |
| 4.9 s         | core `session.list` → `projectionsFor` → `summarizeCold`   | core client store; already a recorded Host gap                                                                                                                                                                          |

Fixed: dshx now caches `SettingsScope.get()` on the Loader entry's fiber, `fiber.config` and `options.config`
identities (a volatile-only update mutates `fiber.config` in place but always installs a new `options.config`).
Regression: `host-runtime.spec.ts` "describes Settings again only after the Loader entry receives a new config".
An earlier version keyed only on `fiber.config` and read a stale `isolateByDefault: false` after a volatile update,
which silently disabled isolation on a scratch Host; the test covers that case.

## Machine load

During the audit the machine ran at load average 19–120 on 10 cores: 21 DSH Hosts (most of them `dshx-boot` scratch
instances left by e2e runs, some 15 h old), the `dsh lkg` instance on :3099, and VisualJJ's `jj branching server` at
~64 % CPU for 7 h. On an idle scratch Host the same flows take: New thread → composer 132–475 ms, Send → message shown
38–198 ms, `session/create` 80–310 ms server.

Owned endpoints above 250 ms on their own (scratch, server time): `jj-integration/destination` 256–974 ms (three
serial reads, now concurrent), `jujutsu-composer/context` 258–1 200 ms (three serial jj stages; the workspace root is
now cached per cwd for 60 s), `jj-integration/provision` 256–538 ms, `threadAt` 290–640 ms.

## First-send isolation race

With `isolateByDefault`, a New thread's first Send holds the draft, provisions a `thread-*` workspace, switches
through the native workspace picker, then submits the moved draft. Opening another New thread before the switch ends
loses that prompt (repro: Send, then New thread at once; 4/4 prompts lost on a scratch Host):

1. The move waits in `preparing` for `resolved`, which only the mounted destination bar sends from its destination
   query; New thread unmounts it (and React Query cancels the query), so the move times out after 15 s.
2. `composerNavigation.open` picks through the picker bound by the visible composer, so a resolved move would move
   the newer New thread instead.
3. `deferWorkspaceSubmit` delivers into the visible composer, not the landed workspace's Session.
4. One `workspaceToggle` actor serializes all moves, so a second thread sent during the first switch is mis-routed.

Fixed in jj-integration: a first send no longer goes through the toggle or the visible composer. It retires its
deferred move (`claim`), resolves its destination itself, provisions or reuses the workspace without opening it
(`isolateFirstSend`), gets that workspace's blank Session with `uiWorkspace.connectWorkspace`, copies the draft,
re-registered attachments (draft attachments belong to one Session, and leaving it releases image drafts, so the
files are read at Send time) and reference chips into that Session's input, and sends there. Scratch Host: 4/4
prompts sent back to back with New thread clicked after each landed in 4 distinct `thread-*` workspaces, image
attachments included; regression tests in `workspace-toggle-machine.test.ts` ("first-send isolation",
"deliverFirstSend").

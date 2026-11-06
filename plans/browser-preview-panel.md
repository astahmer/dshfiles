# Browser preview panel

Goal: a thread's dev server and the page its agent drives show beside the thread, like t3code, Codex and Claude Code.

Shipped (2026-11-06), documented in the [preview README](../plugins/@dshfiles/preview/README.md): the `web` seed enables
the native right-Sidebar Browser tab (P1, needs a Host restart to apply), Open falls back to a new browser tab instead of
a dead button (P2), and **Watch** opens the **Agent browser** tab that mirrors the agent's headless page with click,
scroll and key input (P4, polled viewport frames with hash dedup rather than CDP screencast).

Resume here: after the Host restart, check P1 live (Open, `preview_reveal`, chat links with **In-App Sidebar**), then P3.

## Open

| Phase | What                                                                                                                                                                                                                        | Owner                | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------ |
| P1    | Live check after the restart: the chip's Open, `preview_reveal` and chat links each open a right-Sidebar Browser tab.                                                                                                       | user + preview       | todo   |
| P3    | Auto-reveal: when a thread's dev server first appears, offer one **Preview** action that opens it in the pane; a setting turns auto-open on. No pane steals focus without a click by default.                               | preview              | todo   |
| P4b   | Remote GUI: when the GUI origin is not loopback, Open on a loopback URL loads the viewer's own machine. Prefer Watch there (or open the mirror for a dev-server row through a short-lived preview page).                    | preview              | todo   |
| P4c   | Measure the mirror with `live-performance-audit` (bytes/s and Host CPU while watching an animated page); switch to CDP `Page.startScreencast` only if polling is the measured cost.                                         | preview              | todo   |
| P5    | Agent ↔ user hand-off: the agent points at an element (`preview_snapshot` ref → highlight overlay in the Agent browser), and the user annotates a region and sends it to the thread (reuse `@dshfiles/annotations` intake). | preview, annotations | idea   |

## Decisions to keep

- The pane is the native package as shipped (iframe on Web, `<webview>` on Desktop); we do not fork it.
- The Agent browser is a mirror of the Host page, not a second browser: it works from a GUI on another machine.

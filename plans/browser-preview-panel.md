# Browser preview panel

Goal: a thread's dev server and the page its agent drives show beside the thread, like t3code, Codex and Claude Code.

Shipped and documented in the [preview README](../plugins/@dshfiles/preview/README.md): the native right-Sidebar Browser
tab (checked live on the `web` Host after its 2026-11-10 restart: the dev-server chip's **Open**, a chat link and
`preview_reveal` each load the URL there), Open falling back to a new browser tab, and **Watch** opening the **Agent
browser** mirror.

Resume here: P3.

## Open

| Phase | What                                                                                                                                                                                                                        | Owner                | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------ |
| P1b   | One of two live `preview_reveal` calls made while the thread was on screen in a fresh browser did not open the pane (the other opened it within 1.4 s). Reproduce before changing the chip's reveal handling.               | preview              | todo   |
| P3    | Auto-reveal: when a thread's dev server first appears, offer one **Preview** action that opens it in the pane; a setting turns auto-open on. No pane steals focus without a click by default.                               | preview              | todo   |
| P4b   | Remote GUI: when the GUI origin is not loopback, Open on a loopback URL loads the viewer's own machine. Prefer Watch there (or open the mirror for a dev-server row through a short-lived preview page).                    | preview              | todo   |
| P4c   | Measure the mirror with `live-performance-audit` (bytes/s and Host CPU while watching an animated page); switch to CDP `Page.startScreencast` only if polling is the measured cost.                                         | preview              | todo   |
| P5    | Agent ↔ user hand-off: the agent points at an element (`preview_snapshot` ref → highlight overlay in the Agent browser), and the user annotates a region and sends it to the thread (reuse `@dshfiles/annotations` intake). | preview, annotations | idea   |

## Decisions to keep

- The pane is the native package as shipped (iframe on Web, `<webview>` on Desktop); we do not fork it.
- The Agent browser is a mirror of the Host page, not a second browser: it works from a GUI on another machine.

# Browser preview panel

Goal: a thread's dev server and the page its agent drives show beside the thread, like t3code, Codex and Claude Code.

Shipped and documented in the [preview README](../plugins/@dshfiles/preview/README.md): the native right-Sidebar Browser
tab for Open, chat links and reveals (a reveal now waits until the pane beside its thread takes it), the **Preview**
offer and `autoOpenDevServers`, the **Agent browser** mirror, and the remote-GUI fallback to the mirror.

Resume here: P4c.

## Open

| Phase | What                                                                                                                                                                                                                                                                                                                                             | Owner                | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ------ |
| P4c   | Measure the mirror with `live-performance-audit`: bytes/s and Host CPU while one Agent browser tab watches an animated page (a CSS spinner on a loopback server) for 60 s, against an idle tab. Switch `mirrorFrame` polling to CDP `Page.startScreencast` only if those numbers name polling as the cost; record them in `docs/performance.md`. | preview              | todo   |
| P5    | Implement and verify Agent ↔ user hand-off: highlight a `preview_snapshot` ref in the Agent browser and let the user annotate a region for the thread. The [design note](../plugins/@dshfiles/preview/README.md#proposed-agent-browser-hand-off) chooses a separate overlay event and describes annotation capture and safety.                   | preview, annotations | idea   |

## Decisions to keep

- The pane is the native package as shipped (iframe on Web, `<webview>` on Desktop); we do not fork it.
- The Agent browser is a mirror of the Host page, not a second browser: it works from a GUI on another machine.

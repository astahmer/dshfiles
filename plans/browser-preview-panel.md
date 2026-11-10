# Browser preview panel

Goal: a thread's dev server and the page its agent drives show beside the thread, like t3code, Codex and Claude Code.

Shipped and documented in the [preview README](../plugins/@dshfiles/preview/README.md): the native right-Sidebar Browser
tab for Open, chat links and reveals (a reveal now waits until the pane beside its thread takes it), the **Preview**
offer and `autoOpenDevServers`, the **Agent browser** mirror, and the remote-GUI fallback to the mirror. P4c measured the
mirror: polling two JPEG frames a second stays cheap enough that no CDP screencast switch is needed, and the numbers are
in [docs/performance.md](../docs/performance.md#agent-browser-mirror-cost-2026-11-11).

Resume here: P5.

## Open

| Phase | What                                                                                                                                                                                                                                                                                                                                                         | Owner                | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ------ |
| P5    | Implement the Agent ↔ user hand-off described in the [design note](../plugins/@dshfiles/preview/README.md#proposed-agent-browser-hand-off): highlight a `preview_snapshot` ref in the Agent browser and let the user annotate a region for the thread. Needs the overlay event, ref-to-rectangle resolution and the annotation capture path before it ships. | preview, annotations | idea   |

## Decisions to keep

- The pane is the native package as shipped (iframe on Web, `<webview>` on Desktop); we do not fork it.
- The Agent browser is a mirror of the Host page, not a second browser: it works from a GUI on another machine.
- The mirror polls; it does not use CDP `Page.startScreencast`, because the measured cost per watched tab is a fraction
  of one core and at most ~210 kB/s on a text-dense page.

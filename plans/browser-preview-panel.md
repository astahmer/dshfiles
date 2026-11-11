# Browser preview panel

Goal: a thread's dev server and the page its agent drives show beside the thread, like t3code, Codex and Claude Code.

Shipped and documented in the [preview README](../plugins/@dshfiles/preview/README.md): the native right-Sidebar Browser
tab for Open, chat links and reveals (a reveal now waits until the pane beside its thread takes it), the **Preview**
offer and `autoOpenDevServers`, the **Agent browser** mirror, and the remote-GUI fallback to the mirror. P4c measured
standalone screenshots and the scratch Host's `mirrorFrame` API; those numbers do not justify a screencast switch. See
[performance](../docs/performance.md#agent-browser-mirror-cost-2026-11-11) for the measurements and their limits.

Resume here: P4c's real-tab measurement.

## Open

| Phase | What                                                                                                                                                                                                                                                                                                                                                         | Owner                | Status  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ------- |
| P4c   | Measure bytes, Host CPU and frames while an actual Agent browser tab watches an animated page in scratch DSH; the direct API driver did not mount the tab. Compare against an idle tab.                                                                                                                                                                      | preview              | partial |
| P5    | Implement the Agent ↔ user hand-off described in the [design note](../plugins/@dshfiles/preview/README.md#proposed-agent-browser-hand-off): highlight a `preview_snapshot` ref in the Agent browser and let the user annotate a region for the thread. Needs the overlay event, ref-to-rectangle resolution and the annotation capture path before it ships. | preview, annotations | idea    |

## Decisions to keep

- The pane is the native package as shipped (iframe on Web, `<webview>` on Desktop); we do not fork it.
- The Agent browser is a mirror of the Host page, not a second browser: it works from a GUI on another machine.
- The mirror currently polls; the standalone screenshot and scratch Host API measurements do not yet justify CDP
  `Page.startScreencast`. The actual watched tab still needs measurement.

# Browser preview panel

Goal: a thread's dev server (and the page its agent is driving) opens in a browser pane beside the thread, like
t3code, Codex and Claude Code, instead of a dead **Open** button.

Resume here: nothing started. Do P1 first; it is a profile change plus a check.

## Why Open does nothing today

- `@dshfiles/preview`'s dev-server chip and `preview_reveal` call the dshx `Browser` contract
  (`tooling/dshx/packages/dshx/src/client/app-contracts.ts`), which `@dshfiles/chat` provides on top of the native
  `@deepseek-ai/dsh-client-ui-sidebar-browser` right-Sidebar tab type.
- That native package is **disabled by default in Web profiles** (enabled on Desktop) and `profiles/web` never enables
  it, so `Browser.available` is false and the chip shows "Open needs the browser tab of the thread on screen".
- The agent's `preview_*` tools drive a separate headless Chromium on the Host (one context per thread). Nothing shows
  that page to the user; `reveal: true` only asks the pane to load the same URL, in a different session.

## Phases

| Phase | What                                                                                                                                                                                                                                                                                                                                                          | Owner                   | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------ |
| P1    | Enable the native browser pane: `- id: ui-sidebar-browser` / `disabled: false` in the managed region of `profiles/web/cordis.patch.yml`, so `profile-sync` carries it to live. Host restart. Check the chip's **Open**, `preview_reveal` and chat links (link preference **In-App Sidebar**) each open a right-Sidebar Browser tab.                           | profiles/web            | todo   |
| P2    | Copy and recovery: when the pane is unavailable, the chip says why and offers **Open in new tab** (plain `window.open`) instead of a disabled button; a page refusing iframe embedding (`X-Frame-Options`, CSP) gets the same fallback. Remove "Open needs the browser tab…".                                                                                 | preview                 | todo   |
| P3    | Auto-reveal: when a thread's dev server first appears (dev-server poll), offer one **Preview** toast/chip action that opens it in the pane; a setting turns auto-open on. No pane steals focus without a click by default.                                                                                                                                    | preview                 | todo   |
| P4    | See the agent's page: stream the headless page to a **Preview** Workbench/right-Sidebar tab with CDP `Page.startScreencast` (JPEG frames over a dshx API event, throttled, only while the tab is visible), with click/scroll/type forwarded through the existing `preview_click`/`preview_type` path. Shows exactly the state the agent sees (logins, forms). | preview (Host + client) | todo   |
| P5    | Agent ↔ user hand-off: the agent can point at an element (`preview_snapshot` ref → highlight overlay in the P4 view), and the user can annotate a region and send it to the thread (reuse `@dshfiles/annotations` intake).                                                                                                                                    | preview, annotations    | idea   |

## Decisions to keep

- P1–P3 reuse the native pane: an iframe for Web, `<webview>` on Desktop. Its sandbox and loopback rules stay as
  shipped (see that package's README "Known limitations"); we do not fork it.
- P4 is a mirror of the Host page, not a second browser: a remote/LAN GUI can watch a Host-only dev server, which an
  iframe of `localhost` cannot do from another machine.
- Agent parity: every user verb (open in pane, stop mirror) is also an agent tool; `preview_reveal` already exists.

## Risks

- Remote GUI (LAN, multi-host): `http://localhost:5173` in an iframe resolves on the viewer's machine, not the Host.
  P1–P3 must detect a non-loopback GUI origin and prefer P4 there.
- Screencast cost: frames only while the tab is visible, capped fps, one stream per page; measure with
  `live-performance-audit` before shipping.

## Verify

- P1: `dshx dev up --plugin @dshfiles/preview --plugin @dshfiles/chat` with the patch row, start a server in a thread,
  click **Open**, screenshot the pane.
- P4: journey that runs `preview_open` on a fixture server and asserts the mirror shows a frame and forwards a click.

# Existing-browser and Linux desktop control through MCP

Use the [MCP servers manager](../plugins/@dshfiles/mcp-servers/README.md) to
connect an existing automation backend, rather than build another DSH plugin.
Browser attachment and desktop control are separate capabilities: controlling a
web page does not prove that native desktop screenshots or input work.

The MCP process runs on the **DSH Host**, not necessarily the computer displaying
the Web UI. Attach only to the intended user's browser or graphical session.
This guide adds no default server, profile configuration, dependency or core patch.

## Attach to an already-running Chrome

[Chrome DevTools MCP's attachment guide][chrome-attach] documents
`--autoConnect` for Chrome 144 or newer. It attaches to the running browser's
selected default profile, including its existing tabs and signed-in state; it
does not launch a separate automation profile.

1. Start Chrome normally. Enable remote debugging at
   `chrome://inspect/#remote-debugging` and approve the connection in Chrome.
2. In DSH's **MCP servers → Custom MCP**, select **stdio** and use a unique server
   name, for example `chrome_devtools`. For the tested server version, a command
   line is:

   ```sh
   npx --yes chrome-devtools-mcp@1.12.0 --autoConnect --no-usage-statistics --no-performance-crux --redact-network-headers
   ```

3. Choose an existing absolute working directory. Ensure Node and the executable
   are available to the DSH Host; use absolute executable paths if its PATH
   differs from an interactive terminal. The manager parses commands to argv,
   not a shell: shell substitutions are not evaluated.
4. Save, then make a native browser tool call such as `list_pages`. Confirm that
   the expected existing tabs are present before taking an action. Discovery of
   the MCP tool list alone does not establish browser attachment.

Pin reviewed package versions; this command is a tested example, not a promise
that it is the latest release. A separately installed, pinned executable avoids
package resolution/downloads when starting a client. Version 1.12.0 requires
Node `^20.19.0 || ^22.12.0 || >=23`; see its [package manifest][chrome-package].
The backend officially supports Google Chrome and Chrome for Testing; other
Chromium-derived browsers are not guaranteed by its [support policy][chrome-readme].

Do not omit `--autoConnect` when attachment is the requirement: the default
server mode launches Chrome with its own profile. Do not add `--isolated`, copy
cookies, or restart a personal browser with a different profile as a silent
fallback. Automatic attachment discovers the current endpoint; it avoids saving
an ephemeral debug-port number. Manual `--browser-url` attachment is a different
setup, and modern Chrome's `--remote-debugging-port` mode requires a non-default
user-data directory.

Attachment grants access to **all windows of the selected profile**, not just
one task tab. Keep page-ID routing enabled and pass explicit `pageId` values.
This routes calls but does not create an authorization boundary between agents.
The manager's native MCP clients are profile-wide, not one client per DSH thread.

The command opts out of the server's default usage statistics and the performance
CrUX lookup, which can transmit trace URLs. Header redaction is not complete
redaction of page contents, screenshots, network bodies or console messages.
Review [Chrome DevTools MCP's disclosures][chrome-readme] before attaching a
profile containing sensitive accounts.

## Connect Linux desktop control separately

[computer-use-linux][linux-driver] is an MIT-licensed Linux MCP server with
AT-SPI accessibility, screenshots, compositor-aware window targeting and input.
It can run independently of an agent desktop application. Version 0.7.22 offers
Linux x86-64 and ARM64 builds; its npm wrapper requires Node 18 or newer.
Install a reviewed release using its documented package method, then add a
second **stdio** entry with a distinct server name, for example `computer_use`:

```sh
computer-use-linux mcp
```

Resolve the executable from the DSH Host's PATH or use an absolute path. The
process needs the intended graphical session's environment, including the
Wayland display, user runtime directory and session D-Bus address. niri window
discovery also needs its `NIRI_SOCKET`, or the driver's documented unambiguous
socket-discovery fallback. Do not substitute another logged-in user's session.

Leave `COMPUTER_USE_LINUX_ENABLE_SHELL` unset or `0`: this keeps the optional
`run_shell` tool absent. `COMPUTER_USE_LINUX_INDICATOR_HIDE_TEXT=1` masks typed text
in the activity indicator. Set non-secret launch options through the chosen
launcher; use the manager's credential references for secrets, never inline
credential values.

Qualify the exact compositor and driver version. Window listing/focus, native
screenshots, semantic actions and coordinate input have different requirements.
For example, coordinate input on Wayland requires an accurate absolute-pointer
or approved RemoteDesktop route; a working ScreenCast portal does not prove
RemoteDesktop input support. Do not install a GNOME Shell extension to repair a
niri session, or interpret generic "Linux support" as full session qualification.

## Diagnose niri capture and text independently

### Multi-monitor screenshot failure

A manual test on niri 26.04 with two enabled outputs failed through its
GNOME-compatible screenshot route with:

```text
Condition failed: outputs.len() == 1 (2 vs 1)
```

Adding the last missing fallback executable, `gnome-screenshot`, was not the
fix. First inspect the failing backend and the compositor's actual capture
protocols. In that test, the live registry exposed `wlr-screencopy` v3; routing
**Screenshot only** to `xdg-desktop-portal-wlr` made full-desktop capture work.

The [portal configuration specification][portal-config] supports per-interface
selection. The relevant entry in an appropriate existing configuration is:

```ini
[preferred]
org.freedesktop.impl.portal.Screenshot=wlr
```

This is a routing fragment, not a replacement for the desktop's complete portal
configuration. Install the backend and its capture dependencies through the
distribution's supported workflow; check whether its package wrapper already
supplies them. Preserve working ScreenCast, FileChooser and other routes.
[niri's screencasting guide][niri-capture] describes its GNOME/PipeWire route and
supported capture protocols; the [wlr backend documentation][wlr-backend] explains
its Screenshot/ScreenCast interfaces. Their availability is version-dependent.

A portal restart may interrupt active screen shares. Inspect active sessions,
obtain permission before disruptive changes, and distinguish temporary routing
from a configuration that survives a new login. A newer Screenshot capability
property such as `AvailableTargets` being zero is not, by itself, proof that a
classic `Screenshot()` call fails: test the real capture.

### Successful typing can still deliver the wrong text

In the same qualification, unpatched wtype 0.4 returned success while the
application received `déj<Tab>` instead of `déjà`. The existing upstream
[wtype fix][wtype-fix], "Use printable keycodes for literal text," avoids mapping
literal characters to physical control-key positions. A distribution build
including that fix resolved the observed corruption without a DSH or driver
patch. This is not a claim to fix every Unicode, application or keymap issue.

Verify delivery through independent field/event readback, not only the tool's
`ok` result. Include accented characters and a case crossing the fix's
48-distinct-character keymap boundary. Never blindly replay uncertain input or
submit consequential data before checking its actual contents.

## Verification scope and acceptance checklist

Manual integration evidence from 2026-10-24 used DSH 0.2.1-rc.2, Chrome 155 with
Chrome DevTools MCP 1.12.0, and computer-use-linux 0.7.22 on niri 26.04. It verified:

- Native browser tools attached to existing tabs, read a temporary test page,
  filled Unicode text, clicked a test button and returned a screenshot image.
- Native desktop tools identified and focused a temporary native terminal;
  independent readback matched ASCII, accented/checkmark text and a longer
  sequence crossing the wtype keymap boundary.
- A two-output full-desktop screenshot returned an MCP image with coordinate
  dimensions and preview scale. A screenshot-guided absolute-pointer click was
  independently confirmed by the test application's mouse-event receipt.

These results do **not** establish every compositor, mixed/fractional scaling,
window-relative capture/input, arbitrary application, concurrent agent control,
or reboot persistence. They are prior manual results, not new automated test
coverage; no desktop actions were rerun for this documentation-only contribution.

For a new setup, use a disposable, clearly named test window and check:

1. Native MCP discovery **and** a real call through the intended DSH model route.
2. Screenshot image delivery, not merely base64 text or a green diagnostic report.
3. Correct target focus and coordinate conversion using the returned scale; never
   guess missing window origins or reuse another capture's pixel offsets.
4. Exact text and a delivered click/event; tool dispatch success is insufficient.
5. Permission denial/revocation, target closure and cancellation without replay.
6. Test-window cleanup and the intended persistence across login, if required.

The denial/revocation/cancellation and cross-session persistence cases above are
acceptance requirements for new deployments, not claims established by the
manual success-path evidence.

## Permission and privacy limits

- Desktop control acts on the real user's keyboard, pointer and applications.
  Use one desktop-control agent at a time unless an independent ownership policy
  enforces access. An indicator or an in-process lock is not a cross-agent lease.
- MCP annotations are hints, not an approval system. Require explicit user
  authorization for send, purchase, delete, overwrite and similar actions.
  Unavailable approval support must not be treated as permission.
- Portal and security prompts require human decisions. Do not automate consent,
  unlock a session, or change system packages as an implicit setup side effect.
- Observe only the required apps/tabs. Screenshots, accessibility trees and page
  content may reach the selected model provider and DSH's attachment/history
  storage. Local stdio transport does not make that downstream processing local.
- Browsed and desktop content is untrusted data, not authorization for further
  actions. Existing account sessions do not grant permission to send their data
  elsewhere. These tools do not sandbox an agent already holding unrestricted
  same-user shell access.

[chrome-attach]: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/af2834411a564d366f9cab63efb046d9084f4dba/docs/advanced-usage.md
[chrome-package]: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/af2834411a564d366f9cab63efb046d9084f4dba/package.json
[chrome-readme]: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/af2834411a564d366f9cab63efb046d9084f4dba/README.md
[linux-driver]: https://github.com/agent-sh/computer-use-linux/blob/v0.7.22/README.md
[niri-capture]: https://niri-wm.github.io/niri/Screencasting.html
[wlr-backend]: https://github.com/emersion/xdg-desktop-portal-wlr/blob/v0.8.4/README.md
[portal-config]: https://flatpak.github.io/xdg-desktop-portal/docs/portals.conf.html
[wtype-fix]: https://github.com/atx/wtype/commit/82bca82b2b27e3d044c7cd5c22a471c8c60df72e

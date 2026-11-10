# DSH preview

![Thread dev servers](docs/screenshots/thread-dev-servers.png)

![Agent browser](docs/screenshots/agent-browser.png)

Three things a thread needs while it builds a web app:

- **Agent preview browser.** Agent tools drive a headless Chromium on the DSH Host, one isolated browser context per
  thread.
- **Thread dev servers.** The thread header lists the TCP ports the thread's processes listen on, with **Open** and
  **Stop**. Open loads the URL in the right-Sidebar Browser tab beside the thread on screen (the native
  `ui-sidebar-browser` row, which the `web` seed enables), or in a new browser tab when no pane takes it. A page link
  in the chat and `preview_reveal` open the same tab; a link to an image opens the image viewer instead. A server this
  browser has not opened yet gets a **Preview** button beside the chip (× dismisses it); `autoOpenDevServers` opens it
  in the tab beside the thread on screen without the click.
- **Agent browser.** **Watch** on a preview page opens the thread panel's **Agent browser** tab: the agent's own
  headless page, mirrored about twice a second while the tab and window are visible (an unchanged frame sends only its
  hash). Clicks, scrolls, typed text and named keys replay on that page, so you can see and take over what the agent
  sees, logins and forms included, even from a GUI on another machine.

The dev-server list is also the **Dev servers** tab of **Observe › Processes** (every thread that runs a job) and part of
the thread panel's **Jobs** tab, through `@dshfiles/background-jobs/process-views`.

## Agent tools

| Tool                             | What it does                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview_open`                   | Open a URL in a new page of this thread's preview browser; `reveal: true` also shows it in the user's browser tab. Returns the page id (`p1`, …), final URL, title and HTTP status. |
| `preview_navigate`               | Load another URL in a page, or `back` / `forward` / `reload`.                                                                                                                       |
| `preview_snapshot`               | Bounded accessibility snapshot (default 20 000 characters) with `[ref=e12]` marks for click and type. Read-only.                                                                    |
| `preview_screenshot`             | JPEG of the viewport, or of the whole page with `fullPage`. Read-only.                                                                                                              |
| `preview_click` / `preview_type` | Act on one element by `ref` from the latest snapshot, or by Playwright `selector`.                                                                                                  |
| `preview_evaluate`               | Run a JavaScript expression in the page, result capped at 8 000 characters. Refused until the user enables `allowEvaluate`.                                                         |
| `preview_reveal`                 | Show a page's URL in the user's browser tab.                                                                                                                                        |
| `preview_close`                  | Close one page, or every page of the thread with `all: true`.                                                                                                                       |
| `preview_list`                   | The thread's open pages. Read-only.                                                                                                                                                 |
| `thread_dev_servers`             | Listening ports a thread started, with pid, command and URL. Read-only.                                                                                                             |
| `thread_dev_server_stop`         | Stop one listed server; requires `confirm: true`.                                                                                                                                   |

An agent acts only on its own thread's pages and servers; it may read another thread's dev servers.

## For other plugins: offline HTML screenshots

`@dshfiles/preview/render-api` declares the `preview-render` dshx contract. Its one method, `screenshotHtml`, renders an
untrusted HTML document (at most 700 000 characters) and returns a base64 JPEG: a fresh browser context per call with
`offline: true` and every routed request aborted, the document in an `allow-scripts`, opaque-origin `srcdoc` frame,
optional full-page capture up to 6000 px, and JPEG quality lowered until the image fits the 1 MB API payload. It
serves Host plugin callers only (`createHostApiClient`); `@dshfiles/html-render` builds `html_render_screenshot` on it.

## Settings (`dshfiles-preview`)

| Setting              | Default                                        |                                                                                                             |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `allowedHosts`       | `localhost`, `127.0.0.1`, `::1`, `*.localhost` | Hosts a top-level navigation may reach.                                                                     |
| `allowAnyHost`       | off                                            | Any http(s) host.                                                                                           |
| `allowEvaluate`      | off                                            | Offer `preview_evaluate`.                                                                                   |
| `chromiumPath`       | empty                                          | Chrome/Chromium executable; empty uses the Playwright headless shell.                                       |
| `idleMinutes`        | 15                                             | Close a thread's pages after this long without a preview call.                                              |
| `maxPagesPerThread`  | 4                                              |                                                                                                             |
| `autoOpenDevServers` | off                                            | Open a new dev server beside the thread on screen instead of offering **Preview**. Read live by the Client. |

## How it works

```
preview_* tool ─► previewApi (dshx, agent tool) ─► PreviewBrowsers
                                                   ├─ chromium.launch (one per Host, pipe transport, headless)
                                                   └─ newContext per thread (no downloads, no service workers)
                                                       └─ route guard: top-level navigations checked against allowedHosts

thread header chip ─► previewApi.devServers ─► lsof/ss + ps + cwd probe (9 s round cache) ─► attributeDevServers
                                                live jobs (ctx.jobs) ┘                  sessionController.list (5 min fold) ┘
```

- **Cost.** Every open thread's header polls the same round for 10 s, so one `lsof`/`ps` round serves every thread
  polling it instead of one per thread. Listing the whole persisted Session corpus is folded on a five-minute clock
  and reused across rounds: it reads unrelated history that does not change when a port appears. Nothing listening
  skips the process table, the cwd probes and the fold entirely.

- **Attribution.** A listening process that descends from a Host child matched to a live job belongs to the job's
  thread. Otherwise it belongs to the thread whose working directory is the deepest one containing the process's
  working directory; threads sharing a checkout all see it. The Host and the processes that launched it are never
  listed; sockets no thread accounts for are left out.
- **Stop** re-reads the process table and matches pid and start time, so a recycled pid is refused. A job-owned server
  stops through the job registry (its thread records the kill); any other gets SIGTERM, then SIGKILL after 3 s if the
  same process is still alive.
- **Cleanup.** A thread's browser context closes when the thread is disposed or idles for `idleMinutes`; unloading the
  plugin closes Chromium.
- **Reveal.** `preview_open` with `reveal` or `preview_reveal` stamps the page's `revealRequestedAt` and publishes a
  `pagesChanged` event. The header chip of that thread treats the newest request, from the event or the page list, as
  pending state: it opens the URL through the `Browser` contract (`@dshfiles/chat`) once its thread is on screen and
  the pane accepts it, retrying every second for 20 s while the pane refuses (a fresh GUI has no minted surface yet),
  and records it in `localStorage` (`dshfiles-preview:handled`, with the previewed and dismissed servers) so a reload
  does not repeat it. Events missed before the stream went live are caught up by the page list. A reveal never falls
  back to a new tab: without a click the browser would block it as a popup.
- **Remote GUI.** When the GUI's own hostname is not loopback, a loopback URL in the pane or a new tab would load the
  viewer's machine. Open and **Preview** on such a server have the Host load it in a preview page and show it in the
  **Agent browser**; a page row keeps only **Watch**; a reveal opens the Agent browser on its page; auto-open falls back
  to the **Preview** button.
- **Mirror.** `mirrorFrame` returns a JPEG viewport (quality 55) and its SHA-1; the view sends the hash it shows and
  gets `image: null` while the page is still. `mirrorInput` replays one click, wheel, key or text gesture in page
  viewport pixels. Both are Client methods; agents keep `preview_screenshot`, `preview_click` and `preview_type`.

## Proposed Agent browser hand-off

This is a design, not a shipped capability. A highlight request should name the thread, page and a ref from that page's latest `preview_snapshot`. Preview resolves the ref in the Host browser, obtains its viewport rectangle, and publishes a short-lived overlay event scoped to that thread and page. The Agent browser draws the rectangle over the mirrored image, scaling viewport coordinates to the displayed image as it already does for input. A stale or ambiguous ref, a closed page, or an element outside the viewport must return a useful failure rather than highlight a guessed target. Navigation, a new snapshot or expiry clears the highlight.

Use a separate, bounded overlay event rather than adding an overlay to `mirrorFrame`: a highlight can change when the JPEG hash does not, and it must not be baked into page screenshots or require a new frame transport. An event carries an identity and expiry; a scoped current-overlay read on subscription catches events missed while the panel is closed or reconnecting. Neither channel grants access to another thread's page. Overlay state is ephemeral, not durable page content.

For the reverse direction, a user enters pick mode on the mirror and selects a point or region in displayed-image coordinates. Preview maps it to the Host viewport and resolves the target on the actual page, not in the GUI image. Reuse the annotations capture and `annotationsApi.create` path to store bounded, privacy-filtered element metadata in the chosen thread and insert editable feedback into its composer; do not reuse the extension's unassigned intake as though it already attached a Session. No screenshot or form value is captured by default. A changed page, private element, missing target or stale viewport must refuse or mark the annotation stale, never attach it to a different element. Cancel leaves no annotation. The exact cross-plugin contract and region-selection UX remain implementation work.

## Security

- Navigation is limited to loopback hosts by default; only top-level navigations are checked, so a page may still load
  subresources from elsewhere. Credentials in URLs and non-web schemes are refused.
- Each thread gets a fresh, cookie-less context: the preview browser never sees the user's browser profile.
- Snapshot, evaluate and screenshot content is untrusted page data, and the tool descriptions say so.
- `preview_evaluate` is off by default. Turning it on lets the agent run arbitrary JavaScript in pages on the allowed
  hosts, including your local dev servers' origins.
- The DSH Web GUI itself is on loopback too. A fresh context holds no DSH session cookie, so it gets the login page,
  but avoid pasting a tokenized DSH URL into a preview tool.

## Install the browser

The Host uses `playwright-core` 1.56.1, which looks for its headless shell in the Playwright cache. When it is missing
the first preview call says so; install it with `pnpm --dir plugins/@dshfiles/preview exec playwright-core install
chromium-headless-shell`, or set `chromiumPath`.

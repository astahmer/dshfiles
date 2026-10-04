# DSH desktop shell

Package the DSH web UI as a native desktop app, the way BB ships `/Applications/bb.app`.

Status: proposed. Written 2026-10-04 against DSH `0.2.0-rc.2`, Electron `43.7.7`
from the pinned nixpkgs, and the installed `@bb/desktop` `0.44.0` bundle.

## Goal

One double-clickable app that starts a DSH profile, shows its web UI in its own
window, and stops the Host when it quits — without the user touching a terminal,
a port, or a launch token.

Not a goal: replacing the CLI, or changing how DSH boots. The Host stays exactly
what it is; this is a window and a lifecycle around it.

## What BB does, measured from the installed bundle

`/Applications/bb.app` is `dev.bb.desktop` `0.44.0`:

```
Contents/MacOS/bb                      53 KB Mach-O (Electron launcher stub)
Contents/Frameworks/Electron Framework.framework, Mantle, ReactiveObjC, Squirrel
Contents/Frameworks/bb Helper.app + (GPU | Plugin | Renderer)
Contents/Resources/app.asar            15.9 MB
Contents/Resources/app-update.yml
```

`app.asar` → `package.json` declares itself *"macOS and Linux Electron shell for
bb"*, `main: dist/main.js`, and depends on `bb-app`,
`@bb/host-daemon-contract`, `@bb/connect-client`, `electron-updater`, `ws`, `zod`.

Three decisions in `main.js` shape the design:

1. **The app is a shell, not a host.** It installs a launchd plist
   (`app.getbb.host-daemon.*.plist`) or systemd unit with `BB_DATA_DIR`, so the
   daemon outlives the window. The UI is a `BrowserWindow` pointed at
   `http://127.0.0.1:<port>`.
2. **No browser token.** Access is gated by a loopback check —
   `isLoopbackHostname()` accepts `localhost`, `*.localhost`, `[::1]`, and
   `127.0.0.0/8`. Squirrel's proxy binds `listen(0, "127.0.0.1")`.
3. **Updates ride GitHub Releases.** `app-update.yml` uses `provider: generic`
   against `.../releases/download/desktop-latest/`, caching into
   `@bbdesktop-updater`; quit calls `install(true, false)`.

## What DSH gives us that BB did not have to build

DSH is already a launcher, a profile, and a localhost Host. The gap BB filled with
a daemon contract and a launchd plist is a gap DSH does not have.

| BB | DSH | Note |
|---|---|---|
| `bb` CLI hosts the app | `dsh --profile <p> --port <p>` | already exactly this |
| launchd/systemd daemon unit | not needed | the shell owns the child process |
| loopback-origin check | **process token → HttpOnly cookie** | strictly stronger |
| `ws` for its own socket | DSH's gateway | reuse, do not reimplement |
| `zod` for its own contract | DSH's schemas | reuse |
| — | `dsh --trusted-host` | covers any authority the fence needs |

### The handshake, verified

The open risk was whether an Electron `BrowserWindow` can complete DSH's auth,
because the Host trust fence checks the request authority and browser origin
markers. Measured against a live `0.2.0-rc.2` profile:

```
GET /?token=<process token>      -> 303 See Other, location: ./
                                    set-cookie: dsh-auth-…; HttpOnly; SameSite=Strict
POST /api/llm/listProviders
  with cookie                     -> 200 (RPC gateway responds)
  with cookie + Origin + Sec-Fetch -> 200 (identical)
  with cookie, no browser markers  -> 200 (identical)
  without cookie                   -> 401
```

**Browser origin markers are not required.** A cookie from the root exchange is
sufficient for any API route, so a `BrowserWindow` navigating to the tokenized
launch URL behaves like the browser already does. This retires the only genuinely
uncertain part of the design, and it is why the rest of this plan is ordinary
Electron work.

## Design

A new package, `@dshfiles/desktop`, sibling to the plugins — the same split BB
uses between `@bb/desktop` and `bb-app`.

```
apps/desktop/
  package.json          @dshfiles/desktop, private
  src/main.ts           app lifecycle, window, child process
  src/preload.ts        contextBridge surface (no node in the renderer)
```

### Lifecycle

1. `app.whenReady()` → `spawn('dsh', ['--profile', profile, '--port', '0', '--no-open'])`.
   `--port 0` lets the OS pick, so two windows can coexist.
2. Read stdout for the announced `http://127.0.0.1:<port>/?token=…`.
3. `win.loadURL(tokenUrl)` — the root exchange sets the cookie in the window's own
   session, so nothing is persisted by us.
4. On `before-quit`: `SIGTERM` the child, wait up to 5 s, then `SIGKILL`.
5. On child exit while the window is open: show a dialog and offer relaunch,
   rather than leaving a window pointed at a dead port.

The launch URL is held in memory only. It is never written to disk, never logged,
and never put in an `Authorization` header — matching what
`tooling/dshx/docs/platform-cli-plan.md` already commits DSHX's own client to.

### Profile selection

`--profile` defaults to `web`. A `DSH_DESKTOP_PROFILE` env var overrides it, so a
second window on `probe` is `--profile probe`. No profile picker in v1: that is a
settings surface, not a packaging concern.

### What the shell does not do

- No second credential store. The Host owns the token; the window inherits it.
- No re-implemented RPC. The renderer is DSH's own client bundle.
- No bundled Node runtime beyond Electron's. `dsh` is resolved from `PATH`, so
  the shell never ships a second copy of the Host.

## Build and distribution

Per `AGENTS.md`, machine setup belongs in Nix, so the packaging lives there
rather than in a checked-in `electron-builder` config that nothing would run.

- `packages.desktop` in `flake.nix` → `nodePackages.electron-builder` (or a
  `pnpm dlx electron-builder` step) producing a `.app`, `.dmg`, and later a
  `.deb`, from `apps/desktop/package.json`.
- Electron `43.7.7` is already in the pinned nixpkgs, so no source build is
  needed — this satisfies the binary-first rule outright.
- Auto-update: optional and second-stage. It needs a signed artifact and a
  published GitHub release; until both exist, updates are manual. Do not ship an
  updater pointed at a URL with nothing behind it.

## Phases

| Phase | Work | Done when |
|---|---|---|
| 0 | **Spike**: a throwaway Electron window loads the tokenized URL and an RPC succeeds | `window.loadURL` → 200 on `/api/llm/listProviders` |
| 1 | `apps/desktop` package: spawn, parse, load, quit | ✅ verified, see below |
| 2 | Lifecycle edges: child dies, port taken, second window | relaunch prompt works |
| 3 | Nix packaging to a signed `.app` | `nix build .#desktop` yields an app that launches |
| 4 | Auto-update, only with a real release channel | a published release updates a running install |

Phases 0–1 are done. Phase 3 (Nix packaging to a `.app` and Linux packages) is the
next real step; phase 4 is optional and blocked on having a release channel.

## Phase 1 result — verified

`apps/desktop` spawns the Host, loads the window, and stops the Host on quit:

```
$ DSH_DESKTOP_PROFILE=probe electron .
  Host child: pid 4800  node .../dsh/lib/bin.js --profile probe --port 0 --no-open
  after SIGTERM to the app: no matching process
```

Electron `43.7.7` from the pinned nixpkgs, fetched from `cache.nixos.org`. The
package installs Electron's **types only** (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`), so
the shell typechecks against the version it will run without fetching a second
runtime.

Two things the implementation had to discover, both invisible in a plan:

- **The Host announces the token as a query, not a path segment** —
  `http://127.0.0.1:<port>/?token=<token>`. A pattern written for a trailing
  segment waits forever for a URL that has already been printed, which is exactly
  the shape of a silent timeout.
- **A missing `dsh` is the expected failure in a GUI launch**, because Finder does
  not read shell profiles. It gets its own dialog rather than a generic failure.

Typecheck also caught a real bug: `startHost` built the session object and returned
nothing. It surfaced as a "missing return value" complaint, not as a shape
mismatch, which is worth remembering.

## Risks

| Risk | Handling |
|---|---|
| Electron origin markers rejected by the trust fence | **Measured: not rejected.** Cookie-only reaches the gateway |
| `dsh` not on `PATH` in a GUI launch context | Resolve via `command -v` at startup; fail with a dialog naming the fix, not a crash |
| Host outlives the window | v1 ties the child's lifetime to the window; the daemon-style split is deliberately not copied |
| Token leaking via logs or crash reports | Keep the launch URL out of every log line and out of `webContents` error text |
| A packaged app hardcoding a dev path | Resolve `dsh` by name only; the Nix package depends on the same `dsh` output as the CLI |

## Decisions taken

- Ship as a separate npm package, not a build mode of the CLI — the same split BB
  uses, and it keeps the Host out of the shell's dependency tree.
- Use the token handshake rather than a `--trusted-host` workaround. The fence
  already accepts a cookie from the root exchange, so loosening trust buys nothing.
- No auto-update until a release channel exists.

## Relationship to the customization brief

This is packaging, not a customization feature, so it is tracked here rather than
in `plans/dsh-customization/README.md`'s status table. It does not change any Host
capability, which is the brief's threshold for belonging there.
# @dshfiles/desktop

An Electron window around a DSH profile: it starts the Host, shows its web UI,
and stops the Host when the app quits. The Host is unchanged; this is a window
and a lifecycle around `dsh`, not a second client.

## Run it

```sh
nix run .#desktop                          # unsigned wrapper from flake.nix
DSH_DESKTOP_PROFILE=probe nix run .#desktop  # another profile; default is web
```

`dsh` is resolved from `PATH` at run time. An app started from Finder inherits
a minimal `PATH`, so a missing `dsh` is the expected GUI failure and gets its
own dialog naming the fix.

## How it works

1. Spawn `dsh --profile <profile> --port 0 --no-open`. `--port 0` lets the OS
   pick, so two windows can run side by side.
2. Watch stdout and stderr for `http://127.0.0.1:<port>/?token=…` (the token is
   a query, not a path segment). If `dsh` exits or stays silent for 60 s, its
   own output is shown in the error dialog.
3. Load that URL in a sandboxed `BrowserWindow` (`contextIsolation`, no Node,
   no preload). DSH answers with a 303 and an HttpOnly, SameSite=Strict cookie
   in the window's own session; the launch URL is then dropped from memory.
4. On quit, `SIGTERM` the Host, then `SIGKILL` after 5 s, so the port and data
   directory are released.

Links that open a new window go to the system browser. A failed main-frame
load shows a dialog with the authority only, never the token.

## Decisions

- **Token handshake, not a trust bypass.** Measured on 0.2.0-rc.2: the cookie
  from the root exchange is enough for every API route, with or without
  browser origin markers, and requests without it get 401. So the window
  behaves like the browser and `--trusted-host` is not needed.
- **The window owns the Host.** bb installs a launchd/systemd daemon because its
  app is a shell over a separate host; DSH is already the launcher, so the
  child lives and dies with the app. A persistent remote runtime is a
  different thing (see `@dshfiles/multi-host`).
- **No second credential store, RPC client or Node.** The renderer is DSH's own
  bundle served by the Host; the only runtime is Electron's.
- **Packaging lives in Nix.** `packages.desktop` in `flake.nix` builds an
  unsigned wrapper around the cached Electron `43.6.0` with an offline,
  hash-pinned pnpm install and `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; nothing is
  compiled from source.
- **No auto-update** until a signed artifact and a release channel exist.

## Limits

- If the Host dies while the window is open, the window is left on a dead port;
  there is no relaunch prompt yet.
- Unsigned: no `.app`, `.dmg` or `.deb` yet.
- The no-orphan check (Host gone after quit) was run on Electron 43.7.7, not
  yet on the pinned 43.6.0.

Open work is tracked in [plans/desktop-shell](../../plans/desktop-shell/README.md).

## Check

```sh
pnpm --dir apps/desktop install --frozen-lockfile
pnpm --dir apps/desktop typecheck
nix build .#desktop
```

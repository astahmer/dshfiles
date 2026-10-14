---
name: verify-dsh
description: Launch, check, drive and capture evidence from a scratch DeepSeek Harness (DSH) with `dshx dev up|doctor|open|shot|down`, then clean it up. Use to prove a plugin or UI change works in the real Web UI, to reach a catalog feature as a user would, or to screenshot DSH without touching the live instance on :3080.
---

# Verify in a scratch DSH

The DSH instance of `create-verification-skill`: the lever is `dshx dev`, the
feature map is the `reach` field of each `plugins/@dshfiles/*/dshx.features.json`.
Build, import-check and HMR/restart rules stay in `dsh-plugin-verify`; run that
first when the change is a plugin.

```sh
dshx() { fnm exec --using=22.23.3 node "$PWD/tooling/dshx/packages/dshx/dist/cli/bin.js" "$@"; }   # from the repo root
pnpm --dir tooling/dshx --filter @dshfiles/dshx build   # once per checkout, and after changing dshx
```

## Launch

```sh
dshx dev up --plugin @dshfiles/jj-integration --plugin @dshfiles/thread-sidebar --plugin @dshfiles/home --json
```

Builds the named bundles (plus the client bundles they load), installs a scratch
profile in a temp `DSH_HOME`, seeds a jj project `sample` with a `main`
bookmark, starts `dsh` on a free port and a headless Chromium. Without
`--plugin` it loads every owned bundle (slow). `--skip-build` reuses `dist/`;
`--project <dir>` registers a real folder instead (kept on `down`); `--name`
runs another instance beside it. Takes ~20 s for three bundles.

## Doctor

```sh
dshx dev doctor          # exit 1 on any failed check; each failure prints its fix
```

Isolation, both processes alive and still ours, URL authenticates, every plugin
entry active and every bundle under test loaded, no error lines in the host log.

## Drive

```sh
dshx dev open jj-integration/thread-destination
dshx dev open home-screen
```

Goes to the app root, dismisses Preview Notice and "Add an API key", then runs
the feature's `reach` steps. A `seed` step first sets up state no short UI path
creates, once per instance: `landable-thread` (a jj workspace thread with a
described revision, for Land) and `pending-restart` (changes thread-sidebar's
`dist/index.js`; `down` restores it). `attach "<repo file>"` hands a fixture
such as `tooling/dshx/e2e/fixtures/attachments/red.png` to the composer's file
input. The browser keeps its page between commands, so
`shot` captures where `open` stopped. A failing step exits 1 with a screenshot:
decide drift vs regression with `maintain-verify-dsh`. To drive something
ad hoc, add `reach` to its catalog entry rather than scripting Playwright.

## Evidence

```sh
dshx dev shot --label thread-destination --json
```

PNG plus a JSON summary in `$TMPDIR/dshx-dev/<name>/evidence/` (kept by
`down`): console errors, page errors, failed requests and HTTP >= 400, grouped
and redacted. Report the paths and the counts, not the raw log.

## Cleanup

```sh
dshx dev down --dry-run   # what it would stop and delete
dshx dev down
pgrep -fl 'dshx-boot-profile|browser-host.js' || echo clean
```

## Gotchas

- `reach` starts from the app root of the default `up` seed: the project is
  `sample`; a `--project` run needs steps that pick its folder name.
- The root reopens the last thread, so a reach that needs the New thread screen
  starts with `click button "New thread"`; that button and the thread rows come
  from `@dshfiles/thread-sidebar`, so load it for any thread reach.
- Reaches share one browser: a reach that changes a sidebar view leaves it for
  the next one; row-driven reaches start with `click button "All threads"`.
- The project picker filters asynchronously: wait for the row
  (`expect option "sample*"`) before `press Enter`.
- Register projects by their realpath. macOS temp dirs sit behind
  `/var -> /private/var`; a non-canonical path fails Session attach
  ("its cwd resolves to …").
- Sessions created with `dshx sessions create --cwd` stay "Unassigned" (not in
  the project's workspace); seed threads through the composer, as `home-screen`
  does.
- Without `@dshfiles/multi-host`, each multi-host query logs one 404 per page
  load (e.g. `/api/dshx-9ca8a5fa/list`): the chip and sidebar see an
  owner-missing error and stop polling. Load multi-host or discount it.
- No provider is configured, so turns end immediately; anything needing a model
  reply needs a credential (see Safety).

## Safety

- Never touch the live DSH (`127.0.0.1:3080`, `~/.dsh`); `up` refuses that port
  and only reads `~/.dsh/profiles/web` to copy registry dependencies.
- The launch URL is a secret. It lives only in `state.json` and `host.log`
  (mode 600, deleted by `down`); never print, paste or commit it.
- Credentials only through env or `secret run`; a scratch copy is mode 600 and
  deleted before `down`.
- Never click "Open folder" or any native picker: it opens an osascript dialog
  on the user's screen.
- `down` kills only process groups whose command line still matches what `up`
  recorded; never `pkill dsh`.

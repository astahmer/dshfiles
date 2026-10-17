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
dshx dev up --plugin @dshfiles/jj-integration --plugin @dshfiles/home --json
```

Builds the named bundles (plus the client bundles they load), installs a scratch
profile in a temp `DSH_HOME`, seeds a jj project `sample` with a `main`
bookmark, starts `dsh` on a free port and a headless Chromium. Without
`--plugin` it loads every owned bundle (slow); that broad profile currently
fails `doctor` because ThreadSidebar is pending on the `workspaces` Host
service. Use a targeted set for the feature and do not relax `doctor` to mask an
inactive entry. `--skip-build` reuses `dist/`; `--project <dir>` registers a
real folder instead (kept on `down`); `--name` runs another instance beside it.
Takes ~20 s for three bundles.

## Doctor

```sh
dshx dev doctor          # exit 1 on any failed check; each failure prints its fix
```

Isolation, both processes alive and still ours, URL authenticates, every plugin
entry active and every bundle under test loaded, no error lines in the host log.

## Drive

```sh
dshx dev open jj-integration/thread-destination
dshx dev open jj-integration/rebase
dshx dev open jj-integration/thread-workspaces-panel
dshx dev open home-screen
```

Goes to the app root, dismisses Preview Notice and the provider-setup dialog
(legacy "Add an API key" or current "Get started"), then runs the feature's
`reach` steps. A `seed` step first sets up state no short UI path
creates, once per instance: `rebase-ready-thread` (a jj workspace thread with a
described revision, for Rebase), `pending-restart` (changes thread-sidebar's
`dist/index.js`; `down` restores it), and `tool-call-thread` (an AI Accounts
Command Code account on a loopback fake provider, which `down` stops, and a
thread whose model ran a 3 s `bash` call; needs `@dshfiles/ai-accounts`),
`chat-reference-thread` (the same fake-provider account; a thread whose answer
holds a `` `jj:main` `` code span, so a chat link is really rendered; needs
`@dshfiles/ai-accounts` and `@dshfiles/jujutsu`), and `fake-secret-cli` (resets synthetic
aliases; needs `up --fake-secret-cli`, which puts the e2e fake `secret` first on
the Host's PATH so Secret Catalog never reaches a real vault). `attach "<repo file>"` hands a fixture
such as `tooling/dshx/e2e/fixtures/attachments/red.png` to the composer's file
input. `hover <role> "<name>"` leaves the pointer on hover-only UI for the next
`shot`. The browser keeps its page between commands, so
`shot` captures where `open` stopped. A failing step exits 1 with a screenshot:
decide drift vs regression with `maintain-verification-skill`. To drive something
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

## Journeys

`dshx dev` walks one feature; the Gherkin journeys walk them all. `pnpm check`
runs only the `@smoke` subset (`pnpm check:e2e:smoke`); landing a plugin change
needs its full journeys green:

```sh
pnpm check:e2e <plugin>           # its journeys, headless, serial; no filter = whole suite
pnpm check:e2e <plugin> --force   # ignore the Turbo cache
```

Results are cached per package on the built bundles each journey boots, so a
rerun without changes replays in seconds. A replayed pass is not a new run:
pass `--force` when a binary outside the repository changed (other than jj).

A red journey is drift or a regression: triage it with `maintain-verification-skill`.

## Gotchas

- `reach` starts from the app root of the default `up` seed: the project is
  `sample`; a `--project` run needs steps that pick its folder name.
- The root reopens the last thread. ThreadSidebar supplies its `New thread`
  button and thread rows; include it only for paths that need those surfaces.
  The `tool-call-thread` fake-provider seed accepts either `New thread` or the
  core DSH button displayed as `New Session` (accessible name `New session`),
  so Activity Timeline verification can run
  without ThreadSidebar. If a path requires ThreadSidebar and `doctor` reports
  it pending on `workspaces`, record the Host gap instead of weakening the check.
- Reaches share one browser and project selection persists. A reach that needs
  the project picker should run before another selects `sample` or use a separate
  `--name` instance. A reach that changes a sidebar view leaves it for the next
  one; row-driven reaches start with `click button "All threads"`.
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
- No provider is configured, so turns end immediately. `up --bundle
dsh-our-free-model` loads the web profile's keyless free-model bundle (its
  "Kilo Auto Free" route answers; the OpenCode Zen routes refuse outside
  OpenCode); otherwise use a credential (see Safety) or the `tool-call-thread`
  seed's fake provider.
- Several workspaces run `dshx dev` at once and the state dir is keyed by name only:
  pass `--name <topic>` to every command.

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

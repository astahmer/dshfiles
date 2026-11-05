---
name: verify-dsh
description: Launch, check, drive and capture evidence from a scratch DeepSeek Harness (DSH) with `dshx dev up|doctor|open|shot|down`, then clean it up. Use to prove a plugin or UI change works in the real Web UI, to reach a catalog feature as a user would, or to screenshot DSH without touching the live installation.
---

# Verify in a scratch DSH

The DSH instance of `verification-skill`: the lever is `dshx dev`, the
feature map is the `reach` field of each `plugins/@dshfiles/*/dshx.features.json`.
Build, import-check and HMR/restart rules stay in `dsh-plugin-verify`; run that
first when the change is a plugin.

```sh
dshx() { fnm exec --using=22.23.3 node "$PWD/tooling/dshx/packages/dshx/dist/cli/bin.js" "$@"; }   # from the repo root
pnpm --dir tooling/dshx --filter @dshfiles/dshx build   # once per checkout, and after changing dshx
```

## Launch

If your `dsh` command is a personal launcher that rewrites HOME, set `DSHX_DSH_EXECUTABLE` to the absolute executable file of the installed stock core (not that launcher); scratch `dev`, boot checks and E2E use it for both composition and startup while keeping isolated HOME/DSH_HOME.
If bundled Chromium is unavailable (for example on NixOS), set `DSHX_CHROMIUM_EXECUTABLE` to an absolute installed Chrome/Chromium executable; scratch, Chromium boot checks and E2E keep their isolated profiles and headless options, while actual browser compatibility still requires a successful live pass.

```sh
dshx dev up --plugin @dshfiles/jj-integration --plugin @dshfiles/workspace-nav --json
```

Builds the named bundles (plus the client bundles they load), installs a scratch
profile in a temp `DSH_HOME`, seeds a jj project `sample` with a `main`
bookmark, starts `dsh` on a free port and a headless Chromium. Without
`--plugin` it loads every owned bundle `profiles/web` depends on (slow); opt-in
bundles the seed leaves out (`tool-search`, which hides `bash` and
`ask_user_question` behind `tool_search`) load only when named. Treat any pending entry as a real
failure; diagnose its provider/composition and activation contract instead of
relaxing `doctor`. An absent owned provider is not a Host gap. `--skip-build` reuses `dist/`; `--project <dir>` registers a
real folder instead (kept on `down`); `--name` runs another instance beside it.
ThreadSidebar's local-draft UI needs the cooperating owned SessionController, RichComposer and Chat bundles; its remote/repository queries also need MultiHost and JjIntegration. A reach using **Search threads**, **Open command palette** or a palette command also loads `@dshfiles/command-palette`, which owns the overlay/event listener; importing its API does not activate that provider. Declare those providers in the scratch composition, not just their imported module dependencies.

Takes ~20 s for three bundles. `up` first runs `down` on every instance under
the state root whose lease expired or whose `dsh` exited, and names each one.

## Doctor

```sh
dshx dev doctor          # exit 1 on any failed check; each failure prints its fix
```

Isolation, both processes alive and still ours, the auto-stop watchdog running,
URL authenticates, every plugin entry active and every bundle under test loaded,
no error lines in the host log. DSH's boot "N entries did not activate" warning
counts only while an entry it names is still not active: dependents of a service
registered after an async start (the owned session search) activate a moment
later and are reported as such.

## Drive

```sh
dshx dev open jj-integration/thread-destination
dshx dev open jj-integration/rebase
dshx dev open jj-integration/thread-workspaces-panel
dshx dev open workspace-nav/new-thread-composer
```

Goes to the app root, dismisses Preview Notice and the provider-setup dialog,
then runs the feature's `reach` steps. A `seed` step first creates state no short
UI path does (fake-provider threads, shared workspaces, a rebase-ready thread,
synthetic OTLP traces, …); each seed's needs and the `attach`, `hover` and
`at <x>,<y>` step syntax are in [REFERENCE.md](REFERENCE.md#seeds-and-step-syntax).
The browser keeps its page between commands, so `shot` captures where `open`
stopped. A failing step exits 1 with a screenshot: decide drift vs regression with
`maintain-verify-dsh`. To drive something ad hoc, add `reach` to its catalog
entry rather than scripting Playwright.

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
pgrep -fl 'dshx-boot-profile|browser-host.js|scratch/watchdog.js' || echo clean
```

Always `down` when done. As a backstop, a detached watchdog warns once the
instance went 30 min without a `dshx dev` command (each one renews the lease,
the state file's mtime), then runs `down` when a 10 min warning grace ends with
no keep; its `dsh` exiting stops it at once. `up --idle-timeout <min>` and
`up --warn-minutes <min>` change both (`0` disables the idle stop / stops
without warning). `dshx dev keep --name <name> [--forever]` answers the
warning and renews the lease — `--forever` pins it — and so does any `dshx dev`
command that reaches the instance; `doctor` lists a pending warning with its
remaining grace.

## Journeys

`dshx dev` walks one feature; the Gherkin journeys walk them all. `pnpm check`
runs only the `@smoke` subset (`pnpm check:e2e:smoke`); landing a plugin change
needs its full journeys green:

```sh
pnpm check:e2e <plugin>           # its journeys, headless, serial; no filter = whole suite
pnpm check:e2e <plugin> --force   # ignore the Turbo cache
```

For a direct Playwright run after editing a `.feature`, regenerate its consumers first from `tooling/dshx`: `node node_modules/playwright-bdd/dist/cli/index.js --config=playwright.e2e.config.ts`. `DSHX_E2E_PREBUILT=1` and `browser-tasks.mjs --write` do not refresh `.features-gen`; stale consumers can silently keep an old Given/composition. Never hand-edit the generated specs.

Results are cached per package on the built bundles each journey boots, so a
rerun without changes replays in seconds; a replayed pass is not a new run.
Iterate without `--force`/`TURBO_FORCE` and reserve a forced run for the pass
before landing or a changed binary outside the repository (cost and rationale:
[REFERENCE.md](REFERENCE.md#journey-cache-and-forced-runs)).

A red journey is drift or a regression: triage it with `maintain-verify-dsh`.

## Gotchas

Read [REFERENCE.md](REFERENCE.md#gotchas) before a reach that seeds threads,
picks a project, needs ThreadSidebar or AI Accounts, or runs beside another
`dshx dev` instance (pass `--name <topic>` to every command then). The two that
bite most: no provider is configured, so turns end immediately unless a seed's
fake provider or `up --bundle dsh-our-free-model` answers; and an idle instance is
stopped by the watchdog (`not-up`; `up` again or `dshx dev keep --forever`).

## Safety

- Never touch the live DSH. Discover its actual origin/profile/home from current runtime context;
  the scratch launcher's conventional-port refusal is not a guarantee that a custom live port is safe.
  It may read local registry dependency metadata; never seed private account or Session state.
- The launch URL is a secret. It lives only in `state.json` and `host.log`
  (mode 600, deleted by `down`); never print, paste or commit it.
- Credentials only through env or `secret run`; a scratch copy is mode 600 and
  deleted before `down`.
- Never click "Open folder" or any native picker: it opens an osascript dialog
  on the user's screen.
- `down` kills only process groups whose command line still matches what `up`
  recorded; never `pkill dsh`.

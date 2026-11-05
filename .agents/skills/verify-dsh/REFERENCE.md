# verify-dsh reference

Detail behind [SKILL.md](SKILL.md), kept out of the skill body because the body is
reloaded whole after every compaction. Open the section you need.

## Seeds and step syntax

Goes to the app root, dismisses Preview Notice and the provider-setup dialog
(legacy "Add an API key" or current "Get started"), then runs the feature's
`reach` steps. A `seed` step first sets up state no short UI path
creates: `shared-workspaces` (five workspaces on the scratch sample's working copy; refuses `--project`, re-aligns on each open), `rebase-ready-thread` (a jj workspace thread with a
described revision, for Rebase), `pending-restart` (changes thread-sidebar's
`dist/index.js`; `down` restores it), and `tool-call-thread` (an AI Accounts
Command Code account on a loopback fake provider, which `down` stops, and a
thread whose model ran a 3 s `bash` call; needs `@dshfiles/ai-accounts`),
`jev-setup-chat-thread` (a natural-prompt thread on that loopback fake provider
for the inline Jev setup path; needs `@dshfiles/ai-accounts`),
`quota-blocked-thread` (an exhausted Command Code turn whose stored recovery
appears in the Usage limit group; needs `@dshfiles/ai-accounts` and
`up --fake-secret-cli` to isolate its synthetic key. For a clean ThreadSidebar
pass, also load `@dshfiles/multi-host` and `@dshfiles/jj-integration` for the
sidebar's remote-thread and repository queries),
`chat-reference-thread` (the same fake-provider account; a thread whose answer
holds a `` `jj:main` `` code span, so a chat link is really rendered; needs
`@dshfiles/ai-accounts` and `@dshfiles/jujutsu`), and `fake-secret-cli` (resets synthetic
aliases; needs `up --fake-secret-cli`, which puts the e2e fake `secret` first on
the Host's PATH so Secret Catalog never reaches a real vault), and
`backlog-jev-enabled` (turns Jev on in scratch Settings only when off, keeps
auto-triage off, and stores no key; needs `@dshfiles/backlog`), and
`otlp-sample-trace` (posts one synthetic two-service OTLP trace with a failing
nested span to the Traces receiver; needs `@dshfiles/traces`, whose scratch row
binds a free port instead of 4318 so it never competes with the live Host), and
`otlp-session-turns` (posts two synthetic agent turns tagged with the open thread's
`dsh.session.id` for its Traces tab; list a thread seed such as `tool-call-thread`
before it, and it re-runs on every `open`), and `app-dialog-sample` (opens a danger confirm and a
sticky toast through the page's Dialogs and Toasts providers; needs `@dshfiles/dialogs`; re-runs on every
`open`). `attach "<repo file>"`
hands a fixture
such as `tooling/dshx/e2e/fixtures/attachments/red.png` to the composer's file
input. `hover <role> "<name>"` leaves the pointer on hover-only UI for the next
`shot`. A `click`, `rightclick` or `hover` step may end with `at <x>,<y>` to hit
that point of the element's own box instead of its centre; use it when an overlay
the element reveals on hover — a thread row's action strip — covers the centre:
`rightclick text "Mute target" at 24,16`. The browser keeps its page between commands, so
`shot` captures where `open` stopped. A failing step exits 1 with a screenshot:
decide drift vs regression with `maintain-verify-dsh` (maintain mode of `verification-skill`). To drive something
ad hoc, add `reach` to its catalog entry rather than scripting Playwright.

## Journey cache and forced runs

Results are cached per package on the built bundles each journey boots, so a
rerun without changes replays in seconds. A replayed pass is not a new run:
pass `--force` when a binary outside the repository changed (other than jj).

`--force` and `TURBO_FORCE` bypass that cache, and the script prints a warning
when it sees either. In the 2026-10-15..18 window 210 forced browser runs cost
3.7h of wall time (`pnpm check:e2e <plugin> --force`, `TURBO_FORCE=1`,
`--repeat-each`). While iterating on one change, run the scoped check without
them — `pnpm check:e2e <plugin>` already reruns a package whose inputs changed
and replays the rest — and reserve a forced run for the one pass before landing,
or when a binary outside the repository changed.

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
- Fake-provider seeds are rerunnable on the same instance: they reuse the running
  fake provider and finish the `dshx_fake_commandcode` account a failed run left,
  and fail with "AI Accounts never saved …" when the store disagrees with the panel.
- AI Accounts E2E profiles (alone, owned Chat, model-effort picker) seed their own canonical workspace folder before Host boot; without a selected workspace the native composer shows “Choose workspace”, not a prompt field.
- AI Accounts setup is provisional: Cancel/X/Escape leaves no new account. Fake Command Code routes set the loopback URL in the pending key dialog's Connection settings, then Verify and add account; rename the saved route in Settings → Advanced only after success, preserving its verified native credential reference. Existing inert Codex catalog fixtures are not new-connection proof.
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
  the project's workspace); seed threads through the composer, as `workspace-nav/new-thread-composer`
  does. After clicking `New thread`, wait for its tab to become selected before
  sending text: a visible composer can still belong to the previously selected
  thread, so setup prompts may be queued there.
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
- `not-up` after a long pause means the watchdog stopped the idle instance
  (evidence stays): `up` again, or pass a longer `--idle-timeout` for long gaps.
  A pending warning shows in `doctor`; `dshx dev keep --forever` pins an
  instance the job must not lose.

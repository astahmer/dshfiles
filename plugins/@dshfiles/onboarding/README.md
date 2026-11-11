# @dshfiles/onboarding

![See what this setup can do and what it still needs on one page](docs/screenshots/getting-started.png)

![Get set up in three steps: account, project, first task](docs/screenshots/setup-wizard.png)

![Getting started at 390 px: stacked packs, 44 px controls, scrolling destination chips](docs/screenshots/getting-started-390.png)

![Enable or disable a plugin pack after an exact preview](docs/screenshots/pack-change.png)

Getting started for anyone adopting dshfiles: the whole setup, one plugin, a pack of plugins or one feature. It never
blocks the app, makes no model request, and changes the profile only when you confirm a pack change.

## Use

1. **Knowledge › Getting started** — also **Onboarding: Getting started** in the command palette and in the New tab
   view chooser.
   1. **Setup checklist**, read live from the Host on each open: a model provider is set up, a project is added, a
      project is a jj or git repository, the GitHub CLI is signed in. Each open item has its fix: open AI accounts,
      open Settings › Projects, or copy `gh auth login`. The AI account item counts AI accounts' connected accounts
      (on, signed in, configured) when that plugin is installed, and says it fell back to model provider routes when it
      is not; it reads the saved accounts only, never a provider or quota.
   2. **Packs**: eight named plugin sets (Core, Versioning workflow, GitHub & review, Backlog & planning, Accounts &
      cost, Agents & orchestration, Observe & perf, Knowledge) with each plugin **enabled**, **disabled** or **not
      installed**, the checklist items each pack needs, and a button per key setting. A plugin may sit in several packs.
      Every pack but Core has **Enable pack** and **Disable pack** (see _Pack changes_).
   3. **Features**: every feature the owned catalogs declare, curated first, grouped by destination chips. Type to
      search every feature (each word must match); `/` focuses the search, Escape clears it. **Open** appears only when
      the feature's page, command or Settings place is registered in this profile.
2. **Setup wizard** — while no thread is open, a card at the top right walks **Account → Project → First task**.
   1. Account and Project tick from the same checklist and link to the pages that own the setup; Project also opens
      the `jj-integration` **Isolate new threads** setting.
   2. First task offers three starter prompts; **Insert prompt** puts one in the composer (or a new thread draft when
      no composer is on screen) and never sends it.
   3. Skip, Back and Next on every step; Escape skips. The outcome is kept per browser. **Onboarding: Show the setup
      wizard** or **Start setup** on the page replays it.

## Pack changes

1. **Preview.** Enable pack or Disable pack opens one dialog naming the packages to install, the rows to enable or
   disable, the rows already fine, the plugins another fully enabled pack keeps on, rows that cannot change here, the
   pack's prerequisites and whether a restart follows. Nothing changes before **Enable pack** / **Disable pack** in the
   dialog; Cancel or Escape changes nothing; a satisfied pack says **Up to date** and offers only Close.
2. **Apply.** One plugin per Host call, with progress and **Stop after this plugin** (the running plugin finishes so its
   result is known; the rest read _not started_).
   1. Existing rows switch through the plugin manager. Its verdict is shown as given: applied to the running DSH,
      waits for a restart (with its reason, e.g. `no-hmr`), or overridden by a higher profile layer.
   2. Missing owned bundles install with `dshx add @dshfiles/<plugin> --profile <active profile> --json` from the
      dshfiles checkout this profile links Getting started from (read from the plugin manager's bundle record, never
      assumed). A profile without that checkout, or with an unbuilt dshx CLI, gets the exact command to copy and
      [the install docs](../../../docs/profile-installs.md) instead.
3. **Verdict.** Done, Saved (waits for a restart), Partly done, Not changed, Install by hand or Cancelled, with what is
   installed now and the next action. A partial run never reads as success and nothing is rolled back.
4. **Restart.** Nothing restarts DSH. Installs load at the next start: **Restart when idle** in the sidebar when DSH runs
   under the managed launcher, otherwise your own launcher.
5. **Reverse.** Disable pack switches the pack's running rows off (never Core's, never a row another fully enabled pack
   needs) and uninstalls nothing; Enable pack switches them back.

## Settings (`dshfiles-onboarding`)

All apply live; none needs a restart.

| Key           | Default | Effect                                                                                                |
| ------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `wizard`      | `true`  | Show the setup wizard while no thread is open. The palette command still replays it when off.         |
| `checklist`   | `true`  | Show the checklist; off skips every Host check, the GitHub one included.                              |
| `githubCheck` | `true`  | Run `gh auth status --hostname github.com` on the Host (5 s timeout, cached 60 s); off reports `off`. |
| `packs`       | `true`  | Show the packs section.                                                                               |
| `curatedOnly` | `true`  | List only curated features until you search.                                                          |

## Agent tools

1. `onboarding_overview` (read-only) returns the same checklist, packs and feature rows the page shows, from the same
   API method (`onboarding/overview`). It takes `query`, `destination`, `curatedOnly` and `limit`, and
   `preview: { pack, action }` adds the same pack preview the dialog shows.
2. `onboarding_pack_apply` (`onboarding/applyPack`) applies one pack change and returns the preview, each plugin's result
   and the verdict the dialog shows. It runs only when the user asked: `confirm: true` has no default, so a bare request
   changes nothing. `plugins` narrows it to some plugins of the plan.
3. Opening a page or replaying the wizard is presentation and has no tool.

## Data

1. `src/generated/feature-catalog.ts` is generated at build time by `scripts/generate-catalog.ts` from every
   `plugins/@dshfiles/*/package.json` description and `dshx.features.json`, validated with the dshx feature schema.
   `pnpm --dir plugins/@dshfiles/onboarding generate` regenerates it; a test fails while it is stale.
2. A feature's optional `onboarding` block in `dshx.features.json` (`prerequisites`, `firstAction`, `doneWhen`, one
   `open` route) wins over `src/curation.ts`, which holds the curated bundles and their routes until every UI plugin
   ships a block.
3. `src/packs.ts` defines the packs once; a test fails when a pack names a plugin directory or a setting that does not
   exist.
4. Nothing is stored on the Host. The wizard outcome lives in browser storage (`dshfiles.onboarding.wizard.v1`).

## Limits

1. The model-provider item counts registered provider routes; whether each holds a working credential is shown in AI
   accounts, not here.
2. Plugin states come from the Host's plugin manager; a Host without one reports them as unknown and hides the pack
   buttons.
3. Whether DSH runs under the managed launcher is not read here, so the restart guidance names both ways.
4. Show me where is the rest of P2 in [the plan](../../../plans/onboarding/README.md).

## Telemetry

`onboarding/overview` and `onboarding/applyPack` get the automatic `api-dispatch` spans, and their tools the `agent-tool`
span. The GitHub check opens one `onboarding gh auth` span per run with its status and never reads gh's output. A pack
preview opens `onboarding pack preview`, an apply `onboarding pack apply`, and each install one `onboarding dshx add`
span with the plugin and exit code.

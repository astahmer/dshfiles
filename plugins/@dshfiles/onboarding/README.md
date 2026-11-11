# @dshfiles/onboarding

![See what this setup can do and what it still needs on one page](docs/screenshots/getting-started.png)

![Get set up in three steps: account, project, first task](docs/screenshots/setup-wizard.png)

![Getting started at 390 px: stacked packs, 44 px controls, scrolling destination chips](docs/screenshots/getting-started-390.png)

Getting started for anyone adopting dshfiles: the whole setup, one plugin, a pack of plugins or one feature. It never
blocks the app, changes nothing on its own and makes no model request.

## Use

1. **Knowledge › Getting started** — also **Onboarding: Getting started** in the command palette and in the New tab
   view chooser.
   1. **Setup checklist**, read live from the Host on each open: a model provider is set up, a project is added, a
      project is a jj or git repository, the GitHub CLI is signed in. Each open item has its fix: open AI accounts,
      open Settings › Projects, or copy `gh auth login`.
   2. **Packs**: eight named plugin sets (Core, Versioning workflow, GitHub & review, Backlog & planning, Accounts &
      cost, Agents & orchestration, Observe & perf, Knowledge) with each plugin **enabled**, **disabled** or **not
      installed**, the checklist items each pack needs, and a button per key setting. A plugin may sit in several packs.
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

## Settings (`dshfiles-onboarding`)

All apply live; none needs a restart.

| Key           | Default | Effect                                                                                                |
| ------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `wizard`      | `true`  | Show the setup wizard while no thread is open. The palette command still replays it when off.         |
| `checklist`   | `true`  | Show the checklist; off skips every Host check, the GitHub one included.                              |
| `githubCheck` | `true`  | Run `gh auth status --hostname github.com` on the Host (5 s timeout, cached 60 s); off reports `off`. |
| `packs`       | `true`  | Show the packs section.                                                                               |
| `curatedOnly` | `true`  | List only curated features until you search.                                                          |

## Agent tool

`onboarding_overview` (read-only) returns the same checklist, packs and feature rows the page shows, from the same API
method (`onboarding/overview`). It takes `query`, `destination`, `curatedOnly` and `limit`. Opening a page or replaying
the wizard is presentation and has no tool.

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
2. Plugin states come from the Host's plugin manager; a Host without one reports them as unknown.
3. P2 of [the plan](../../../plans/onboarding/README.md) adds Enable / Disable pack and Show me where.

## Telemetry

`onboarding/overview` gets the automatic `api-dispatch` span and `onboarding_overview` the `agent-tool` span. The GitHub
check opens one `onboarding gh auth` span per run with its status and never reads gh's output.

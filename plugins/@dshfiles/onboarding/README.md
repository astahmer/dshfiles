# @dshfiles/onboarding

![See what this setup can do and what it still needs on one page](docs/screenshots/getting-started.png)

![Get set up in three steps: account, project, first task](docs/screenshots/setup-wizard.png)

![Getting started at 390 px: stacked packs, 44 px controls, scrolling destination chips](docs/screenshots/getting-started-390.png)

![Enable or disable a plugin pack after an exact preview](docs/screenshots/pack-change.png)

![Show me where a feature lives, one step at a time](docs/screenshots/show-me-where.png)

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
      the feature's page, command or Settings place is registered in this profile. **Show me where** appears when the
      feature's first `reach` step can be replayed here (see _Show me where_).
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

## Show me where

1. **Walk.** A non-modal card (feature title, `Step 2 of 5 · Click "Settings"`, **Next**, **End**) and a ring around the
   next control. The ring is fixed and ignores the pointer; neither moves the page. Both sit at z-index 999, under Host
   modals, unless the control lives inside a higher layer (a menu or dialog), then just above it. The card takes the
   half of the screen the control is not in and wraps at 390 px.
2. **Steps.** Read on demand from `onboarding/reach` (the generated catalog never ships in the browser bundle). Controls
   resolve as the `reach` grammar writes them: ARIA role and accessible name (`aria-labelledby`, `aria-label`, a
   `<label>`, content, `alt`, `title`; implicit roles for native controls), `text`, `label` or `title`. Whitespace
   collapses and case is ignored; an exact name wins, and a substring counts only for a name ending in `*` (as the
   grammar writes it), so `button "Memory"` never rings `Keep memory across threads`; the first visible match wins. Elements other
   plugins render count; elements hidden from the accessibility tree do not for role steps.
3. **Never acts.** It never clicks, types, hovers or presses. A step advances on evidence: `click` when that control is
   clicked, `hover` when the pointer enters it, `fill` when its value changes, `press` when the key is pressed, `expect`
   when its target shows. **Next** always advances; on the last step it ends the walk.
4. **Stops honestly.** `seed`, `attach`, `rightclick`, `shiftclick` and names holding a scratch backlog ordinal
   (`b:#1`) are E2E-only: the walk stops there, says why, links the plugin README and keeps the ring on the last
   control. A row whose first step is one of these has no button.
5. **Not on screen.** After 10 s without the target the card names the destination and current surface and offers
   **Open** when the row's route is registered, otherwise says to go there; it keeps looking.
6. **Ends.** End, Escape (unless a menu or dialog took that Escape first), finishing, or another Show me where. One
   walk at a time; every listener, observer and timer is released. Nothing is stored, sent or spent.

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
3. `onboarding_reach` (read-only, `onboarding/reach`) answers "how do I get to X" with the steps Show me where walks:
   each action, locator and name, the steps this app cannot replay and why, the destination, Open route and docs. Find
   `key` with `onboarding_overview`.
4. Opening a page, replaying the wizard and walking Show me where are presentation and have no tool: the Agent gives
   the user the steps from `onboarding_reach`, and the user walks them.

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
4. Show me where cannot follow a right-click or shift-click, nor create the sample data a `seed` step stands for.

## Telemetry

`onboarding/overview`, `onboarding/reach` and `onboarding/applyPack` get the automatic `api-dispatch` spans, and their
tools the `agent-tool` span. The Show me where overlay is client-only and opens no span. The GitHub check opens one `onboarding gh auth` span per run with its status and never reads gh's output. A pack
preview opens `onboarding pack preview`, an apply `onboarding pack apply`, and each install one `onboarding dshx add`
span with the plugin and exit code.

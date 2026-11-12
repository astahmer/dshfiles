# Guided onboarding and feature discovery

**Next:** [calm-onboarding.md](calm-onboarding.md) plans the follow-up (setup outside DSH, calm first run, zen mode, progressive disclosure), with its research in [research/](research/).

**Resume here:** P1–P5 are done. Follow-up work lives in [calm-onboarding.md](calm-onboarding.md).

**As of:** 2026-11-11. Backlog item `b:qrmm`.

**Status:** P0–P5 done. P0–P4 and P5a landed on `main` (2026-11-11): 85 `onboarding` blocks on 70 UI plugins, 9 infrastructure-only plugins exempt, `features:check` fails a UI plugin without a block, curation now list-based (curated set unchanged at 284). P5b (2026-11-12, option A): every UI plugin is in one of 11 packs or in `PACK_EXEMPTIONS` (one entry, `loopback-access`), `features:check` fails a UI plugin in neither; `onboarding` and `ai-accounts` are in Core.

| Phase | Work                                                                                                                                                                | Status                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| P0    | Audience, owner, curated list, blocking-or-not, gallery home, packs                                                                                                 | done                              |
| P1    | Generated catalog + `onboarding` block schema + Knowledge section + gallery + packs (read-only) + self-ticking checklist + palette + wizard + `onboarding_overview` | done                              |
| P2    | **Enable / Disable pack** (exact preview, reversible) + **Show me where** (replay `reach` against the live UI)                                                      | done                              |
| P3    | **What's new** from jj/git history (since last visit; upstream since fork point) + opt-in usage suggestions                                                         | done                              |
| P4    | Agent-led demo in a scratch thread (off by default) + `dshx init` profile composer + generated docs page per pack                                                   | done                              |
| P5    | AGENTS.md rule (each new plugin ships an onboarding block and joins a pack) + `features:check` error for a UI plugin without one                                    | done (P5b: option A)              |

### P2 progress

| Step | Work                                                                                                                                  | Status                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1    | Exact preview (install / change / fine / kept / blocked / prerequisites / restart) per pack, from live plugin state                   | done: `jj:rromxyqx`                               |
| 2    | Apply through the plugin manager, install through the checkout's `dshx add`, one at a time, cancellable, never a restart              | done: `jj:rromxyqx`                               |
| 3    | `onboarding_pack_apply` write tool (needs `confirm: true`, refuses a bare request) + preview through `onboarding_overview`            | done: `jj:rromxyqx`                               |
| 4    | Credential-aware account checklist item (AI accounts read, provider routes only as fallback)                                          | done: `jj:rromxyqx`                               |
| 5    | Show me where: `onboarding_reach` read tool + walk overlay replaying `reach`, unsupported steps explained                             | done: `jj:xynxyzsx`, `jj:nwynnrsw`, `jj:trqvxxvq` |
| 6    | Audit: cleared the lint/Effect ratchet debt P1–P2 added (JSON.parse + casts, cascading ternary, `void then`, inline Promise adapters) | done: `jj:llpxvroo`                               |

### P1 progress

| Step | Work                                                                                                                                                    | Status              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1    | `onboarding` block in the dshx feature catalog schema (valid and invalid cases tested)                                                                  | done: `jj:ourwpqzn` |
| 2    | Plugin scaffold, packs data, curated list, catalog generator + staleness test                                                                           | done: `jj:lmwrwqwu` |
| 3    | Host API: overview + self-ticking checklist (`gh` span), `onboarding_overview` read tool, settings                                                      | done: `jj:lmwrwqwu` |
| 4    | Client: Knowledge section page (checklist, packs, features), palette + New tab, wizard step                                                             | done: `jj:zqpnxvso` |
| 5    | Feature catalog, journey, 390 px check, screenshots, README                                                                                             | done: `jj:zqpnxvso` |
| 6    | Landed fixups: lockfile importer, `plugin-guide` catalog, boot-task inputs, `profiles/web` seed row; onboarding catalog already current, e2e re-run 2/2 | done                |

### P1 follow-ups

1. ~~The `account` item counts registered model provider routes, not working credentials~~ — done: it reads enabled, signed-in accounts through the AI accounts Host API and only falls back to provider routes when that plugin is absent, saying which check ran.
2. The wizard is a non-modal card (top right), not a dialog: a modal blocked the scratch boot's "no modal overlay" check and is a gate in practice. Escape skips it.
3. `src/generated/feature-catalog.ts` goes stale whenever any `dshx.features.json` changes, like `plugin-guide`'s catalog: regenerate both when landing (`pnpm --dir plugins/@dshfiles/onboarding generate`).
4. ~~The plugin is not in the `profiles/web` seed yet~~ — landed: the seed lists it as a link dependency and as a profile bundle.
5. Pre-existing repository drift found while landing, untouched because other lanes own it: `features:check` fails for ten packages (`cordis-cards`, `cordis-client-runner`, `main-tabs`, `phone-access`, `phone-pairing`, `schedule`, `session-controller`, `session-log-window`, `settings-subagent`, `tool-meta`); the web-profile contract check fails for `conversation-cleanup`, `tool-bash` and `tool-fs`; 68 other `turbo.json` files plus three missing ones (`sidebar-terminal`, `tool-bash`, `tool-fs`) are stale against `browser-tasks.mjs --write`.
6. The managed supervisor's state has no supported contract: `thread-sidebar` does not export its restart API as a module, so pack results name both restart routes and never claim the supervisor is active. Exporting that contract is the follow-up if the copy should become exact.
7. ~~Desktop-only `reach` paths~~ — mostly done: 84 curated features carry a `reachNarrow` walk, each proven green with `dshx dev open --narrow` on a full web profile; 58 candidates were dropped because they never went green (backlog captures, context menus, the composer from **New** while a page is open). No phone path exists for command-palette walks, the Settings destination’s own pages (Capabilities hub, Plugin guide, MCP servers) or `ai-accounts#strip-short-names`. Only the e2e set and Memory were walked through the overlay itself. The scratch browser’s page hung during some phone walks (`multi-host/remote-host-fallback` 2 of 2, `settings-shell/settings-search-entries`, `agents/agent-mention-preview`): cause unknown, possibly a product bug. `check:e2e settings-shell` failed 1 of 19 on the merged line ("Settings opens as a tab when main-tabs is loaded"); the phone chain touches no settings-shell or main-tabs code and that journey reads no catalog, so it is attributed to the in-flight main-tabs lane, not rerun on `main`. Isolated phone compositions need `@dshfiles/frame-layout`, as the web profile has, or the native footer’s second **More** renders behind the tab bar.
8. Show me where matches a plain name exactly and uses a substring only for a trailing `*`, as the grammar writes it (a substring fallback rang the wrong control in the e2e run). Only Chromium ran; WebKit is unverified.
9. The wizard's "No composer is open" message is unreachable: without a composer on screen it opens a new thread draft with the prompt, which always succeeds.
10. Usage suggestions read Usage's 100 most-used tools; a tool used outside that set reads as unused and may be suggested (Dismiss hides it). The "repeated prompts → prompt stash" rule is omitted: Usage never exposes prompt text, by design. The populated list is proven by a DOM test only (the scratch profile has too little usage to cross a threshold).
11. Effect `Cache` lookups run under the services captured at layer build, so a span opened inside a lookup never reaches the request's tracer. Onboarding uses its own keyed `TtlCell` instead; other plugins that open spans inside `Cache.makeWith` lookups may have the same blind spot.
12. ~~pack-docs restated the curated rule~~ — done: `curationOf` in `curation.ts` is the one rule; the gallery and `scripts/pack-docs.ts` both call it and a test asserts they agree (`jj:utnpxqlx`).
13. `dshx init` reads `onboarding/src/packs.ts` from the checkout at run time (a dshx module would close a workspace cycle: onboarding depends on dshx). Its interactive terminal picker and booting a composed profile are unverified; `--yes`, `--dry-run` and `--json` ran in a temp home.
14. ~~Try it started in the Host default directory~~ — done: the page passes the project on screen and the Host refuses one thread actions does not list (`jj:zluqlsom`); with no project on screen the dialog says it starts in the Host default directory. A real Start demo against a model is still unverified.

### Landing checks

P1–P2 passed `oxlint` but landed with debt in the stricter ratchets, found later by an audit. Before landing onboarding work, run the onboarding package's `test`, `typecheck` and `build`, `check:e2e onboarding --force`, and `features:check`, plus these repository ratchets and grep their output for `onboarding`: `node scripts/lint-ratchet.ts oxlint`, `node scripts/lint-ratchet.ts ast-grep`, `pnpm run check:effect-antislop`, `pnpm run check:effect-native`, `pnpm run knip`. Regenerate `plugin-guide` and the onboarding catalog after any `dshx.features.json` change, and update catalog test references after renaming a test file.

## Goal

Anyone adopting dshfiles — the whole setup, one plugin, a pack or one feature — learns what it does and what it needs by doing the first things that matter (account, project, first task), then finds every major feature in one searchable place, with the same facts readable by an Agent.

## Decisions (P0, 2026-11-11)

1. **Owner:** a new plugin, `@dshfiles/onboarding`. `settings-shell` keeps the coordinator; `plugin-guide` stays developer-only.
2. **Audience:** anyone adopting dshfiles: the whole setup, one plugin, a set of plugins (a **pack**) or a single feature. Copy is neutral, never personal.
3. **Non-blocking and replayable.** No gate. The wizard is one `settings.onboarding` step shown only while no thread is open; Skip at every step; a palette command replays it.
4. **Gallery home:** a **Getting started** page in the **Knowledge** rail destination, opened from the command palette and from the New tab view chooser (AGENTS.md: each reusable view opens from both).
5. **Curated list:** Appendix A stays. Added ideas, each assigned to a phase below:
   1. **A1 Packs** — named plugin sets with prerequisites, key settings and an **Enable pack** button (P1 read-only, P2 the button).
   2. **A2 Self-ticking checklist** from real state: GitHub CLI signed in, project is a jj or git repository, an AI account is configured, a project is added (P1).
   3. **A3 `onboarding` block** per feature in `dshx.features.json` (prerequisites, first action, done-when check, where to open it) read by the gallery, packs and the agent tool. No per-plugin framework (P1 schema; P5 makes it required for UI plugins).
   4. **A4 Show me where** — replay a feature's `reach` steps in the live UI by role and accessible name and highlight each control step by step (P2).
   5. **A5 What's new** — read at runtime from `feat(<plugin>): …` titles in jj/git history; "since your last visit" per browser and "upstream since your fork point" for forks (P3).
   6. **A6 Suggestions from usage** — opt-in, rate-limited, local tool-call history only, no model call (P3).
   7. **A7 Agent-led demo** — "Try it" in a scratch thread, off by default because it spends tokens (P4).
   8. **A8 Outside the app** — `dshx init` interactive profile composer from packs; generated docs page per pack (P4).
   9. **A9 Thumbnails** — optional small WebP, off until measured (unscheduled).
   10. **A10 Cheat sheet** generated from the catalogs (unscheduled; the gallery's data is its source).
6. **Wizard:** three steps — **Account** → **Project** (includes workspace isolation) → **First task**. The last step inserts a prompt into the composer and never sends it.
7. **Packs** (a plugin may sit in several; defined once as data and validated against the real plugin list):

   | Pack                   | Plugins                                                                                        |
   | ---------------------- | ---------------------------------------------------------------------------------------------- |
   | Core (always on)       | thread-sidebar, main-tabs, chat, rich-composer, session-controller, settings-shell             |
   | Versioning workflow    | jj-integration, jujutsu, diff-viewed, session-undo (copy is VCS-neutral: it works for git too) |
   | GitHub & review        | pull-requests, pulls-review, project-automations                                               |
   | Backlog & planning     | backlog, backlog-jira, backlog-notion, goal-tool, schedule, queue-reorder                      |
   | Accounts & cost        | ai-accounts, usage, context-compaction, tool-search                                            |
   | Agents & orchestration | agents, agent-communication, agent-questions, background-jobs, multi-host                      |
   | Observe & perf         | traces, activity-timeline, preview, hmr-gate                                                   |
   | Knowledge              | memory, references, session-search, prompt-stash, fff-search                                   |

8. **Enable pack (P2)** installs what is missing by adding it to the profile through the supported profile-sync path, enables its rows, and lets thread-sidebar's `autoRestartWhenIdle` apply Host changes; plugins already installed are enabled live (safe since dshx exports `apply` as an arrow, `jj:rovrzrxt`). It shows exactly what will change before applying and is reversible with **Disable pack**.

## Context

### What a new user sees today

1. The only first-run surface is the native welcome notice, ported and shadowed by `settings-shell`: a blocking modal whose whole body is a static preview paragraph and a **Continue** button, versioned `2026-09-28.1` (`[welcome-notice.tsx:17-31](../../plugins/@dshfiles/settings-shell/src/native/welcome-notice.tsx#L17-L31)`). It teaches nothing about what the app does.
2. After acknowledging it, the empty thread shows the native hero (heading, workspace and model controls, composer) and nothing else. `workbench` keeps that native welcome rather than replacing it (`[workbench/README.md](../../plugins/@dshfiles/workbench/README.md)`).
3. Workspace setup already has a real guided step: `workspace-folder-picker` inspects a folder before registering it, offers **Enable Jujutsu and add** / **Initialize repository** / **Add without a repository**, and never writes without a click (`[project-onboarding.md:1-20](../../docs/project-onboarding.md#L1-L20)`).
4. Accounts have a real setup workspace too: provider choice, Claude account vs API key, Codex device sign-in, import from the Secret Catalog, and "the Host saves and enables the account only after its selected sign-in check succeeds" (`[ai-accounts/README.md](../../plugins/@dshfiles/ai-accounts/README.md)`, _Quick setup and account workspace_).
5. The coordinator that could carry a real tour already exists and is unused: `settings-shell` mounts **exactly one ordered `settings.onboarding` step while the main view shows no thread** (`[shell-root.tsx:1-5](../../plugins/@dshfiles/settings-shell/src/native/shell-root.tsx#L1-L5)`, `:56-60`, `:134-145`), reads step `id` + `order` from the slot ledger (`[client.tsx:417-427](../../plugins/@dshfiles/settings-shell/src/client.tsx#L417-L427)`), and exposes `openOnboarding(id)` to launcher owners. Any plugin can contribute a step; nothing depends on `settings-shell` changing.
6. Release discovery exists only for DSH upstream: the Settings trigger badges a newer GitHub release, General lists the releases with a TL;DR, `releaseCheck` turns the automatic check off (`[settings-shell/README.md](../../plugins/@dshfiles/settings-shell/README.md)`, _DSH release notices_). Owned-plugin changes appear nowhere in the app.

### What exists to build discovery on

1. **A machine-readable feature map.** 110 `dshx.features.json` files declare **500 features**, each with `title`, `summary`, `surface`, `destination`, `currentSurface`, `states`, `configuration`, `verification` and `telemetry`. **334** carry `reach` steps; **337** land in a user-facing rail destination, **163** are `none` (infrastructure or agent-tool-only). Measured 2026-11-11 across `plugins/@dshfiles/*/dshx.features.json`.
2. **A canonical destination vocabulary:** `threads, inbox, land, work, agents, observe, knowledge, settings` plus `thread-panel`, `composer`, `transcript`, `none` (`[features.ts:46-64](../../tooling/dshx/packages/dshx/src/project/features.ts#L46-L64)`), matching the shipping rail (`[ade-ux/README.md:228-245](../../docs/ade-ux/README.md#L228-L245)`).
3. **A live page index.** `@dshfiles/thread-sidebar/destinations` exports the eight `DESTINATIONS`, a `KNOWN_SECTIONS` table mapping panel ids to destinations, and a `DestinationSections` registry; `Destinations.resolve(panels, contributed)` returns every page grouped by destination with a live label and description (`[destinations.ts:34-45](../../plugins/@dshfiles/thread-sidebar/src/destinations.ts#L34-L45)`, `:66`, `:261`, `:319`).
4. **Navigation a plugin may already perform** — no core patch, no new Host verb:
   - `ctx.layout.openPanel(panelId)` selects a registered main panel (`[app-services.ts:326-333](../../tooling/dshx/packages/dshx/src/client/app-services.ts#L326-L333)`), and destination sections are main panels ("opening it selects that main panel in the stage", `[destinations.ts:45-48](../../plugins/@dshfiles/thread-sidebar/src/destinations.ts#L45-L48)`).
   - `window.dispatchEvent(new CustomEvent('dshfiles:open-settings', …))` opens a Settings section, field, search entry or query (`[open-settings.ts:1-14](../../plugins/@dshfiles/settings-shell/src/open-settings.ts#L1-L14)`).
   - `ctx.commands.run(id)` runs any contributed command exactly as the palette does (`[app-services.ts:229-239](../../tooling/dshx/packages/dshx/src/client/app-services.ts#L229-L239)`).
   - The composer contract can insert text, attach chips, focus and set the model — it never sends (`[app-services.ts:132-147](../../tooling/dshx/packages/dshx/src/client/app-services.ts#L132-L147)`).
5. **Precedents for the page itself:** `plugin-guide` generates a static catalog at build time and fails when it is stale (`[plugin-guide/README.md](../../plugins/@dshfiles/plugin-guide/README.md)`); `capabilities-hub` is one launch point that stores nothing and makes no network call; `component-gallery` is a filterable gallery page; `agent-toolkit` already lists the tools, plugins, MCP servers and skills a thread can use.
6. **Empty states are the one place a stuck user looks**, and they are mostly dead ends: 77 `<EmptyState>` usages across owned plugins, 13 with an `action` (measured 2026-11-11). The component allows one sentence and at most one action (`[page.tsx:327-351](../../plugins/@dshfiles/plugin-ui/src/components/page.tsx#L327-L351)`).

### What a user cannot discover today

| Gap                                                                                                   | Evidence                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| No tour, checklist, welcome wizard or "getting started" page                                          | no such surface in `plugins/@dshfiles/*/src`; the only onboarding step is the static welcome notice                  |
| 337 user-facing features are documented in the repo README table and plugin READMEs, never in the app | `README.md` bundle table; 110 catalogs, 500 features                                                                 |
| Nothing in the app lists what a bundle does: Settings › Plugins is a row inventory                    | native plugin inventory; no per-plugin description surface found                                                     |
| `plugin-guide` is deliberately developer-only (extension surfaces, risk, slots), not "what can I do"  | plugin-guide README, _Decisions_: "a developer-only page"                                                            |
| Capabilities hub lists three capability kinds and links to their managers, not features               | `capabilities-hub/README.md`                                                                                         |
| 64 of 77 empty states offer no next action                                                            | measured count above                                                                                                 |
| No in-app "what's new" for owned plugins; the release badge covers DSH upstream only                  | `settings-shell/README.md`, _DSH release notices_                                                                    |
| `reach` steps — a real, validated "how to get there" path per feature — are used only by E2E          | `[features.ts:216-260](../../tooling/dshx/packages/dshx/src/project/features.ts#L216-L260)`; `dshx dev` / Playwright |

### Constraints that shape the design

1. Configurable by default: every opinionated part gets a setting; nothing spends tokens, money or Host time on its own (`AGENTS.md`, _Writing plugins_). A tour must make no model call.
2. Works at 390 px with 44 px targets and keyboard-only use (`AGENTS.md` §4). `settings-shell` already degrades its group list to a searchable picker on narrow windows.
3. Agent parity: every user-facing capability gets a tool; presentation-only state does not (`AGENTS.md` §5). A tour's progress is presentation; reading the feature catalog is a capability.
4. No core patch. The catalog, page and wizard are all plugin-owned (`AGENTS.md`, _The core boundary_).
5. Presentation state stays browser-local (`[client-state-ownership.md:30-48](../../docs/client-state-ownership.md#L30-L48)`), so tour progress is a browser value, not a Host setting.

## How — what the major harnesses do

Every claim below rests on the cited source. Full comparison context for these products already lives in [`docs/research/harness-landscape`](../../docs/research/harness-landscape/README.md); that pass covered capability, not onboarding.

### First run

| Product     | Flow                                                                                                                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bb          | Blocking 4-step guide while `onboardingCompletedAt` is null: **Agent** (per-CLI state Ready / installed-not-signed-in / not installed, inline install or sign-in, sign-in output parsed into URL + code) → **Projects** (scan Git repos active in 30 days, preselect up to 5 from the last 7) → **Plugins** (a six-plugin starter set) → **Devices**, ending in **Start using bb**. Replayable from Settings › General. | https://github.com/get-bb/bb/blob/main/apps/app/src/components/onboarding/OnboardingGate.tsx#L76 · …/onboarding-model.ts#L79 · https://getbb.app/changelog#0-46-0                   |
| t3code      | `FirstRunGate` renders nothing until first-run evidence settles (no flash of the app), with a 4 s timeout to a recovery screen; then 3 stages **Connect → Agents → Projects**, no close and no forward skip; provider install/sign-in opens an in-wizard terminal preloaded with the vendor command; the import step pre-fills from Claude Code / Codex history.                                                        | `~/.references/t3code/apps/web/src/components/onboarding/FirstRunGate.tsx:34-46` · `…/onboarding/firstRun.logic.ts:126-163` · `…/components/onboarding/WelcomeWizard.tsx:1023-1050` |
| OpenCode    | No auth gate at all: free models make the first session succeed immediately. `/connect` is user-initiated and only suggested (`provider.connect`, `suggested: !connected()`); submitting with no model toasts and opens the dialog.                                                                                                                                                                                     | `~/.references/opencode/packages/tui/src/app.tsx:1019-1031` · `…/component/prompt/index.tsx:319-329`                                                                                |
| Codex       | An onboarding state machine `Welcome → Auth → TrustDirectory → GovCloudGuidance`, shown **only when needed**: `should_show_onboarding = show_trust_screen \|\| (requires_openai_auth && NotAuthenticated)`; the trust prompt discloses that folder settings can run code.                                                                                                                                               | `~/.references/codex/codex-rs/tui/src/onboarding/onboarding_screen.rs:69-78` · `…/tui/src/lib.rs:2421-2441` · `…/onboarding/trust_directory.rs:61-99`                               |
| Claude Code | Browser login on first use (an approved `ANTHROPIC_API_KEY` skips it), workspace trust dialog, first-run theme picker, terminal-setup prompt; steps are individually instrumented (`onboarding_first_run_hello`, `onboarding_trust_dialog`, …).                                                                                                                                                                         | https://code.claude.com/docs/en/quickstart.md · https://code.claude.com/docs/en/terminal-config.md (bundle strings, 2.1.314)                                                        |
| Cursor      | "Sign in, pick a folder, start with a small task"; welcome and onboarding are separately skippable; onboarding inherits VS Code's walkthrough machinery with per-step `stepProgress` in a memento.                                                                                                                                                                                                                      | https://cursor.com/docs/get-started/quickstart · Cursor app bundle: `skip-welcome`, `skip-onboarding`, `gettingStartedService`                                                      |

### Feature discovery after first run

| Product     | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bb          | No tour/checklist/"what's new" modal found. An in-product **Changelog** button beside the version in Settings › Updates, a nav **New** badge on a dated, screenshot-bearing changelog, and a marketplace that browses plugins by category with screenshots.                                                                                                                                                                 | https://getbb.app/changelog#0-49-0 · https://getbb.app · https://getbb.app/changelog#0-42-0                                                                                         |
| t3code      | No tour, checklist or what's-new modal (grep-verified). Discovery rides on empty states that each name one action, a composer placeholder that climbs a prerequisite ladder ("Choose a project…" → "Enable a provider…"), a command palette with its own key footer, and a nightly-only release-notes popover.                                                                                                              | `~/.references/t3code/apps/web/src/components/NoProjectsHero.tsx:24-48` · `…/components/chat/ChatComposer.tsx:7591-7607` · `…/components/sidebar/SidebarUpdatePill.tsx:47`          |
| OpenCode    | Small persisted "seen" stores instead of a tour engine: a dismissible sidebar **Getting started** card (hidden below 22 rows), per-surface flags (`getting-started`, `highlights`, `chatgpt-plan-welcome.v1`), and `/highlights` — a versioned **What's new in {version}** dialog gated on `seen` and prompt history, disabled by `"highlights": false`. `/help` only points at the palette.                                | `~/.references/opencode/packages/tui/src/feature-plugins/sidebar/footer.tsx:10-70` · `…/util/highlights.ts:11-19` · `…/app.tsx:730-746` · `…/ui/dialog-help.tsx:33-35`              |
| Codex       | Hints are a data file: 47 lines of markdown with `{key:context.action}` tokens, rendered, and **skipped when the referenced action is unbound**; one random tip at startup, `show_tooltips` to toggle. A remote `announcement_tip.toml` feed filtered by `from_date`/`to_date`/`version_regex`, "last matching one is shown". Ambient **turn tips** after 30 s of work and every third completion, capped at 2 per session. | `~/.references/codex/codex-rs/tui/assets/tooltips.txt:1-41` · `…/tui/src/tooltips.rs:16-17,112-147` · `…/app/turn_tips.rs:11-13` · `~/.references/codex/announcement_tip.toml:1-17` |
| Claude Code | `?` on an empty input toggles the shortcut panel; `/` opens the command menu; footer says `? for shortcuts`; a post-update **What's new** button plus one-time **New feature** coach marks, both suppressed by one setting (`DisableFeatureDiscoveryHint`) while release notes stay openable.                                                                                                                               | https://code.claude.com/docs/en/interactive-mode.md · bundle strings (2.1.314)                                                                                                      |
| Cursor      | VS Code's Getting Started walkthroughs (`gettingStartedContributions`, per-step `stepProgress`), plus dated one-time change popups (`…changePopup.03292025.shown`) and feature-flagged onboarding variants.                                                                                                                                                                                                                 | Cursor app bundle: `workbench.desktop.main.js`, `gettingStartedService`, `changePopup.*.shown`                                                                                      |

### What recurs, and what it implies here

1. **A short ordered ladder, entered only when it is needed** (bb on a null flag; t3code on evidence; Codex on unauthenticated-or-untrusted; OpenCode not at all). DSH's coordinator already gates on "main view shows no thread", which is the same shape as Codex's derived gate.
2. **Every step ends in an action that cannot dead-end**: inline install/sign-in (bb, t3code), a preselected list from evidence (bb, t3code), a working default model (OpenCode). DSH equivalents already exist — account setup, project inspection, workspace isolation — so the wizard should _route_ to them, not reimplement them.
3. **Discovery after first run is a set of surfaces, not one tour**: empty states (all four), hints as data (Codex, OpenCode), a palette as the index (OpenCode, t3code), what's-new gated and switchable (OpenCode, Claude Code, bb). No surveyed harness ships a product tour with hotspots.
4. **Every hint is persisted per surface and dismissible**, and a global switch can turn the whole class off (OpenCode `highlights: false`; Claude `DisableFeatureDiscoveryHint`). This is exactly what `AGENTS.md` demands of an opinionated feature.
5. **Hints skip themselves when inapplicable** (Codex unbound-action skip; OpenCode hides the card under 22 rows). A tour step with no reachable destination must not render.
6. **Narrow widths drop labels but keep escape hatches inline** (bb compact ≤640 px; Codex snapshot-tested to 40×13; t3code hides step labels at `max-sm`).

## How — the design

### Conceptual model

One generated catalog, one packs table, one Host read, four surfaces:

```
dshx.features.json ×110 (+ optional `onboarding` block) ─┐
plugins/@dshfiles/*/package.json (description)          ├─► scripts/generate-catalog.ts ─► src/generated/feature-catalog.ts
src/packs.ts + src/curation.ts (Appendix A, packs)       ─┘                                   │
                                                                                               ├─► Getting started page (Knowledge)
Host: workspaceRegistry, llm, pluginManager, `gh auth status` ─► onboarding API `overview` ───┼─► first-run wizard (settings.onboarding)
                                                                                               └─► onboarding_overview agent tool
```

The catalog is generated at build time from checked-in declarations and never read from a running Host, the `plugin-guide` precedent including its `--check` staleness test. Live facts (installed plugins, checklist) come from one Host read, so the page and the agent tool see the same state.

### The `onboarding` block (A3)

An optional field on each feature of `dshx.features.json`, validated by the dshx catalog schema (strict, like every other field):

```json
"onboarding": {
  "prerequisites": ["account", "project"],
  "firstAction": "Open Land › Workspaces and pick a thread workspace to land.",
  "doneWhen": "A thread's workspace shows Ready to land.",
  "open": { "panel": "jj-integration" }
}
```

1. `prerequisites` name checklist items (`account`, `project`, `repository`, `github`), so a feature can say "set this up first" and the gallery can tick it from the same Host read.
2. `firstAction` and `doneWhen` are one sentence each.
3. `open` is one supported route: `{ "panel": <main panel id> }` (layout `openPanel`), `{ "command": <command id> }` (`commands.run`), or `{ "settings": { "section" | "entryId" + "fieldPath" } }` (`dshfiles:open-settings`). A row whose route is not registered at render shows no button.
4. Curated bundles without a block get their route from `src/curation.ts`, so P1 does not edit 40 other catalogs; P5 moves the rule into AGENTS.md and `features:check`.

### Packs (A1)

`src/packs.ts` is the one place packs are defined: id, title, one-sentence purpose, plugins, prerequisites (checklist ids), key settings (`entryId` + `fieldPath` + label), and `core: true` for the always-on pack. A unit test fails when a pack names a plugin that is not a directory under `plugins/@dshfiles`, a key setting names a namespace no `defineSettings` declares, or a plugin is in no pack and is a UI bundle (reported, not failed, until P5).

P1 shows each pack read-only: its plugins with **enabled / disabled / not installed** from the Host's plugin manager, its prerequisites ticked from the checklist, and a button per key setting. P2 adds **Enable pack** / **Disable pack**.

### Self-ticking checklist (A2)

One Host method answers each item from real state; nothing is stored:

| Item         | Ticked when                                                                                                                       | Fix action                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `account`    | the Host's model service lists at least one configured provider                                                                   | open AI accounts                                               |
| `project`    | `workspaceRegistry` holds a project that is not a thread workspace                                                                | open Settings › Projects                                       |
| `repository` | a registered project has a `.jj` or `.git` directory (reports which)                                                              | open Settings › Projects (it offers Enable Jujutsu / git init) |
| `github`     | `gh auth status --hostname github.com` succeeds (one `onboarding gh auth` span, 5 s timeout, cached 60 s; off with `githubCheck`) | copy `gh auth login`                                           |

### Wizard (decision 6)

One `settings.onboarding` entry, shown by `settings-shell`'s coordinator only while no thread is open. Three steps:

1. **Account** — ticked from the checklist; **Open AI accounts**.
2. **Project** — project and repository ticks; **Add a project** (Settings › Projects) and **Isolate new threads** (opens the `jj-integration` `isolateByDefault` field).
3. **First task** — three starter prompts; **Insert prompt** writes into the composer (`Composer.insert`, or a new thread draft when no composer is on screen) and never sends.

Skip, Back, Next on every step. Progress is browser-local (`createStoredValue`); **Onboarding: Show the setup wizard** replays it from the palette and from the page.

### Page (decision 4)

**Knowledge › Getting started** (`dshfiles-onboarding`), also a `sidebar.panellist` page so the New tab view chooser lists it, and a palette command **Onboarding: Getting started**. Three sections:

1. **Checklist** — the four items with their fix actions.
2. **Packs** — each pack with its plugins' states, prerequisites and key settings.
3. **Features** — search over title, owner and summary; destination chips; curated-first (`curatedOnly`); **Open** only when a route is registered.

At 390 px the chips scroll horizontally, rows stack, every control is at least 44 px, and the page is fully usable by keyboard (`/` focuses search).

### Settings (`dshfiles-onboarding`)

| Key           | Default | Effect                                                                    | Applies |
| ------------- | ------- | ------------------------------------------------------------------------- | ------- |
| `wizard`      | `true`  | Show the setup wizard while no thread is open                             | live    |
| `checklist`   | `true`  | Show the self-ticking checklist; off skips every Host check               | live    |
| `githubCheck` | `true`  | Run `gh auth status` for the GitHub item (one process per minute at most) | live    |
| `packs`       | `true`  | Show packs on the page                                                    | live    |
| `curatedOnly` | `true`  | Show only curated features until the user searches                        | live    |

### Agent parity

| Capability                                    | Surface       | Tool                                                                                                                        |
| --------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Read checklist, packs and features + routes   | page, wizard  | `onboarding_overview` (read-only, bound to the API method)                                                                  |
| Change onboarding settings                    | Settings      | existing settings tools                                                                                                     |
| Enable / disable a pack (P2)                  | page          | `onboarding_pack_preview` (read) + `onboarding_pack_apply` (write, explicit `confirm: true`, runs only when the user asked) |
| Open a page, replay the wizard, Show me where | page, palette | none: presentation state (AGENTS.md §5.5); no Host→client navigation verb                                                   |

### Telemetry

`overview` gets the automatic `api-dispatch` and `agent-tool` spans; the `gh auth status` process opens a custom `onboarding gh auth` span asserted by a `recordSpans()` test; the page, the wizard and the generator are client-only or build-time (`not-applicable`).

## Phased steps

### P0 — Decide — done

Decisions above, 2026-11-11.

### P1 — Catalog, page, packs (read-only), checklist, wizard, read tool

1. Add the optional `onboarding` block to `tooling/dshx/packages/dshx/src/project/features.ts` with valid and invalid cases in its test.
2. Scaffold `@dshfiles/onboarding` (`dshx create`, row id `dshfiles-onboarding`); `src/packs.ts`, `src/curation.ts`; `scripts/generate-catalog.ts` writes `src/generated/feature-catalog.ts`; the build runs it first.
3. Host: `onboardingApi.overview` (packs with plugin states, checklist, features filtered by query/destination/curated, bounded) bound as `onboarding_overview`; settings namespace.
4. Client: Knowledge section + `sidebar.panellist` page + palette commands; the wizard step.
5. Feature catalog with `reach`, a Gherkin journey, a 390 px journey step, screenshots, README, `docs/feature-controls.md` rows.

**Acceptance:**

1. `pnpm --dir plugins/@dshfiles/onboarding test` passes; the staleness test fails on a hand-edited catalog and passes after `pnpm generate`; the packs test fails on an unknown plugin name.
2. `pnpm --dir tooling/dshx run features:check` passes, and the schema test rejects an `onboarding` block with an unknown prerequisite or two routes.
3. `pnpm check:e2e onboarding` reaches the page from the palette and from Knowledge, opens one row's route, and walks the wizard to an inserted (unsent) prompt; zero model requests.
4. The page and the wizard render at 390 px with 44 px targets and keyboard-only use (journey step + screenshot).
5. `onboarding_overview` returns the same checklist, packs and rows the page shows.
6. Every setting in the table exists with its default; `wizard: false` hides the wizard entirely.

### P2 — Enable / Disable pack, Show me where

1. **Preview:** a Host method computes, per plugin of the pack, `enable` (installed, disabled), `install` (absent from the profile), or `none`, plus whether a restart is needed; the page shows that list before anything changes.
2. **Apply:** installed rows are enabled live through the plugin manager; missing ones are added through the supported profile-sync path and applied by thread-sidebar's `autoRestartWhenIdle` (or the user's restart). The result names what changed and what waits for a restart.
3. **Disable pack:** the reverse for that pack's plugins that no other enabled pack needs; never disables a Core plugin.
4. **Show me where:** a button per feature with `reach` replays its click/hover steps against the live DOM by role + accessible name, highlighting each control in turn (Next / Escape), and stops with a clear message at the first unresolvable step.
5. Agent parity: the preview is an input of the existing read-only `onboarding_overview` (`preview: { pack, action }`), and `onboarding_pack_apply` (write; explicit `confirm: true`, `action: enable|disable`) applies one pack. Two tools, one preview model — a separate preview tool would restate the same schema.

**Acceptance:** preview lists exactly the rows apply changes (unit test on a fake plugin manager); enable then disable restores the original enablement; a Core plugin is never disabled; Show me where highlights the first two steps of a real feature in a scratch DSH and stops cleanly on a missing control; 390 px and keyboard checks hold.

### P3 — What's new, usage suggestions

1. The Host reads `feat(<plugin>): …` titles from jj/git history at request time (no generated list); the page shows "since your last visit" (browser-local timestamp) and, when an upstream remote exists, "upstream since your fork point".
2. Opt-in suggestions from local tool-call history (no model call), at most one per day, dismissible, off by default.

**Acceptance:** the list comes from history at request time only; suggestions never appear while off; no network or model request.

### P4 — Agent-led demo, `dshx init`, docs per pack

1. "Try it" starts a scratch thread with a demo prompt; off by default (spends tokens).
2. `dshx init` composes a profile from packs interactively.
3. A generated `docs/packs/<pack>.md` per pack.

**Acceptance:** the demo is absent while off; `dshx init --dry-run` prints the composed profile; docs pages regenerate and a stale page fails a check.

### P5 — Self-healing rule

1. AGENTS.md: each new plugin ships an `onboarding` block and joins a pack.
2. `features:check` errors on a UI plugin (catalog lists a `client` surface) with no feature carrying an `onboarding` block, or in no pack.

**Acceptance:** `features:check` fails on a fixture UI plugin without a block and passes with one.

## What this allows

1. A new user reaches a first task through three linked steps without a gate.
2. Anyone can adopt one feature, one plugin or a pack from the page, seeing what each needs first.
3. An Agent answers "what can this setup do?" and "what is missing?" from the same Host read.
4. Adding an owned plugin updates the gallery automatically; the staleness test keeps it honest.

## What this does not allow

1. No blocking gate; the app is usable before, during and after the wizard.
2. No Host→client navigation verb: an Agent cannot open a page for the user.
3. No model call from onboarding until P4's opt-in demo.
4. P1 never changes the profile: Enable pack is P2.

## Appendix A — curated "major features" (approved 2026-11-11)

`src/curation.ts` lists these bundles explicitly, with the route each opens; every other feature stays searchable. Each row is a bundle (its README table entry), not every feature id it declares.

1. **Threads:** `main-tabs` tabs/pin/preview · `thread-sidebar` rail and filters · `jj-integration` thread workspace · `btw` side chat · `queue-reorder` · `rich-composer` references · `session-search`.
2. **Inbox:** `activity-timeline` attention · `agent-questions` · `backlog` inbox · `pull-requests` needs-you · quota continuations (`ai-accounts`).
3. **Land:** `jj-integration` rebase/land · `jujutsu` graph and Source Control · `pulls-review` · `pull-requests` · `git-worktrees`.
4. **Work:** `backlog` (+ Jira/Notion) · `project-automations` · `goal-tool` · `schedule`.
5. **Agents:** `agents` persistent agents · `agent-communication` · `agent-preset` · `agent-toolkit` · `multi-host` dispatch.
6. **Observe:** `usage` · `ai-accounts` quota · `traces` · `activity-timeline` log · `background-jobs` · `preview` dev servers · `multi-host` fleet.
7. **Knowledge:** `memory` · `references` · `session-search` · `fff-search` · `agentsview`.
8. **Settings:** `settings-shell` search/task groups · `capabilities-hub` · `plugin-guide` · `secret-catalog` · `mcp-servers` · `policies`.
9. **Composer and transcript:** `mentions` · `model-effort-picker` · `annotations` · `html-render` · `mermaid-diagrams` · `attachment-gallery` · `diff-viewed`.
10. **Agent tools:** `apply-patch` · `tool-search` · `preview` browser tools · jj tools · backlog tools · memory tools.

## Risks

| Risk                                                                  | Likelihood | Cost if it lands              | Mitigation                                                                                            |
| --------------------------------------------------------------------- | ---------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| The gallery becomes a second, drifting README                         | medium     | A user trusts a stale row     | Build-time generation plus the `--check` staleness test; no hand-written rows                         |
| A pack names a plugin that was renamed or removed                     | medium     | Enable pack fails or lies     | Packs test against `plugins/@dshfiles/*`; Host reports `not installed` instead of guessing            |
| The wizard re-teaches what owner surfaces already do                  | medium     | Duplicated setup logic        | Steps only link out and insert text; no account, project or workspace writes                          |
| The `gh` check costs Host time on every page open                     | low        | A process per render          | 60 s cache, 5 s timeout, `githubCheck` setting, only while the page or tool asks                      |
| Enable pack changes the profile in a way the user did not expect (P2) | medium     | Plugins appear or disappear   | Exact preview first, Disable pack reverses it, Core never disabled                                    |
| Show me where drifts from the UI (P2)                                 | medium     | A highlight points at nothing | It replays the same `reach` steps the E2E journeys keep green; stops with a message at a missing step |

## Open questions

None open: P0 closed all seven (owner, audience, blocking, gallery home, screenshots → A9 later, curated list + A1–A10, three wizard steps).

## Decisions log

| Date       | Decision                                                                                                | Rationale                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-11-11 | Reuse `settings.onboarding` instead of building a tour engine or patching core                          | The coordinator, the empty-view gate, ordering and replay already ship in `settings-shell`                         |
| 2026-11-11 | Generate the catalog at build time from `dshx.features.json`, not from a live Host read                 | Same precedent and staleness guarantee as `plugin-guide`; no Inspect dependency, no private API                    |
| 2026-11-11 | Tour progress is browser-local                                                                          | `docs/client-state-ownership.md` classifies tour and tab state as presentation                                     |
| 2026-11-11 | Owner: new `@dshfiles/onboarding` plugin                                                                | User decision; keeps `settings-shell` and `plugin-guide` focused                                                   |
| 2026-11-11 | Audience: anyone; adopt the whole setup, a plugin, a pack or a feature                                  | User decision                                                                                                      |
| 2026-11-11 | Non-blocking and replayable                                                                             | User decision; matches OpenCode/Codex "only when needed" and keeps the app usable                                  |
| 2026-11-11 | Gallery in Knowledge + palette + New tab chooser                                                        | User decision; AGENTS.md "each reusable view opens from both"                                                      |
| 2026-11-11 | Wizard has three steps; workspace isolation folds into Project                                          | User decision                                                                                                      |
| 2026-11-11 | Packs are data in `src/packs.ts`, validated against the plugin directories; a plugin may sit in several | User decision; one place to change, a test catches drift                                                           |
| 2026-11-11 | `onboarding` block lives in `dshx.features.json`, not a per-plugin framework                            | User decision (A3); the gallery, packs and agent tool read one source                                              |
| 2026-11-11 | Curated routes for bundles without a block live in `src/curation.ts` until P5                           | Avoids editing ~40 catalogs in P1; P5 makes blocks required                                                        |
| 2026-11-11 | The checklist is one Host read, never stored                                                            | The page and the agent tool must agree; the facts change outside DSH (`gh auth login`)                             |
| 2026-11-11 | Phases P1–P5 as listed; P2 starts only after P1 is verified                                             | User decision                                                                                                      |
| 2026-11-11 | The wizard is a non-modal card, not a dialog                                                            | A modal is a gate in practice and failed the scratch boot's no-modal-overlay check; Escape and Skip close the card |
| 2026-11-11 | A Show me where walk moves focus to its card's first button                                             | Keyboard users must reach Next and End; the walk is user-started, so focus follows the user's action               |
| 2026-11-11 | What's new reads history on the Host at request time, not a build-time list                             | A generated list with a staleness test would fail CI on every unrelated commit                                     |
| 2026-11-11 | Phone walks use an optional `reachNarrow` catalog path                                                  | Desktop `reach` targets controls that do not render below 640 px                                                   |

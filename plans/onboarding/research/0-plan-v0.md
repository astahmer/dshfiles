# Guided onboarding and feature discovery

**Resume here:** P0 is a decision, not code: answer the open questions, approve the curated "major features" list, and pick the owner (new `@dshfiles/onboarding` plugin, per the recommendation below). P1 (generated catalog + staleness test) is the first build step and needs no Host capability.

**As of:** 2026-11-11. Backlog item `b:qrmm`. Research-only: no product code changed, nothing shipped.

**Status:** not started.

| Phase | Work                                                              | Status      |
| ----- | ----------------------------------------------------------------- | ----------- |
| P0    | Audience, owner, curated list, blocking-or-not decision           | not started |
| P1    | Generated feature catalog + staleness test                        | not started |
| P2    | Feature gallery page (search, destinations, open-where-supported) | not started |
| P3    | First-run wizard as one `settings.onboarding` step                | not started |
| P4    | Hero entry point + P1 empty-state actions                         | not started |
| P5    | Agent parity, README, docs, telemetry fields                      | not started |
| P6    | Measure, then keep or demote the wizard                           | not started |

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
   - `ctx.layout.openPanel(panelId)` selects a registered main panel (`[app-services.ts:326-333](../../tooling/dshx/packages/dshx/src/client/app-services.ts#L326-L333)`), and destination sections are main panels ("opening it selects that main panel in the stage", `[destinations.ts:46-48](../../plugins/@dshfiles/thread-sidebar/src/destinations.ts#L46-L48)`).
   - `window.dispatchEvent(new CustomEvent('dshfiles:open-settings', …))` opens a Settings section, field, search entry or query (`[open-settings.ts:1-14](../../plugins/@dshfiles/settings-shell/src/open-settings.ts#L1-L14)`).
   - `ctx.commands.run(id)` runs any contributed command exactly as the palette does (`[app-services.ts:229-239](../../tooling/dshx/packages/dshx/src/client/app-services.ts#L229-L239)`).
   - The composer contract can insert text, attach chips, focus and set the model — it never sends (`[app-services.ts:131-163](../../tooling/dshx/packages/dshx/src/client/app-services.ts#L131-L163)`).
5. **Precedents for the page itself:** `plugin-guide` generates a static catalog at build time and fails when it is stale (`[plugin-guide/README.md](../../plugins/@dshfiles/plugin-guide/README.md)`); `capabilities-hub` is one launch point that stores nothing and makes no network call; `component-gallery` is a filterable gallery page; `agent-toolkit` already lists the tools, plugins, MCP servers and skills a thread can use.
6. **Empty states are the one place a stuck user looks**, and they are mostly dead ends: 77 `<EmptyState>` usages across owned plugins, 13 with an `action` (measured 2026-11-11). The component allows one sentence and at most one action (`[page.tsx:327-351](../../plugins/@dshfiles/plugin-ui/src/components/page.tsx#L327-L351)`).

### What a user cannot discover today

| Gap                                                                                                     | Evidence                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| No tour, checklist, welcome wizard or "getting started" page                                            | no such surface in `plugins/@dshfiles/*/src`; `wf`                                                                   |
| 337 user-facing features are documented in the repo README table and plugin READMEs, never in the app   | `README.md` bundle table; 110 catalogs, 500 features                                                                 |
| `plugin-guide` is deliberately developer-only (extension surfaces, risk, slots), not "what can I do"    | plugin-guide README, _Decisions_: "a developer-only page"                                                            |
| Settings › Plugins lists rows/packages; Capabilities hub lists 3 kinds. Neither says what a plugin does | native plugin inventory; `capabilities-hub/README.md`                                                                |
| 64 of 77 empty states offer no next action                                                              | measured count above                                                                                                 |
| No in-app "what's new" for owned plugins; the release badge covers DSH upstream only                    | `settings-shell/README.md`, _DSH release notices_                                                                    |
| `reach` steps — a real, validated "how to get there" path per feature — are used only by E2E            | `[features.ts:216-260](../../tooling/dshx/packages/dshx/src/project/features.ts#L216-L260)`; `dshx dev` / Playwright |

### Constraints that shape the design

1. Configurable by default: every opinionated part gets a setting; nothing spends tokens, money or Host time on its own (`AGENTS.md`, _Writing plugins_). A tour must make no model call.
2. Works at 390 px with 44 px targets and keyboard-only use (`AGENTS.md` §4). `settings-shell` already degrades its group list to a searchable picker on narrow windows.
3. Agent parity: every user-facing capability gets a tool; presentation-only state does not (`AGENTS.md` §5). A tour's progress is presentation; reading the feature catalog is a capability.
4. No core patch. The catalog, page and wizard are all plugin-owned (`AGENTS.md`, _The core boundary_).
5. Presentation state stays browser-local (`[client-state-ownership.md:30-48](../../docs/client-state-ownership.md#L30-L48)`), so tour progress is a browser value, not a Host setting.

## Goal

A new user learns what dshfiles can do by doing the first three things that matter (account, project, first message) and then has one searchable, destination-grouped place to find every major feature — with the same catalog readable by an Agent.

## What

In scope: a generated feature catalog, a gallery page, a first-run wizard built from the existing `settings.onboarding` coordinator, a hero entry point, one action added to the ~15 highest-value empty states, and a read-only agent tool.

Out of scope: a per-plugin tour framework, an in-app changelog for owned plugins, a "what's this" click-to-explain mode, shipped screenshots, and any blocking gate that prevents using the app.

## Why

Two different users are stuck, and the repo already has the data to unstick both:

1. **A fresh user** gets a preview paragraph, an empty hero and 337 undiscoverable features. bb and t3code both answer this with a short ordered ladder that ends in the user's first real task; DSH has an empty coordinator and a static modal in its place.
2. **A returning user** cannot answer "does this thing have X?" without reading the repo. Every feature already declares where it lands and how to reach it; that map is simply not rendered anywhere.

The cost of not doing it is structural: every new owned plugin adds features to a catalog nobody sees, and the README table grows as the only index.

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

Three surfaces over one generated catalog:

```
dshx.features.json (110 catalogs, 500 features) ─┐
README bundle table (capability per bundle)      ├─► generate-at-build ─► feature-catalog.ts ─┬─► Gallery page (search, destinations)
thread-sidebar/destinations (live page index) ───┘                                             ├─► First-run wizard steps
                                                                                               └─► onboarding_overview agent tool
```

The catalog is generated at build time from checked-in declarations, never read from a running Host — the `plugin-guide` precedent, including its staleness test and its refusal to invent live occupancy.

### Parts: adopt, extend, build

| Part                                | Disposition                              | What it means concretely                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-run wizard                    | **Build** (one step)                     | A new owned plugin contributes exactly one `settings.onboarding` entry whose component runs its own ordered steps, and calls `complete()` when the user finishes or skips. The coordinator, the "no thread open" gate and replay wiring already exist in `settings-shell`; no change there. |
| Hero entry point                    | **Extend**                               | The same plugin adds a dismissible card through the `conversation.hero.*` slots so the gallery and tour are reachable from the exact place a user has nothing to do. Occupancy must be read with `dshx inspect slots --root conversation.hero` before building.                             |
| Feature gallery                     | **Build**                                | One page: search, group by destination, per-row owner, one sentence, and an **Open** action only when a supported route exists. Reuses the `capabilities-hub` shape (stores nothing, no network) and `component-gallery` layout.                                                            |
| Navigation ("Open", "Show me")      | **Extend** existing contracts            | `ctx.layout.openPanel(panelId)` for destination sections, `dshfiles:open-settings` for Settings, `ctx.commands.run(id)` for palette commands. A row with no supported route shows no button — never a dead one.                                                                             |
| Empty-state next actions            | **Extend**                               | `EmptyState` already takes one sentence and one action. Add an action only where a real filler exists, on ~15 P1 surfaces, not all 77.                                                                                                                                                      |
| Agent parity                        | **Build** (read-only)                    | `onboarding_overview` returns the same catalog grouped by destination, plus how to reach a feature. No write tool: tour progress and tab state are presentation (`AGENTS.md` §5.5).                                                                                                         |
| Per-plugin onboarding               | **Adopt the pattern, don't systematize** | Only where a prerequisite blocks work and the setup already exists (`ai-accounts`, `workspace-folder-picker`, `secret-catalog`, `mcp-servers`). Link into them; do not add a per-plugin tour framework.                                                                                     |
| "What's this" inspect mode          | **Defer**                                | `annotations` already resolves a picked element to a selector, a page and `file:line` from the bundle's source map. The missing piece is a feature→element map; day one it would guess.                                                                                                     |
| In-app what's-new for owned plugins | **Defer**                                | No owned plugin keeps a changelog; generating one from jj history mixes refactors with user-visible change. Revisit after P6, and only with a declared source of truth.                                                                                                                     |
| Screenshots in the gallery          | **Defer**                                | 238 PNGs across 70 plugins, 22 MB total; no client plugin serves repo images today. Text plus destination and owner first; thumbnails are a separate, generated-asset decision.                                                                                                             |

### Data and ownership

1. **Catalog** (build artifact, owned by the plugin): one entry per curated feature — `id` (`<package>#<feature-id>`), owner package, title, one-sentence summary, destination, surface, `currentSurface`, `reach` (as prose, for E2E parity), plus a `curated: boolean`. Curated rows come from an explicit list in the generator; non-curated rows stay searchable but rank below.
2. **Live page index** (owned by `thread-sidebar`): `Destinations.resolve(...)` grouped list. The gallery reads it, never copies it.
3. **Tour progress** (browser-local, owned by the plugin): acknowledged step ids and the dismissal of the hero card, via `createStoredValue`. A **Show the tour again** command clears it. No Host setting, no network, no model call.
4. **Settings** (Host, `defineSettings`): `enabled` (show the first-run wizard, default on), `hero` (show the hero card, default on), `curatedOnly` (gallery shows only curated features, default on).

### UI and UX

Desktop, gallery opened as a Settings entry and a palette command:

```
Getting started                     [ Search features              ]
 Threads   12   Land    8   Work  9   Observe 14   Knowledge 7
 Agents    5   Inbox   6   Settings 11
 ─────────────────────────────────────────────────────────────────
 Land                                  jj-integration
 Thread workspaces                     One jj workspace per thread,
 [Open]                                chosen before the first message.
```

Narrow (390 px): the destination list becomes a horizontal chip row above the results; the search field stays pinned; each row shows title, one line, and the **Open** button at 44 px; the group heading collapses to a count chip. Keyboard: `/` focuses search, arrows move rows, Enter is **Open**, Escape clears.

Wizard, only while no thread is open:

```
Step 1 of 4 · Account      Choose how DSH talks to a model.        [Open AI accounts]
Step 2 of 4 · Project      Add a folder or clone a repository.     [Add a project]
Step 3 of 4 · Workspace    Isolate this thread in its own jj workspace. [Open Settings]
Step 4 of 4 · First task   Say what you want built.                [Insert a prompt]
                           Skip · Continue
```

**Insert a prompt** writes into the composer through the composer contract and never sends. Every step links to the surface that owns the work; the wizard owns no account, project or workspace logic.

### Agent parity

| Capability                       | Surface                           | Tool                                            |
| -------------------------------- | --------------------------------- | ----------------------------------------------- |
| Read the feature catalog + reach | Gallery, wizard step 4, hero card | `onboarding_overview` (read-only, same module)  |
| Change tour/hero/curation prefs  | Settings page                     | existing `settings_list` / settings write tools |
| Open a page for the user         | —                                 | none: no Host→client navigation verb exists     |

`onboarding_overview` is a read because the write side is presentation. If a future step needs to _drive_ the UI, that is a Host gap to record in [`plans/dsh-host-gaps.md`](../dsh-host-gaps.md), not a client fake.

### Telemetry

Per `AGENTS.md`, each catalog feature declares `telemetry`: the gallery and hero are client-only (`not-applicable`); `onboarding_overview` gets the automatic `agent-tool` span; catalog generation is a build script and adds nothing at runtime.

## Phased steps

### P0 — Decide (no code)

1. Answer the open questions; approve the curated list in [Appendix A](#appendix-a--proposed-curated-major-features).
2. Decide the owner: new `@dshfiles/onboarding` plugin (recommended) vs extending `settings-shell` or `plugin-guide`.
3. Check slot occupancy: `dshx inspect slots --root conversation.hero`, `--root settings.onboarding`.

**Acceptance:** a decision on owner, audience, blocking-or-not, and gallery location, written into the decisions log here; the curated list reviewed.

### P1 — Generated catalog

1. Scaffold the plugin (`dshx create`), package `@dshfiles/onboarding`.
2. `scripts/generate-catalog.ts` reads all 110 `dshx.features.json` plus the curated list, validates `destination`/`surface` against the dshx literals, and writes `src/generated/feature-catalog.ts`; wire it before `dshx build`.
3. A unit test fails when the checked-in catalog is stale or was generated for another DSH version, and when a curated id no longer exists.

**Acceptance:** `pnpm --dir plugins/@dshfiles/onboarding test` → stale-catalog test fails on a hand-edited catalog and passes after `pnpm generate`; `pnpm --dir tooling/dshx run features:check` still passes; generation reads no Host state and makes no network call.

### P2 — Gallery page

1. Register a reusable workbench view _and_ a Settings entry and palette command (AGENTS: each reusable view opens from the palette and the New tab chooser).
2. Group by destination from the live registry; search over title, owner and summary; **Open** only when `layout.openPanel` / `open-settings` / `commands.run` has a route, verified at render.
3. Route the "Open" click through the three supported contracts; show why a row has no button.

**Acceptance:** a scratch-DSH journey reaches the page from the palette, opens three rows landing on three different destinations, and renders at 390 px with 44 px targets and keyboard-only use; a row with no route renders no button.

### P3 — First-run wizard

1. One `settings.onboarding` entry, default on, ordered steps: account → project → workspace → first task.
2. Each step links to its owner; **Insert a prompt** fills the composer and never sends; **Skip** at every step persists.
3. Commands: **Onboarding: Show the tour** (clears progress and opens step 1) and **Onboarding: Getting started** (opens the gallery).

**Acceptance:** on a fresh scratch profile the wizard shows while no thread is open and never with a thread open; Skip survives reload; a Host request log or egress guard shows **zero** model requests from the wizard; 390 px journey passes; turning `enabled` off hides it entirely.

### P4 — Hero entry point and empty states

1. Hero card: one line, "See what this setup can do", two actions (tour, gallery), dismissible, `hero` setting.
2. Add one action to the ~15 P1 empty states (threads, inbox, land, work, agents, observe, knowledge, settings, gallery, backlog, memory, traces, usage, background-jobs, preview), each pointing at the thing that fills it.

**Acceptance:** each changed empty state's action lands on a surface that can fill it; no action added where no filler exists; `EmptyState` usages stay one-sentence + one-action; a screenshot per changed P1 surface refreshed where a control moved.

### P5 — Agent parity, docs, telemetry

1. `onboarding_overview` read tool bound through the same catalog module (not a second definition).
2. Plugin README (`Use`, settings, controls, restart needs), a `docs/onboarding.md` page linked from `docs/README.md`, `docs/feature-controls.md` rows for the three settings.
3. `dshx.features.json` with `reach` steps for the gallery and the wizard; catalog staleness test wired into CI.

**Acceptance:** `onboarding_overview` returns the same rows the page shows; `features:check` and `dshx build` pass; a screenshot is committed for the gallery and the wizard; `pnpm fmt && pnpm lint && pnpm typecheck` clean for the package.

### P6 — Measure, then keep or demote

1. Browser-local counters for: wizard shown, finished, skipped at which step; gallery opens; hero dismissals. No telemetry export unless the user opts in.
2. Read them after a week of real use.

**Acceptance:** a written verdict — keep the wizard default on, change the default, or demote it to command-only — with the numbers behind it.

## Ranked options

Cost S/M/L, value 1–3; ranked by value per cost, not by phase order.

| #   | Option                                                              | Cost | Value | Note                                                                                    |
| --- | ------------------------------------------------------------------- | ---- | ----- | --------------------------------------------------------------------------------------- |
| 1   | One action on ~15 P1 empty states                                   | S    | 3     | Cheapest real help; component already supports it; no new plugin                        |
| 2   | Hero entry-point card (tour + gallery)                              | S    | 3     | Reaches the user exactly where they are stuck; dismissible, one setting                 |
| 3   | Generated catalog + gallery page (text, search, destination groups) | M    | 3     | Turns 337 catalogued features into something a user can find                            |
| 4   | First-run wizard as one `settings.onboarding` step                  | M    | 3     | Coordinator, gate and replay already exist; the highest-leverage use of existing code   |
| 5   | Replay command + three settings + reset                             | S    | 2     | Makes the wizard testable and non-annoying                                              |
| 6   | `onboarding_overview` read tool                                     | S    | 2     | Agent answers "what can this do?" from the same source; needed for parity               |
| 7   | Per-destination mini tours from the rail                            | M    | 2     | Nice once the catalog exists; duplicates the gallery rows if built first                |
| 8   | In-app what's-new for owned plugins                                 | M    | 2     | Real gap, but there is no changelog source of truth yet                                 |
| 9   | Blocking first-run gate (bb/t3code style)                           | M    | 2     | Strongest activation, most opinionated; conflicts with "never block the app" taste-free |
| 10  | "What's this" inspect mode                                          | L    | 2     | `annotations` gives selector→file:line; feature→element map is the missing, hard piece  |
| 11  | Gallery thumbnails from the 238 shipped screenshots                 | L    | 1     | 22 MB, no client image path, build pipeline for downscales                              |
| 12  | Per-plugin onboarding framework                                     | L    | 1     | Repetitive across 100 bundles; most prerequisites already have owner-owned setup        |

## What this allows

1. A new user reaches a first successful task through four linked steps instead of guessing.
2. Any user can answer "does this have X?" from the app, grouped the way the rail is grouped.
3. An Agent can answer the same question from the same catalog.
4. Adding an owned plugin updates the gallery automatically; the staleness test keeps it honest.

## What this does not allow

1. No product tour with hotspots, step-by-step poking at the live UI: opening a page is the limit of what a plugin may drive today.
2. No blocking gate: the app is usable before, during and after the wizard.
3. No per-plugin first-use hints beyond the P1 empty states.
4. No in-app changelog, no screenshots, no "what's this" mode in this plan.
5. No Host→client navigation verb; if one is needed later it becomes a Host gap entry, not a client workaround.

## Appendix A — proposed curated "major features"

The generator lists curated features explicitly; all other rows stay searchable. Counts are proposals to approve, not a contract.

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

## Open questions

1. **Owner:** new `@dshfiles/onboarding` plugin, or extend `settings-shell` (it owns the coordinator), or extend `plugin-guide` (it owns a generated catalog)?
2. **Audience:** is this for this machine only, or for anyone combining dshfiles? It decides how deep the curation goes (20 vs 50 rows) and whether the copy stays personal.
3. **Blocking or not:** wizard as a non-blocking card/sheet (recommended, matches the current native welcome), or a real gate like bb/t3code?
4. **Gallery home:** Settings entry only, a new Knowledge section, or both plus the palette command?
5. **Screenshots:** text-only galleries first (recommended), or invest in generated thumbnails now?
6. **Curated list:** approve [Appendix A](#appendix-a--proposed-curated-major-features) as is, trim it, or add rows?
7. **Wizard steps:** four (account → project → workspace → first task), or three by folding workspace isolation into the project step?

## Acceptance criteria for the whole plan

- [ ] A fresh scratch profile shows the wizard while no thread is open, and the gallery is reachable from the hero card and the palette.
- [ ] The wizard makes zero model requests and never sends a message.
- [ ] Every gallery row either opens a real destination or shows no button.
- [ ] The catalog regenerates from the checked-in declarations only; a stale catalog fails a test.
- [ ] 390 px, keyboard-only and 44 px targets hold for the gallery and the wizard.
- [ ] `onboarding_overview` returns what the page shows, from one catalog module.
- [ ] The three settings exist with documented defaults and restart needs; turning the wizard off hides it entirely.
- [ ] Screenshots for both new surfaces are committed and `check:screenshots` passes.
- [ ] A measured verdict in P6 says whether the wizard stays on by default.

## Decisions log

| Date       | Decision                                                                                | Rationale                                                                                       |
| ---------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 2026-11-11 | Reuse `settings.onboarding` instead of building a tour engine or patching core          | The coordinator, the empty-view gate, ordering and replay already ship in `settings-shell`      |
| 2026-11-11 | Generate the catalog at build time from `dshx.features.json`, not from a live Host read | Same precedent and staleness guarantee as `plugin-guide`; no Inspect dependency, no private API |
| 2026-11-11 | No blocking gate in the first version                                                   | DSH is a working tool before onboarding; a gate is a separate, opinionated decision             |
| 2026-11-11 | Defer screenshots, "what's this" mode and owned-plugin changelogs                       | Each needs a missing source of truth (asset pipeline, feature→element map, changelog)           |
| 2026-11-11 | Tour progress is browser-local                                                          | `docs/client-state-ownership.md` classifies tour and tab state as presentation                  |

# Current first-run and onboarding audit (dshfiles, read-only)

Repo: `~/dev/dshfiles-threads/freeze-fix` (jj `@` = `ttlnsorkoqxm wip`, includes #258 redesign + DSH 0.2.2-rc.2 port).
Method: source, READMEs, plans, generated catalog, committed screenshots. No Host, browser or build was run, so every
"what the user sees" claim is inferred from code + screenshots, not observed live.

## Counts

| What                                        | Count                                                                                                      | Source                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Owned plugins in repo                       | 122 (86 UI, 36 non-UI)                                                                                     | `ls plugins/@dshfiles`; `onboarding/src/generated/feature-catalog.ts` `"ui"` flags                                          |
| Plugins in default `web` profile            | 106 deps: 104 `@dshfiles/*` + `dsh-our-free-model` + `dshmarket`                                           | `profiles/web/package.json`                                                                                                 |
| Of those, disabled by default               | 0 owned; the patch disables only native rows (feedback, DeepSeek LLM, native hmr, sqlite query, otel)      | `profiles/web/cordis.patch.yml:10-287`                                                                                      |
| A profile with no seed (`profile:sync`)     | gets every owned bundle (122)                                                                              | `docs/profile-installs.md:6-8`                                                                                              |
| Packs                                       | 8, covering 37 unique plugins; ~67 installed plugins belong to no pack (P5b undecided)                     | `onboarding/src/packs.ts:26-103`; `plans/onboarding/README.md:3`                                                            |
| Core pack                                   | 6 plugins; `onboarding` itself is in no pack                                                               | `packs.ts:30`                                                                                                               |
| Catalog features                            | 561 (192 `destination: none`), 98 `onboarding` blocks                                                      | generated catalog                                                                                                           |
| Curated                                     | 49 bundles in `curation.ts`, ~284 features (plan figure)                                                   | `onboarding/src/curation.ts`; `plans/onboarding/README.md:7`                                                                |
| Destination filter chips on Getting started | up to 13 (All + 12)                                                                                        | `getting-started-page.tsx:27-40`                                                                                            |
| Rail destinations / sections                | 8 destinations, ~35 sections (31 static + registry)                                                        | `thread-sidebar/src/known-sections.ts`; `thread-sidebar/README.md:160`                                                      |
| Settings                                    | 11 task groups, ~78 mapped entries (General alone 22) + Other                                              | `settings-shell/src/settings-groups.ts:19-29`                                                                               |
| First-run modal steps queued                | up to 3: Preview Notice → DeepSeek sign-in (conditional) → setup wizard                                    | `settings-shell/src/client.tsx:427,787-793`; `settings-models/src/native/index.ts:160-172`; `onboarding/src/client.tsx:231` |
| Getting started page sections               | 5: Checklist (4) · What's new (12 of ≤50 + upstream) · Suggestions (off line) · Packs (8 cards) · Features | `getting-started-page.tsx:328-376`                                                                                          |
| `<EmptyState>` uses / with an action        | 81 / 15                                                                                                    | rg over plugins (plan measured 77/13 on 11-11)                                                                              |

## Walkthrough: fresh install → productive

### 0. Install (outside the app)

1. Root README opens with "A personal DeepSeek Harness setup" and a recovery banner (`README.md:1-11`). No "Quick start for a new user"; the only run recipe is the maintainer loop `pnpm install:all; pnpm check; profile:sync --profile probe; profile:boot` (`README.md:167-188`).
2. `docs/README.md` indexes ~40 operational docs; none is "install / getting started". `dshx init --packs …` (the actual new-user composer) is only in `docs/profile-installs.md:22-25` and the CLI reference.
3. `dshx init` multi-select of 8 packs, Core locked (`tooling/dshx/packages/dshx/src/cli/init.ts:81`). A Core-only profile does not name `onboarding`, so Getting started/wizard are absent unless a supplier pulls it in (unverified).
4. Realistic path (web seed / sync): **all ~104 plugins on**. Packs become read-only decoration ("N of N enabled").

### 1. First load

1. **Modal 1 — "Preview Notice"** (blocking, one Continue): upstream DeepSeek Harness 0.2 marketing paragraph about "the new desktop app" (`settings-shell/src/native/welcome-notice.tsx:24-28`). Says nothing about dshfiles. Both settings-shell and the newly ported settings-models register `welcome-notice` (`settings-models/src/native/index.ts:160`); settings-shell wins by id shadowing (`settings-shell/src/client.tsx:427`).
2. **Modal 2 — DeepSeek official sign-in** (`settings-models/.../DeepSeekOnboardingDialog.tsx:59-104`): likely skipped since `llm-deepseek` is disabled (`profiles/web/cordis.patch.yml:223`) — unverified.
3. **Modal 3 — Setup wizard** (Dialog on desktop, bottom Sheet on phone; `onboarding/src/setup-wizard.tsx:174-205`), only while account or project missing (`first-run.ts:14-24`), and waits up to 3 s for the overview before deciding.
4. Behind the modals, the shell (from `destination-rail.png`): rail with 8 labelled destinations (Threads, Inbox, Land, Work, Agents, Observe, Knowledge, Settings) + 3 rail actions (+ folder, Copy DSH URL, Pair a phone) + Settings; tab strip; thread list header (search, project picker, filter); composer run row with ~6 chips (project · host · workspace · agent mode · file access · model) + ⋯; status strip (N working, quota). Roughly **20+ interactive controls before typing**. Hero cards: none on a fresh profile by design (`thread-sidebar/README.md:114-117`), so the empty thread offers no starter prompt.

### 2. Wizard (3 steps)

1. **Connect an AI account**: a checklist row + a button to the AI accounts page. Following the link closes the wizard "for now"; it only reappears on a later load (README "Setup wizard" §3; `client.tsx:180-200`). No resume after finishing setup on the linked page.
2. **Add a project**: checklist rows (project, repository) + **Isolate new threads** (a jj-integration setting — jargon at step 2).
3. **Start a first task**: three starter prompts (`setup-wizard.tsx:21-25`), **Insert prompt** (never sends).
4. Footer: **Don't show again** (ghost, left), Back, Next/Done (`setup-wizard.tsx:158-168`).

### 3. Getting started page (Knowledge › Getting started, 5th row, `client.tsx:85,152`)

Order (`getting-started-page.tsx:316-399`): header + **Start setup** → **Setup checklist** (4 items incl. `gh auth login`) → **What's new** (≤50 commit titles + "main@origin N not in your main") → **Suggestions** (off: one line) → **Packs** (8 cards, each: summary, plugin chips, prerequisites, 1-2 setting links, Enable pack / Disable pack, optional Try it) → **Features** (search, 13 chips, curated rows with up to 3 verbs: Show me where / Try it / Open).

### 4. Show me where

Non-modal card + ring, `Step N of M · Click "X"`, Next/End (`show-me-where.tsx`, `walk-controller.ts`). Good mechanics; content depends on `reach` freshness (see P5).

## Ranked UX problems

1. **Three stacked modals before the first prompt, the first one off-message.** The very first screen is an upstream "Preview Notice" about the DeepSeek desktop app (`settings-shell/src/native/welcome-notice.tsx:24-28`), then (maybe) DeepSeek sign-in, then the dshfiles wizard as a blocking `Dialog` (`setup-wizard.tsx:189-205`). The plan's own decision says the wizard is "non-blocking… no gate" and follow-up 2 claims it is "a non-modal card (top right), not a dialog" (`plans/onboarding/README.md:43,69`) — code contradicts plan.
2. **Everything is on.** 104 plugins enabled by default (`profiles/web/package.json`), ~35 rail sections, 11 Settings groups/~78 entries, 561 catalogued features. No progressive disclosure: packs exist but the default profile already has every pack fully enabled, so Enable/Disable pack is noise for the common case, and ~67 installed plugins are in no pack (P5b unresolved, `plans/onboarding/README.md:3`).
3. **Getting started is buried and mis-filed.** It lives in **Knowledge** ("Memory and reference material agents use", `thread-sidebar/src/destinations.ts:41`) as the 5th row after Memory, Component gallery (a dev tool), Whiteboard, Agent CLI threads (`getting-started.png`). Discovery otherwise needs ⌘K or New tab. Nothing on the empty thread points to it.
4. **The page is ordered for the maintainer, not the newcomer.** What's new (raw `feat/fix` commit titles like "publish the thread-directories module", "give the notification history page our page anatomy", upstream `main@origin` fetch status) sits above Packs and Features (`getting-started-page.tsx:337-376`; `getting-started.png`, `setup-wizard.png`). On a registry install it is a "no history" notice. For a new user every entry is "new", so it is pure scroll.
5. **Catalog copy is developer copy.** Rows show `firstAction ?? summary` plus raw `currentSurface` (`getting-started-page.tsx:212-213`): e.g. "Native Settings shell, ported … The authorized shell renderer and ConfigForm remain the owner", "Dock the actual sidebar content assemblies" (`show-me-where.png`). Plugin chips are slug title-case: "Fff search", "Hmr gate" (`labels.ts:21`); phone shows raw `memory · not installed`, `onboarding`, "Run Onboarding: Show the setup wizard…" (`getting-started-390.png`).
6. **Stale paths after the redesign → Show me where dead ends.** `settings-shell-port` still reaches via `click button "Account menu"` and reads `sidebar: Account menu › Settings` (`settings-shell/dshx.features.json:9,14`); others cite the removed footer / Navigation list (`thread-sidebar/dshx.features.json:2047,3728`; `cordis-cards/dshx.features.json:12`; `phone-pairing/dshx.features.json:12`). `show-me-where.png` literally shows "Step 1 of 3 · Click 'Account menu'". Walk then times out to "Not on screen" after 10 s.
7. **Jargon at first contact.** Rail "Land"; wizard "Isolate new threads"; checklist "jj or git repository", `gh auth login`; packs "Hmr gate", "Fff search", "Observe & perf"; restart guidance "managed launcher", "Host", "profile". Plugin-prefixed view names survive in the New tab chooser: **Settings Shell: Settings**, **Plugin Manager: Plugins**, **Schedule: Automation tasks** (`main-tabs/README.md:28-29`; `workbench/README.md:45,57`) despite the redesign rule "titles name the page, never its plugin".
8. **Wizard dead ends.** Leaving to AI accounts/Projects closes it until a later load (no resume at step 2). "No composer is open. Open a thread, then insert again." is still in code (`setup-wizard.tsx:128`) though the plan says it is unreachable (`plans/onboarding/README.md:50`). Checklist has 4 items, wizard covers 3 (GitHub CLI never asked). "Don't show again" is the only persistent skip, worded as a permanent opt-out on step 1.
9. **Empty states rarely lead anywhere.** 66 of 81 `<EmptyState>` uses have no action. A fresh profile hits many of them (Inbox, Land, Usage, Traces…).
10. **Visual density on Getting started.** Each pack card carries summary + 4-6 chips + prerequisites + 1-2 setting links + 2-3 buttons; 8 cards in a 2-column grid (`show-me-where.png`). Feature rows add up to 3 verbs each. Two separate "try" ideas (Start setup vs Try it) and three "go" verbs (Open / Show me where / Try it) per row.
11. **Stale screenshots in READMEs contradict the redesign.** `workbench/docs/screenshots/empty-thread-welcome.png` and `main-tabs/docs/screenshots/workbench-semantics-provider.png` show the pre-rail sidebar ("Thread Sidebar: Navigati…", "More" footer, "Current conversation" entry that README says no longer exists). New users reading docs get a different app.
12. **No new-user install doc.** README is maintainer-oriented ("A personal … setup", `README.md:3`); `dshx init` is buried in `docs/profile-installs.md:22-25`; a Core-only `dshx init` likely omits `onboarding` itself (`packs.ts:30`, unverified).

## Genuinely good — keep

1. **Self-ticking checklist read live from the Host**, each item with its own fix (route / copy command) (`getting-started-page.tsx:62-111`). Honest, cheap, no model call.
2. **Wizard is conditional** (only when account or project missing, `first-run.ts:14-24`), replayable from ⌘K, and **Insert prompt never sends**.
3. **Show me where** never acts, advances on evidence, handles phone `reachNarrow`, explains unreplayable steps (`walk-controller.ts`, README §Show me where). Strong primitive once `reach` data is fresh.
4. **Pack change preview** is exact, cancellable mid-run, honest partial verdicts, no auto-restart (`pack-change-dialog.tsx`, `pack-plan.ts`).
5. **Token-spending and data-reading features off by default** (Try it, Suggestions) with clear one-line opt-in.
6. **Agent parity**: `onboarding_overview`, `onboarding_reach`, etc. let the agent answer "how do I get to X" with the same data.
7. **One catalog as source of truth** (generated, staleness-tested, `features:check` requires an `onboarding` block per UI plugin) — the right base for any simplification.
8. Account and project setup pages themselves are good guided flows (ai-accounts quick setup; workspace-folder-picker inspect-before-register, `docs/project-onboarding.md`).
9. 390 px layout of Getting started works (stacked packs, scrolling chips, 44 px targets).

## Open questions / unverified

1. Whether DeepSeek sign-in step renders with `llm-deepseek` disabled (code read only).
2. Whether a Core-only `dshx init` profile pulls `onboarding` in via suppliers.
3. Exact first-load control count needs a live fresh profile; numbers above come from screenshots of a seeded scratch profile.

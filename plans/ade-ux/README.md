# One Agent Development Environment: the unified UI/UX plan

**Status:** approved 2026-11-04 ("yes do it"); being implemented autonomously. Decisions in §10.
**Written:** 2026-11-04, from six research reports in [`research/`](research/).

Resume here: phases 0–6 are on main. Work the [follow-up checklist](#follow-up-checklist) top to bottom (the rollout item first: it needs the user), then write one plan per Phase 7 bet. Open items live only in that checklist; the table keeps what shipped.

## 11. Progress

| Phase                    | State                                              | Revision / notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Ground truth          | done                                               | Catalog `surface`/`destination`/`currentSurface` on all 339 features, checked by `features:check`; [migration map](migration-map.md) via `pnpm ade:migration-map`. [Baseline](baseline/README.md): 41 WebKit shots (desktop, 390×844 phone, 3 dark) with 30 defects. Usage data records agent tools only, not navigation, so it cannot pick the rail: keep the seven destinations and add a client navigation counter in Phase 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1. Language and kit      | done                                               | 1a done: page kit in plugin-ui (`Page`, `PageSection`, `EmptyState`, `StatusGlyph`, `EntityRow`), [DESIGN.md](../../DESIGN.md), `node --run check:copy` ratchet (286 hits), Activity/Jobs/MCP migrated. 1b: landed agents, agent-communication, agent-toolkit, memory, secret-catalog, worktree-memory, traces, usage (+ kit `fill` mode). Then landed ai-accounts, multi-host, pulls-review, backlog, jj-integration (renamed Land), jujutsu after a main-vs-branch journey comparison showed no regressions (branch failures ⊆ main's; multi-host journeys fail 0/6 on main too, so its UI is unverified).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2. One inbox             | done (follow-ups listed)                           | 2a done: `@dshfiles/activity-timeline/attention-api` contract + Host store (dedupe, resolve, snooze until time/change, done/reopen, mute), `attention_*` agent tools, Inbox page with the only Needs-you badge, providers agent-questions (child→parent questions answerable in place) and thread-sidebar (finished/failed turns). 2b done: providers jj-integration (blocked → failed with Retry, ready → Land), ai-accounts (quota → Resume), backlog (needs-input/blocked/waiting; its view links to the Inbox), traces (firing alerts), hmr-gate (restart pending, no restart verb), native ask_user_question forms (in agent-questions; timed-schema forms only). Agent-question items are proven Host-level                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3. Shell and navigation  | done                                               | E2E drift fixed (`jj:rywpqpkx`): thread-sidebar 40/50, all 10 failures pre-date the rail; fix `jj:zokyrtoz` keeps the open thread on rail return. 3a rail and destinations (`ade-shell`): thread-sidebar `destinations` module (8 entries, every former left-nav page a section), fixed layout default with Layout › Free docking keeping saved Workbench layouts, phone bottom tab bar, "Where did a page go?" from the migration map, private navigation counter (`shell_navigation_counts`); evidence in [phase3a](phase3a/README.md). 3a landed (`jj:tyvssuum`) with e2e helpers switched to the rail and a dshx fix that shares a storage domain across a plugin reload (a rebuilt Host bundle used to crash the Host with `already-open`). 3b part B landed: one Settings page in the stage grouped by the §4.6 task groups, search over key bindings, dialog/expanded dialog/side panel removed, Jev settings under Tools & MCP, tab titles without plugin prefixes ([evidence](phase3b/settings/README.md)). 3b part A done in `ade-3b-list` ([evidence](phase3b/README.md)): All threads grouped Pinned · Needs you · Working · Ready · Idle · Done as a projection of the inbox, subagent roll-up, `StatusGlyph` rows with one inline verb, Inbox Done clears the row's unread dot, and the frame-layout status strip (`@dshfiles/frame-layout/status-strip`) with Quota, N working and Restart pending items.                                                                                                                                                                                                                                                                                                                                                                 |
| 4. Thread loop           | mostly done (landed `jj:ouvutpvs`)                 | 4a (review → land) landed ([evidence](phase4/README.md)): pulls-review owns the thread panel **Changes** facet (This turn / Whole thread / Uncommitted / vs main, file list, one diff view, viewed marks, line comments that become composer chips through the dshx `Composer` contract) with the **Land card** on top (behind-by, conflicts, undescribed, project-check receipts, previewed Land through jj-integration's guarded `land`, Land when idle, History). One viewed-marks store in diff-viewed (turn keys unchanged, new revision-range keys; the Review page's old record migrates once). The turn card, the jujutsu composer bar, Land rows and the Review page open the facet (`Changes` contract); a land from any view resolves its Inbox item at once. Gaps: revision scopes need jj (the VCS port has no diff verb, so git-worktree workspaces get This turn only); no rebase-without-land verb, so "Rebase only" is History's previewed rebase; the facet has no phone presentation until Phase 6 sheets. 4B composer done in `ade-4b-composer` ([evidence](phase4/composer/README.md)): one run row `project · host · workspace · agent mode · file access · model` over a new thread's input (rich-composer places the owners' slots; jj-integration's bookmark chip + checkbox became one Workspace segment), summary chip + meter line once started, projects-only picker, phone row scrolls in one line. Agent mode and File access stay two segments (no supported API to set both); no "share with a thread" (jj-integration forbids sharing a thread workspace). New thread with defaults: 0 chip changes. The workspace default stays the isolate-by-default setting: a per-project last choice overrode that explicit setting and broke a guarded journey. |
| 5. Observe and configure | done (follow-ups listed)                           | 5a landed (`jj:nwtqsoln`, [evidence](phase5/README.md)): one Usage page (Cost · Quota · Requests · Tools; Quota hosts AI Accounts' Accounts/History/Forecast through `@dshfiles/ai-accounts/quota-views`), one Processes page (Jobs · Dev servers · RAM through `@dshfiles/background-jobs/process-views`), old pages redirect with former names kept; Cost and Jobs thread facets registered as native right-pane tab types. Facets in the full profile landed (`jj:xklpxuww`, [evidence](phase5/facets/README.md)): every pane's Choose a view lists Thread panels (Changes, Cost, Jobs) that follow the on-screen thread; Jobs facet proven in the browser; workbench right-pane-toggle fixed (thread list min height), responsive-main passes; native-fork-diff green. 5b landed (`jj:lornpwys`, [evidence](phase5/context/)): one `@` source and reference-preview registry in input-trigger (`entity-registry`; one preview card, the three per-plugin overlays removed; chat's InlineReferences links open it), a read-only Context facet in agent-toolkit (instruction files, agent, memory start block, skills, MCP, references, ≈tokens), one shared Jev key in settings-shell (`jevSecret`; precedence shared > legacy > TYPESAFE_API_KEY, one-time adopt never overwrites, legacy fields hidden not deleted).                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6. Phone                 | done (`jj:uxnmmuuz`, [evidence](phase6/README.md)) | 44px touch targets on coarse pointers (plugin-ui), phone frame on 100dvh that sits on the keyboard with the status strip as a top-bar dot (frame-layout), stack navigation with Back and a touch ⋯ row menu (thread-sidebar), thread panel as a bottom sheet with Changes/Cost/Jobs/Context (workbench), Settings rows wrap (settings-shell). All 29 audited screens at 390×844 WebKit have no overflow; the scripted phone journey passes 10/10; desktop e2e matches main.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7. New bets              | not started                                        | each needs its own plan (Race, fan-out approval card, snooze-until-needed, QR pairing + push, forge/PR per thread, meta-agent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Follow-up checklist

Every open item from phases 0–6, in one place (checked 2026-11-05 against `jj:nwvuzwry`). Items marked
**owned elsewhere** sit in areas other agents are changing now; do not start them from this plan, hand them to that
owner.

**Rollout (needs the user)**

- [ ] Restart the live DSH Host when convenient. Host halves changed in activity-timeline, agent-questions,
      thread-sidebar, jj-integration, ai-accounts, backlog, traces, hmr-gate, diff-viewed, agent-toolkit, references,
      settings-shell and memory; rebuild the canonical checkout first (`dshx checkout sync`).

**Inbox and attention (Phase 2)**

- [x] ~~Unify the thread-sidebar unread dot with the inbox~~: the attention API publishes changes and Done clears
      every record of the thread (`fix(thread-sidebar): keep the unread dot and its Inbox item in step`).
- [x] ~~`⌥J` jumps to the next Needs-you item~~ (`feat(activity-timeline)`; a capture listener, since the Web registry
      refuses ⌥-letter defaults).
- [ ] Browser push for blocking items (needs a Host/service-worker feasibility check; record a Host gap only if no
      plugin route works).
- [ ] Native `ask_user_question` forms reach the Inbox in scratch (provider covers timed-schema forms only).

**Thread list and shell (Phase 3)**

- [x] ~~Agent `@handle` on rows~~: agents serves a read-only `threadHandles` contract that thread-sidebar reads (a
      registry agents provides would close a dependency cycle through jj-integration → memory → agents).
- [x] ~~One restart notice~~: thread-sidebar owns one strip item for Host-file changes and hmr-gate's held-back
      bundles (`restart-sources` registry), with the Restart verbs; the footer rows are gone. A populated item is not
      yet seen in scratch: thread-sidebar's Host `pending` call errors there (also on the old footer).
- [x] ~~Copy~~: rail page labels lost their plugin prefixes; the ratchet dropped 20 → 12. The 12 left are Workbench view
      titles.
- [x] ~~Notifications settings group empty~~: thread notifications are their own section in Notifications
      (`feat(thread-sidebar)` / `feat(settings-shell)` on this line, 2026-11-05).

**Thread loop (Phase 4)**

- [ ] Done / Restore releases and recreates the workspace (C3 in [t3code parity](../t3code-parity.md)).
- [x] ~~Walkthrough card~~: turn-summary renders `ActivityDock` after a turn that changed files, with Review in
      Changes (setting `walkthrough`).
- [x] ~~Step timestamps and durations~~: already shipped by `@dshfiles/tool-meta` on every tool card.
- [ ] git-worktree workspaces get only the This-turn Changes scope (the VCS port has no diff verb); no
      rebase-without-land verb (History's previewed rebase stands in).
- [x] ~~zh copy for the Workspace segment~~ (`fix(jj-integration)` on this line, 2026-11-05).

**Observe, configure, phone (Phases 5–6)**

- [ ] Physical iPhone test; iOS back swipe moves between threads; native header, composer chips and the core font
      stepper are still under 44 px.
- [x] ~~Context facet in Choose a view, stale facet tab after a Host restart~~: neither reproduces; a journey now
      covers both. Open facet pages also show "Open a thread…" once their thread tab closes, and a frame-layout hot
      reload no longer blanks the page.

**Unproven journeys and e2e debt**

- [ ] Re-run on main: verification-evidence (fails at a native-sidebar step after its Activity checks),
      secret-catalog Jev chat scenarios, input-trigger entity-registry (cannot send in its composition), journey 3
      question card (did not render in scratch), subagent nesting in the browser (core tool-scheduler error).
- [x] ~~8 ai-accounts usage-strip journeys~~ follow quota into the status strip (`test(e2e)`). Still failing on main
      and on this line: ai-accounts quota-forecast, dashboard-reference, sidebar-add, login-methods,
      fast-mode-supported, thread-account-switch (account page drift).
- [x] ~~Settings changes lost after a reload~~: dshx keeps each settings write until the Host confirms it and replays
      it on the next page.
- [x] ~~Status strip with every item hidden~~ keeps a control to show items again.
- [x] ~~Workbench thread tabs lost the sticky composer and hero centering~~ after they switched to the main variant;
      phase rules now key on the content body, and squeezed status items clip instead of overlapping (2026-11-06).
- [ ] Multi-host journeys fail 0/6 on main too, so its Phase 1 UI is unverified.
- [ ] Pre-existing failures (2026-11-05 recount): thread-sidebar section-order and navigation-layout, the
      ai-accounts six above (jujutsu composer-context fixed 2026-11-06: its summary opens the Changes facet); workbench/main-tabs/editor journeys are flaky under load
      (workbench-terminal now has its Free docking step but its move/probe steps still flake).
- [x] ~~Scratch `dshx dev up` in a fresh workspace~~: `verify-dsh` now prepares the workspace (install, build dshx and
      plugin-ui); `dev up` builds its bundles and starts the checkout's `node_modules/.bin/dsh`, so no
      `DSHX_DSH_EXECUTABLE` (2026-11-06).

## 1. Why this plan exists

The web profile mounts 77 owned plugins and 339 catalog features
([inventory](research/inventory.md#0-what-the-profile-actually-mounts)). Each plugin was built to solve
a real problem, and most of them work. The trouble is that each one also brought its own page, nav entry,
header style, attention signal and settings place. So the product has many correct parts but no single shape.

| Symptom                                              | Today                                                        | Evidence                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Left-nav entries                                     | 21 (AI Accounts alone has 3)                                 | [inventory §4](research/inventory.md#4-counts-per-surface-mounted-profile)        |
| Main panels / right-pane tabs / overlays             | 24 / 8 (+4 native) / 16                                      | same                                                                              |
| Independent "needs you" systems                      | ≥ 8, each with its own words and counter                     | [current-ux §3.5](research/current-ux.md#35-competing-attention-signals)          |
| Surfaces to review and land work                     | 4–5, using 5 verbs (Rebase, Integrate, Land, Commit, Settle) | [current-ux §2 #4](research/current-ux.md#2-primary-journeys-today)               |
| Places that show cost or usage                       | ≥ 7, including two full dashboards                           | [inventory §3.1](research/inventory.md#3-overlaps-and-seams)                      |
| Project pickers                                      | ~8 separate implementations                                  | [inventory §3.6](research/inventory.md#3-overlaps-and-seams)                      |
| Page-header styles / tab styles / empty-state styles | 5 / 4 / 6                                                    | [current-ux §3.1](research/current-ux.md#31-visual)                               |
| Words for one conversation                           | thread, session, chat, conversation                          | [current-ux §3.3](research/current-ux.md#33-naming)                               |
| Phone layout                                         | none designed; the icon rail stays at 360 px                 | [current-ux §3.6](research/current-ux.md#36-mobile-iphone-chromewebkit-360390-px) |

Other tools have most of the same capabilities. **The difference is the shape, not the feature list.**
Every competitor we studied picks **one primary object** and hangs every capability off it
([competitors-c](research/competitors-c.md#where-dsh-sits)). Every IDE-based product now separates a
**manager view** from the editor, which you open only to drill into one session
([competitors-b](research/competitors-b.md#divergent-bets)). We show 80 plugins side by side instead.

## 2. What the research says (short)

| Source                                     | What it covers                                                                  | Main takeaway                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [inventory](research/inventory.md)         | Every mounted plugin, by user job; 19 overlaps                                  | Duplication is concentrated in 6 areas: attention, cost, review/land, pickers, settings, navigation                          |
| [current-ux](research/current-ux.md)       | Current shell, 8 journeys, visual and naming seams, mobile                      | The parts are good; the joins are bad. A list of 13 things to keep                                                           |
| [competitors-a](research/competitors-a.md) | T3 Code, Codex (now inside the ChatGPT app), Claude Code (Code tab, agent view) | 3–4 top-level destinations; the thread list _is_ the attention queue; plugins add panel tabs and session cards, not pages    |
| [competitors-b](research/competitors-b.md) | Cursor, Zed, VS Code + Copilot, Antigravity, Air, Devin                         | Manager view first, editor as drill-down; every panel follows the active session or is global; one precise "needs you" count |
| [competitors-c](research/competitors-c.md) | Conductor, Paradev, Amp, Warp, Devin, Vibe Kanban, Kiro, OpenCode               | One primary object; 5-state status set; answer-in-place inbox; archive aggressively; phone as a remote control               |
| [prior-art](research/prior-art.md)         | VS Code, JetBrains, Linear, GitHub, Slack, Buildkite, Apple/Material            | A fixed shell with ~9 regions and ~9 contribution kinds; one inbox with severities; "dark cockpit"; list-detail on phone     |

The four independent research tracks agree on six points. That agreement is why the plan treats them as decisions
rather than options:

1. **One primary object: the thread.**
2. **One status vocabulary** used on every row, badge, notification and phone.
3. **One inbox** for everything that needs you, answered in place. Badges only mirror it.
4. **A small fixed shell** that plugins fill. Plugins add tabs, rows, cards and commands; they don't add chrome.
5. **One review → land loop per thread**, with one verb.
6. **The same structure on the phone**, collapsed into a stack.

Caveat on evidence: web search was unavailable in every research session (no Brave key). All competitor
claims come from first-party pages fetched directly, and each is labelled verified, best-effort or unknown in its
report. User complaints were only searchable for Cursor. The prior-art JetBrains/Apple/Material/Slack/Buildkite
patterns came from general knowledge and were not re-fetched. None of this changes the six points above, but check
the reports before quoting a specific vendor detail.

## 3. The product in one sentence

> **A thread is one agent doing one job. It owns its conversation, its isolated workspace, its jobs, its questions,
> its artifacts and its cost. Landing its workspace on `main` finishes it.**

Everything else in the ADE is one of three things:

- a **facet** of a thread (its changes, files, terminal, jobs, cost, context, side chat, subagents);
- a **view over many threads** (the thread list, the inbox, the land queue, usage, traces);
- **configuration** that threads use (accounts, models, MCP, secrets, agents, policies, plugins, hosts).

Backlog items, goals, schedules and configured agents are things that _start or steer_ threads. They are not
peers of the thread.

### Glossary (enforced in copy)

| Use           | Instead of                                       | Notes                                                                                                   |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **thread**    | session, chat, conversation                      | "Session" stays only in API/tool names and developer docs                                               |
| **project**   | workspace (for the folder), repository, folder   | A registered checkout                                                                                   |
| **workspace** | worktree, thread workspace, JJ workspace         | Only the isolated copy a thread works in. Git worktrees are a workspace _provider_, not a separate word |
| **host**      | runtime, machine, environment                    | Where a thread runs                                                                                     |
| **land**      | rebase, integrate, commit, ship                  | Put a workspace's work on the target bookmark. Rebase stays as an advanced action in History            |
| **done**      | settle, archive, park                            | Lifecycle end; releases the workspace. **Restore** reverses it                                          |
| **agent**     | preset, persona                                  | A configured `@{handle}`; presets become an agent property                                              |
| **Needs you** | attention, input needed, answer, action required | The single attention label                                                                              |
| **usage**     | cost, quota, requests, analytics                 | One destination; cost and quota are tabs within it                                                      |
| **memory**    | —                                                | Agent knowledge only. Process RAM becomes "RAM" inside Processes                                        |

A copy check (a lint rule over plugin client strings and catalog labels) enforces this after Phase 1.

## 4. The shell

### 4.1 Layout

```
┌──┬───────────────────────┬─────────────────────────────────────────────┬──────────────────────────┐
│R │ LIST                  │ STAGE                                       │ THREAD PANEL             │
│A │ (one view at a time)  │                                             │ (follows the stage's     │
│I │                       │  Thread header: title · project · host ·    │  thread; collapsible)    │
│L │ Threads               │  workspace state · status · ⋯               │                          │
│  │ ▸ Needs you (3)       │  ─────────────────────────────────────────  │ [Changes][Files][Term]   │
│◉ │   ◆ fix-auth  Answer  │  Transcript                                 │ [Artifacts][Jobs][Cost]  │
│✉3│   ✕ api-race  Retry   │   turn · work group · turn summary          │ [Context][+]             │
│⇪ │ ▸ Working (5)         │   question / approval / fan-out cards       │                          │
│☰ │ ▸ Ready (2)           │   inline in the transcript                  │  Changes                 │
│◎ │ ▸ Idle                │                                             │  scope: turn ▾           │
│∿ │ ▸ Done (folded)       │  ─────────────────────────────────────────  │  3 files · +42 −7        │
│  │                       │  Composer                                   │  ┌ Land card ──────────┐ │
│  │                       │  [project ▾ · Local ▾ · own workspace ▾ ·   │  │ behind main by 2    │ │
│⚙ │                       │   mode ▾ · model/account ▾]   ctx 41% $0.38 │  │ checks ✓  [Land]    │ │
├──┴───────────────────────┴─────────────────────────────────────────────┴──────────────────────────┤
│ STATUS STRIP  host ok · 5 working · quota CC1 72% ↻2d · restart pending           thread: $0.38 · 41% │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
 Overlays: ⌘K palette · Inbox sheet (when not in rail view) · confirm dialogs · one toast
```

| #   | Region                                 | Holds                                                                 | Replaces today                                                                                                      |
| --- | -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| R1  | **Rail** (≤ 7 destinations + Settings) | Destination switchers with one badge (Inbox)                          | 21-entry Navigation list, collapsed icon rail, New-tab chooser                                                      |
| R2  | **List**                               | Exactly one view for the current destination                          | Thread sidebar panels with their own Dockview tab strips                                                            |
| R3  | **Stage**                              | A thread, or one detail page (settings page, a trace, the land queue) | Workbench centre tabs as the default                                                                                |
| R4  | **Thread panel**                       | Facet tabs of the stage's thread                                      | Sidebar-right fork, workbench dock, 8 plugin right tabs                                                             |
| R5  | **Status strip**                       | ≤ 1 item per plugin; global left, thread right                        | Sidebar footer quota cards, three restart notices, composer footer stats                                            |
| R6  | **Palette** (⌘K)                       | Every command, every entity search                                    | Palette + sidebar search + memory thread search                                                                     |
| R7  | **Inbox**                              | Attention items only                                                  | Activity attention, backlog Inbox, sidebar labels, integration "Needs attention", quota continuations, trace alerts |
| R8  | **Settings**                           | One schema-rendered page with task groups and scopes                  | Four settings presentations + in-panel settings + MCP/Secrets/Accounts pages                                        |
| R9  | **Toast**                              | One at a time; only confirms the user's own action, with Undo         | Two toast styles used for agent events too                                                                          |

Docking (Workbench) stays as an **advanced layout mode** (Settings › Layout › "Free docking"). The default layout
is the fixed one above, with no Dockview chrome inside the list. Saved layouts keep working in docking mode; the
`dshfiles.workbench.*` and `dshfiles.main-tabs.v1` keys are migrated, not dropped
([slot inventory, persistence](../../docs/workbench-slot-inventory.md#persistence-inventory-and-migration-obligations)).

### 4.2 Destinations (rail)

Seven, chosen by user job rather than by plugin. Final membership should be checked against 30 days of
`usage_activity_report` data in Phase 0.

| Destination             | List view (R2)                                                 | Stage details (R3)                              | Absorbs plugins                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Threads** (default)   | Threads grouped by status, filterable by project/agent/host    | The thread                                      | thread-sidebar list, home hero, main-tabs, board view as a list toggle                                                                          |
| **Inbox** ✉             | Needs you / Other                                              | The item, answerable in place                   | activity attention, backlog inbox, agent-questions inbox, integration "needs attention", quota continuations, trace alerts                      |
| **Land** ⇪              | Workspaces ready, blocked or conflicted, across threads        | Review + land page; repo **History** (jj graph) | jj-integration thread integration, jujutsu graph and Source Control, pulls-review, git-worktrees status                                         |
| **Work** ☰             | Backlog items, goals, schedules/automations                    | Item detail, start thread from item             | backlog, goal-tool view, native schedules, agent-calendar (proposed)                                                                            |
| **Agents** ◎            | Configured agents, live agent tree (parents, subagents, comms) | Agent detail and its threads                    | agents, agent-communication, agent-toolkit inventory, agent-preset                                                                              |
| **Observe** ∿           | Usage, Activity, Traces, Processes, Hosts                      | Dashboards and detail                           | usage, ai-accounts usage/forecast, traces, activity-timeline log, background-jobs, worktree-memory (RAM), preview dev servers, multi-host fleet |
| **Knowledge**           | Memory, references, past-thread search                         | Note/digest detail                              | memory, references, session-search                                                                                                              |
| **Settings** ⚙ (bottom) | Task groups                                                    | Settings page                                   | everything in §4.6                                                                                                                              |

Knowledge may fold into Work if usage data shows it is rare; that would leave 6 + Settings.

### 4.3 The thread list

- Groups by status: **Needs you · Working · Ready · Idle · Done** (Done folded, auto-fold after 72 h idle).
  **Pinned** sits above groups. "Arrange manually" is an opt-out, because status sorting makes rows move.
- Within a group, sort by "came back to you" (T3) rather than creation time.
- Row anatomy, one shape everywhere: `status glyph · title · agent @handle · project/host chips (muted) · elapsed ·
cost (muted) · one inline verb when it needs you (Answer / Approve / Land / Retry / Resume)`.
- **Dark cockpit:** working rows are colourless. Only Needs you, Failed and unread Ready get emphasis.
- Subagents nest one level under their parent, with their state rolled up: a parent never looks finished while a
  child failed or waits.
- Lifecycle verbs, identical in row menu, palette and agent tools: **New, Fork, Side chat, Move to host, Snooze
  (until it needs me / until time), Pin, Done, Restore, Delete**. Every move shows a toast with Undo.
- "Board" is a display toggle of the same list (columns = status), not a second page.

### 4.4 The thread stage and panel

**Header:** title, project, host, workspace state ("own workspace · 3 changes · behind main by 2"), status,
overflow menu. No sub-tabs in the header: Trajectory, Traces and Requests move to panel tabs or the transcript.

**Transcript** keeps what works today (collapsed work groups, turn summary, per-turn diff card, windowed rendering)
and adds:

- timestamps and durations on every step;
- every card that needs a human renders inline: user questions, child→parent questions, approvals, fan-out
  approval ("this will start 4 subagents on routes …"), quota continuation (Resume / Resume at reset / Switch account);
- a **walkthrough** card at the end of a turn that changed code: what changed, what was checked, what to look at.

**Panel facets** (R4). Each facet follows the stage's thread; a facet that is not about the thread does not belong
here.

| Facet         | Content                                                                                                                                                                     | From                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Changes**   | Scope switch (this turn / whole thread / uncommitted / vs main), file tree, diff with viewed marks and line comments that queue as composer chips, **Land card** at the top | native review tab, diff-viewed, pulls-review, jj-integration rebase |
| **Files**     | File tree and preview, editor on open                                                                                                                                       | native Files/preview, editor                                        |
| **Terminal**  | Thread terminals                                                                                                                                                            | native terminal                                                     |
| **Browser**   | Preview pages and the thread's dev servers with Stop                                                                                                                        | preview                                                             |
| **Artifacts** | HTML renders, screenshots, test receipts, check receipts, plans, walkthroughs, linked backlog items                                                                         | html-render, test-runs, project-checks, backlog links               |
| **Jobs**      | Background jobs, processes, RAM for this thread                                                                                                                             | background-jobs, worktree-memory                                    |
| **Cost**      | Route, serving account, quota left, per-turn cost, requests, a link to its traces                                                                                           | ai-accounts, usage, traces conversation views                       |
| **Context**   | What is loaded and its token cost: AGENTS.md, skills, MCP servers, memory start block, references, agent instructions                                                       | agent-toolkit, memory, references, mcp-servers                      |
| **Side chat** | `/btw`                                                                                                                                                                      | btw                                                                 |
| **Agents**    | Subagents and messages, with live status pills                                                                                                                              | agent-communication, subagent sidebar                               |

### 4.5 The composer

One **run row** above the input replaces the 7 chips: `project ▾ · host ▾ · workspace ▾ (own / share with … /
in place) · mode ▾ · model + account ▾`. It defaults from the project's last choice and collapses into one summary
chip once the thread has started. "Mode" merges the agent mode and the sandbox permission dropdowns into one
documented choice. The model picker is the one place to switch account or fallback for this thread.

Below the input, one meter line: `context 41% · $0.38 · 2 queued`. The rest (prompt stash, mentions, attachments,
annotations, queue editing, ArrowUp recall) stays as today.

**New:** Shift-select several models to **Race** one prompt into N threads with their own workspaces, then compare
in Land. ⌘↵ sends and opens a fresh draft (start in background).

### 4.6 Settings

One page (R3), grouped by task, searchable (including key bindings), with a scope control (global / project /
thread) that shows "Mixed" when values differ. In-panel settings become deep links into it.

| Group                 | Contents                                                                          |
| --------------------- | --------------------------------------------------------------------------------- |
| General               | Appearance, language, layout mode (fixed / free docking), shortcuts               |
| Models & accounts     | AI accounts, models, routing/fallbacks, Fast mode, pricing                        |
| Agents                | Agent definitions, presets, delegation limits, memory scopes                      |
| Tools & MCP           | MCP servers, MCP endpoint, skills, web search, Jev key (once)                     |
| Projects & workspaces | Projects, workspace provider (jj / git), auto-cleanup, auto-fetch, project checks |
| Hosts & network       | Hosts, network/loopback access                                                    |
| Security              | Secrets catalog, policies, privacy, sandbox defaults                              |
| Notifications         | Per source: inbox / push / mute; quiet hours                                      |
| Plugins               | Installed, marketplace, plugin updates and restarts                               |
| About                 | Version, release notes, diagnostics                                               |

### 4.7 The status vocabulary

One set of states for every work item (thread, subagent, job, check, workspace, host). Plugins map their own
states onto it and may add detail text, never new colours.

| State         | Meaning                              | Glyph              | Inbox severity | Examples mapped onto it                                                                 |
| ------------- | ------------------------------------ | ------------------ | -------------- | --------------------------------------------------------------------------------------- |
| **Working**   | progressing without you              | spinner, no colour | —              | turn running, job running, waiting for CI or a child (detail: "waiting on 2 subagents") |
| **Needs you** | cannot continue without you          | accent ◆           | blocking       | question, approval, fan-out approval, quota choice, child→parent question escalated     |
| **Failed**    | broke, with a recovery verb          | danger ✕           | failed         | failed turn, jj conflict, failed check, MCP server down, alert firing                   |
| **Ready**     | finished, not yet seen or landed     | bold row           | ready          | turn finished unread, workspace ready to land                                           |
| **Idle**      | seen, nothing pending                | none               | —              | read thread, parked                                                                     |
| **Done**      | landed or closed; workspace released | muted ✓            | —              | landed, settled, archived                                                               |

### 4.8 The attention model

- **The inbox is the only source of truth** for "needs you". Every badge, row emphasis, tab title count and push
  notification is a projection of inbox state. No plugin keeps its own unread or attention counter.
- An item has: `reason`, `source`, `subject` (usually a thread), `severity`, `verbs` (Answer, Approve, Land, Retry,
  Resume, Open, Done, Snooze, Mute source), `dedupeKey`, and a **resolve condition**. Items close themselves when the
  underlying state changes (answered elsewhere, retry passed).
- Severities: blocking and failed go in **Needs you**; ready goes in **Other** (users can promote it); info goes
  only to the Activity log in Observe.
- **Toasts** only confirm the user's own action. **Agents never open modals.** Push (browser now, phone later) only
  for blocking items, per source, opt-in.
- **Jump to next waiting** (`⌥J`) cycles through Needs you items.

## 5. The plugin presentation contract

The shell owns regions, chrome, status vocabulary, attention and navigation. Plugins contribute declarative
items into a fixed set of points. A plugin that cannot fit is a design question for the shell, not a new ad-hoc
slot.

| Contribution                 | Lands in                                          | Rule                                                                |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| `command`                    | Palette, menus, key bindings                      | Required for every user capability; already bound to its agent tool |
| `destinationSection`         | A list/detail inside one of the §4.2 destinations | Plugins don't add rail entries                                      |
| `threadFacet`                | Thread panel tab                                  | Must be about the active thread                                     |
| `detail`                     | Stage                                             | Built from plugin-ui page primitives                                |
| `rowDecorator` / `rowAction` | Thread and item rows                              | Owner declares the registry; providers depend on it (one-way rule)  |
| `transcriptCard`             | Inline in the transcript                          | Existing chat node and turn-tail slots                              |
| `composerContribution`       | Run row, chips, `/` and `@` sources               | `@` sources go through one mention registry                         |
| `statusItem`                 | Status strip                                      | At most one per plugin, text first                                  |
| `settingsSection`            | Settings                                          | Schema plus group (§4.6) plus scope                                 |
| `attentionProvider`          | Inbox                                             | The only way to get the user's attention                            |
| `entityProvider`             | Palette search, `@` mentions, reference previews  | One preview overlay renders all entity kinds                        |

Rules, enforced by checks like the existing workspace contract:

- **No new chrome:** no plugin-owned sidebars, banners, floating windows or notification UI.
- **Group by destination, not package:** labels never show plugin names ("pulls.review: Reviews" goes away).
- **One page template** in `@dshfiles/plugin-ui`: `Page` (header, description, one primary action, tabs),
  `EmptyState` (sentence + action), `ProjectScope` (defaults to the current thread's project), one primary button
  style, sentence-case labels, one table and one list row.
- **Every contribution has a compact (phone) behaviour.**
- **Catalog fields:** each `dshx.features.json` feature declares `surface` and `destination`. `features:check`
  rejects unknown values. That also gives us the inventory for free from now on.

## 6. Where each overlap goes

| Overlap ([inventory §3](research/inventory.md#3-overlaps-and-seams)) | Decision                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost/usage in 4–6 places                                             | Observe › Usage merges usage + ai-accounts history/forecast (one dashboard, tabs: Cost, Quota, Requests, Tools). Traces stays a separate Observe tool. Thread › Cost facet. Quota in the status strip; sidebar footer cards removed |
| Three attention feeds                                                | One inbox (§4.8). Activity timeline becomes the info log in Observe                                                                                                                                                                 |
| Questions split in two plugins                                       | One question card component; agent-questions feeds the inbox and renders child→parent questions in the parent thread                                                                                                                |
| jj-integration vs jujutsu vs git-worktrees                           | Land destination + Changes facet; jujutsu graph becomes Land › History; git-worktrees is a provider behind the same UI                                                                                                              |
| Three diff viewers, two viewed stores                                | One Changes facet with scopes; one viewed-marks store keyed by revision and file                                                                                                                                                    |
| ~8 project pickers                                                   | One `ProjectPicker` (from project-folder-picker) that lists projects, never thread workspaces                                                                                                                                       |
| Two model pickers + account switch twice                             | model-effort-picker owns the slot; model-selection's draft behaviour folds into it; ai-accounts' thread switch becomes its action                                                                                                   |
| Settings in 4 presentations                                          | One Settings page in the stage (§4.6); side-panel and dialog presentations removed                                                                                                                                                  |
| main-tabs vs workbench                                               | main-tabs owns tab semantics in fixed mode; workbench only in free-docking mode                                                                                                                                                     |
| 7 `@` sources, 3 preview overlays                                    | One mention registry and one reference preview (entityProvider)                                                                                                                                                                     |
| 3 restart notices                                                    | One status item + one inbox item from hmr-gate                                                                                                                                                                                      |
| Interrupted / quota-blocked shown twice                              | Thread state (Needs you + verbs) only                                                                                                                                                                                               |
| Queue editing in two plugins                                         | queue-reorder UI; thread-sidebar keeps only the agent tools                                                                                                                                                                         |
| Processes in 3 boards                                                | Observe › Processes (jobs, dev servers, RAM), filtered per thread in the Jobs facet                                                                                                                                                 |
| thread-sidebar mega-plugin                                           | Split: list + lifecycle stay; attention moves to the inbox owner; search to the palette; header actions to the thread header owner                                                                                                  |

## 7. Ownership and architecture

Follow [plugin boundaries](../../docs/plugin-boundaries.md) and [native forks](../../docs/native-forks.md). No core
patches.

- **Shell owner:** `frame-layout` (regions, status strip, rail) with `thread-sidebar` (list) and `sidebar-right`
  (thread panel). They declare the registries in §5 as dshx modules (`defineRegistry` / `defineContract`). Feature
  plugins already depend on them, so dependencies stay one-way.
- **Attention service:** a Host-owned registry with plugin-owned storage (dedupe, resolve, snooze, mute). Recommend
  **extending `activity-timeline`**, which already stores events with an attention level on the Host, rather than
  a new plugin. Backlog's Attention Inbox, thread-sidebar's attention classification and agent-questions' inbox
  become providers. Notification delivery (browser push) is an output of this service.
- **Page kit:** `@dshfiles/plugin-ui` gains `Page`, `EmptyState`, `ProjectScope`, `StatusGlyph`, `EntityRow`.
  `ui-styles` gets the tokens. A `DESIGN.md` records them (via `impeccable document`).
- **Host gaps to check before building** (record in [Host gaps](../dsh-host-gaps.md) only if no plugin route works):
  web push from the Host (service worker + VAPID keys owned by a plugin?); whether native forms
  (approval, user-questions native fork) can emit into a plugin attention registry without core changes; settle on
  Done releasing workspaces Host-side (C3 in [t3code parity](../t3code-parity.md)).
- **Upstream cost:** many of these changes touch shared plugins we sync from astahmer/dshfiles. Use the
  `dsh-upstream-sync` skill's delta rules and prefer contributions that upstream would accept (registries, page kit)
  over deep local divergence.

## 8. Phases

Each phase ships on its own and leaves the app better than before. Each ends with scratch-DSH screenshots at
desktop and 390×844 WebKit, compared with the Phase 0 baseline.

| Phase                        | Goal                                                 | Work                                                                                                                                                                                                                                                                 | Acceptance                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0. Ground truth**          | Know what to keep and how it looks now               | Capture baseline screenshots of the 8 journeys (desktop + WebKit phone) in a scratch DSH; pull 30 days of `usage_activity_report` for surface usage; write `PRODUCT.md` / `DESIGN.md`; add `surface`/`destination` to the catalog schema                             | Baseline shots committed; rail membership decided from data; glossary approved                                                                                           |
| **1. Language and kit**      | Make it look like one product before moving anything | Glossary copy pass; page kit in plugin-ui; migrate every plugin page to `Page`/`EmptyState`; one primary button, one tab style, sentence case; remove raw ids/paths from UI; fix Home's doubled headline                                                             | 1 header pattern (from 5), 1 tab style (from 4), 1 empty state (from 6); copy check passes                                                                               |
| **2. One inbox**             | Answer "what needs me" in one place                  | Attention service in activity-timeline; providers from thread-sidebar, agent-questions, user-questions, jj-integration, ai-accounts continuations, traces alerts, backlog, hmr-gate; Inbox destination; badges as projections; `⌥J`; browser push for blocking items | 1 attention system (from ≥ 8); answering a question from the inbox clears every badge; child→parent questions visible                                                    |
| **3. Shell and navigation**  | Seven destinations, fixed layout                     | Rail; destinations of §4.2; thread list grouped by status with nesting and roll-up; thread panel facets; status strip; one Settings page; palette as the only search; docking moved to an advanced mode with layout migration                                        | Rail ≤ 8 entries (from 21); no Dockview chrome in the default list; every old page reachable from a destination or the palette (a "moved to…" map ships for one release) |
| **4. The thread loop**       | Start → steer → review → land → done on one thread   | Composer run row; model picker owns accounts; Changes facet with scopes, line comments to chips, Land card; one viewed store; Done/Restore releases and recreates the workspace; walkthrough card; step timestamps                                                   | Review-and-land journey crosses 1 surface (from 4–5) with 1 verb (from 5); new thread needs ≤ 1 chip change for the common case                                          |
| **5. Observe and configure** | One place each for usage, processes, settings        | Usage merge; Processes; Hosts into Observe and Settings; one ProjectPicker; one mention registry and preview; Context facet with token cost                                                                                                                          | Cost views 1 + per-thread facet (from ≥ 7); project pickers 1 (from ~8); Jev key set in 1 place (from 4)                                                                 |
| **6. Phone**                 | Same product on an iPhone                            | Bottom tabs (Threads, Inbox, New, More); stack navigation; facets as sheets; safe-area and `dvh`; keyboard-safe composer; touch equivalents for hover actions                                                                                                        | No horizontal overflow at 390×844 in WebKit for every destination; the 8 journeys pass on phone                                                                          |
| **7. New bets**              | What competitors prove users want                    | Race (one prompt × N models); fan-out approval card and child status pills; snooze-until-needed for scheduled agents; QR phone pairing and phone push; forge/PR link per thread ([t3code parity](../t3code-parity.md) C1/C2/B4); meta-agent on a global shortcut     | Each item gets its own plan before it starts                                                                                                                             |

Phases 1 and 2 are independent and can run in parallel. Phase 3 depends on 1. Phase 4 depends on 3. Phase 6
starts design work in Phase 3 (every contribution declares compact behaviour) and finishes after 5.

## 9. Risks

- **Scale of migration.** About 60 UI plugins change. Mitigation: the kit and copy pass first (low risk, high
  visible gain), shell second, and a "moved to…" map so nothing disappears silently.
- **Other agents work on the live instance.** No live restarts; every phase is verified in a scratch DSH and
  handed to the user to roll out.
- **Native forks grow.** Thread panel, approvals and question cards live partly in native packages. Prefer slots
  and registries; fork only where private state blocks the design, and record each fork with `native-fork.json`.
- **Upstream drift.** Shared-plugin changes make syncing with astahmer harder. Upstream the generic parts.
- **Power users lose docking.** Keep free docking as a mode and migrate saved layouts.
- **Status sorting makes rows jump.** Offer "Arrange manually" and keep Pinned stable.

## 10. Decisions

The user approved the plan and delegated the open choices ("continue without asking me", 2026-11-04). These are
the defaults taken; each is reversible and can be revisited.

1. **Primary object:** the thread with its workspace. Backlog, agents, goals and schedules start or steer threads.
2. **Destinations:** the seven of §4.2 plus Settings; Phase 0 usage data may fold Knowledge into Work.
3. **Docking:** fixed layout by default; free docking is an advanced mode with saved layouts migrated.
4. **git-worktrees:** kept as a second workspace provider behind the same UI; no separate surface.
5. **Verbs:** "Land" (rebase + advance bookmark) and "Done" (settle/archive, releases the workspace; Restore reverses).
6. **Phone:** responsive web (Phase 6) and browser push for blocking items (Phase 2); QR pairing stays in Phase 7.
7. **Upstream:** generic parts (page kit, registries, attention contract) are written to be upstreamable; the rest is
   fork-only.

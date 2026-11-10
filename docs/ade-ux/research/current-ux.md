# Current UX audit — DSH Web GUI as composed today

Research input for the ADE macro redesign. Date: 2026-11-04. Scope: what a user sees and does, not code quality.

**Evidence base.** READMEs and client entries of the shell plugins (frame-layout, workspace-nav, thread-sidebar,
sidebar-right, main-tabs, workbench, home, settings-shell, user-questions, agent-questions, turn-summary),
`plugins/@dshfiles/workbench/docs/slot-inventory.md`, `docs/native-forks.md`, `profiles/web/package.json` (154 `@dshfiles/*` rows), and
32 plugin screenshots read image by image (listed in §6). No scratch DSH was booted: the screenshot set already covers
desktop 1440/1280 and 360 px phone widths, and the live instance was not touched. Paths below are repository-relative;
screenshots are `plugins/@dshfiles/<plugin>/docs/screenshots/<file>`, abbreviated `<plugin>/<file>`.

> Caveat that is itself a finding: the screenshot corpus was captured against **two different shells**. Older captures
> show the stock DSH sidebar ("New Session", "Workspaces" tree, flat page list); newer ones show the owned
> thread-sidebar ("New thread", "All projects", view tabs, icon rail). Several plugins' only screenshot shows the shell
> the user no longer has. Docs and reality have drifted apart.

---

## 1. Shell map

```
┌──────────────── left column (frame-layout `sidebar`) ───────────┬──── centre (`shell.main` → Workbench) ────┬─ right (`shell.dock`) ─┐
│ fixed: logo · Back/Forward/history · ⌘ palette · sliders        │ Dockview tab strip  [New thread ×] [+] ⋯  │ tab strip  [+] ⋯  ×    │
│ icon rail OR "Navigation" panel (plugin pages)                  │ ┌ conversation.session.header ──────────┐ │ "Choose a view" /      │
│ "Threads" panel: New thread · Search threads                    │ │ title · mode · [project ▾] pin ⋯ ▯     │ │ Review · turn N /      │
│   project picker · view tabs (All/Working/…) · Group/Filter     │ │ Chat | Trajectory | Traces | Requests  │ │ preview.txt / Terminal │
│   sections (Pinned/Active/Parked/Inactive…) · rows              │ ├ transcript (chat fork) ────────────────┤ │ Settings hub …         │
│ footer.above: account quota cards (CC1 10% ↻2d23h) · + · ⚙      │ │ turn rows · turn-summary · tool cards  │ │                        │
│ footer: "Usage" link · "More ⋯"                                 │ ├ composer (rich-composer fork) ─────────┤ │                        │
│                                                                 │ │ chips · input · perm · Drafts · model  │ │                        │
│                                                                 │ │ footer: turns·steps·tok/s·≈$·context % │ │                        │
│                                                                 │ └────────────────────────────────────────┘ │                        │
│                                                                 │ optional bottom pane (`shell.bottom`)     │                        │
└─────────────────────────────────────────────────────────────────┴────────────────────────────────────────────┴────────────────────────┘
overlays (`shell.overlay`): command palette · project/folder picker · dialogs · toasts · question cards take over the composer
```

| Region | Owner (path) | What occupies it today | Evidence |
|---|---|---|---|
| Frame / geometry | `plugins/@dshfiles/frame-layout` (fork of `ui-layout`) | 3 columns; left 264–420 px, right ≥300 px ≤70 %; widths and collapse persisted per browser; <1024 px auto-collapse | frame-layout/panel-seats.png, README |
| Left fixed chrome | `plugins/@dshfiles/thread-sidebar` (`sidebar.*` slots, replaces stock sidebar) | logo, Back/Forward + history ▾, ⌘ palette button, sliders; collapsed = 56 px icon rail with ~10 unlabeled icons + "⋯" | thread-sidebar/collapsed-sidebar-navigation.png, thread-classification.png |
| Left flexible middle | `shell.left` → Workbench panels **Thread Sidebar: Navigation** and **Thread Sidebar: Threads** | Navigation = list of plugin pages; Threads = New thread, Search, project picker, view tabs, Group/Filter, sectioned rows. Each panel has its own Dockview tab strip (+, ⌄1, ⋯, ×) inside the sidebar | thread-sidebar/navigation-layout.png, workbench/dockable-panel-layouts.png |
| Left footer | thread-sidebar `sidebar.footer.above` / `footer.action`; ai-accounts cards | account quota card(s), "+", sliders, "Usage" link, "More ⋯" | ai-accounts/sidebar-account-settings.png, turn-summary/turn-summary-line.png |
| Centre | `plugins/@dshfiles/workbench` (Dockview) + `main-tabs` (tab semantics) | Tabs of: fixed-session conversations, plugin pages (Jujutsu, Backlog, Usage…), Settings hub, "New tab" chooser. Split, float, move to any pane | workbench/*.png, main-tabs/workbench-semantics-provider.png |
| Conversation header | `rich-composer` (`conversation.session.header*`) + sidebar-right | title, mode ("Standard mode"), project/workspace select, pin, ⋯, right-pane toggle; sub-tabs Chat / Trajectory / Traces / Requests (traces + usage plugins add the last two) | workbench/conversation-header.png |
| Transcript | `plugins/@dshfiles/chat` (fork of `ui-chat`), turn-summary, tool-meta, html-render, test-runs | user bubbles right, assistant flat; "Completed in 3s ⌄" collapsible work; "Ran 1 command"; per-message actions (copy, 👍👎, share, "Usage 0 tok", time) | chat/windowed-transcript.png, turn-summary/turn-summary-line.png |
| Composer | `plugins/@dshfiles/rich-composer` (fork of `ui-conversation`) + model-selection, agent-preset, model-effort-picker, prompt-stash, mentions, input-trigger, queue-reorder, send-after-upload | above input (new thread): Local ▾ · project ▾ · branch · ☐ workspace · Standard mode ▾ · "Uncommitted · no changes · Base @-"; bar: + · Workspace Write ▾ · Drafts · Prompts · model ▾ Default · send; footer: "1 turns 2 steps · 0 tok/s · ≈$0.00 · 0%" | home/home-screen.png, turn-summary/turn-summary-line.png |
| New-thread hero | `plugins/@dshfiles/home` + `workspace-nav` | headline + "Preview" badge, composer, "Resume <thread> <thread> · 1 thread has work to rebase →" | home/home-screen.png |
| Right pane | Workbench `shell.dock` hosting `sidebar-right` fork resources | per-turn Review diff, file preview, terminal, "Choose a view" chooser, Settings | sidebar-right/addressable-resources.png |
| Bottom pane | Workbench `shell.bottom` | any view (e.g. Threads moved there) | workbench/every-pane-views.png |
| Overlays | command-palette, project-folder-picker / workspace-folder-picker, dialogs, user-questions, toasts | ⌘ palette with Everything/Threads/Files/Backlog tabs and prefixes; ⌘-style project picker listing absolute paths; modal confirm; question card replacing the composer | command-palette/palette-search.png, jj-integration/new-thread-project-picker.png, dialogs/app-dialogs.png, user-questions/answered-question-stays-closed.png |

**Page inventory reachable from the left "Navigation" list** (one capture, chat/windowed-transcript.png, shows 19
entries in a single flat list): Plugins, AI Accounts, Usage history, MCP servers, Secret Catalog, Jujutsu, Quota
forecast, Workbench, Activity, Backlog, Communication, Memory, Usage analytics, Agent toolkit, Jobs, Thread
integration, RAM, Automation tasks, `pulls.review`. The "New tab" chooser (workbench/dockable-panel-layouts.png) offers
another flat list: Settings, Navigation, AI Accounts, Automation tasks, Backlog, Editor, Hosts, Jujutsu, Plugins, Quota
forecast, Sidebar actions, Sidebar status, Thread board, Thread integration, … There is no grouping by job-to-be-done.

---

## 2. Primary journeys (today)

Click counts are counted from the screenshots and READMEs on the owned stack; "surfaces" = distinct panels/pages/
overlays the user must understand.

| # | Journey | Path today | Clicks | Surfaces | Friction |
|---|---|---|---|---|---|
| 1 | **Start a thread in a project** | Sidebar **New thread** (or project-header +, Home hero, Mod+T/Mod+Alt+T Start tab, palette, Backlog "start thread from item", Hosts "create thread") → hero composer → pick project (chip opens a full-screen picker listing absolute paths, incl. "No folder ~/.dsh/no-folder") → optional ☐ workspace (isolate jj thread workspace), Local/host, mode, permission, model, preset → type → Send | 2 (defaults) to 6 | 2–3 (sidebar, hero, picker) | **≥7 entry points**, **7 configuration chips** before typing, two of them dense jargon ("workspace" checkbox, "Base @-"). Home captured a warning toast "The destination composer is busy or already has content; your draft stays in the current workspace" plus a "Switching destination…" spinner on a plain new-thread flow (home/home-screen.png). Tab says "New thread", row says "New chat" (thread-sidebar/navigation-layout.png). |
| 2 | **Run several in parallel** | Repeat #1 per thread (tick ☐ workspace to isolate) → each opens its own centre tab → to watch side by side, drag tabs or Pane options › split; to monitor, Threads **Working (n)** tab or **Thread board** page | n×(2–6) + split | 3–4 (sidebar, tab strip, Dockview groups, Thread board) | No "fleet" view combining live status + output; board columns are status buckets, not live progress (thread-sidebar/thread-classification.png). Thread board duplicates the sidebar's own filters and project picker in the page header. |
| 3 | **Answer an agent question** | Notice row label **Answer** + orange dot in sidebar → click thread → question card replaces composer at bottom → pick 1/2 or type → **Submit** | 3 | 2 | Works well inside one thread. But there is no cross-thread questions inbox: the only global way is the sidebar **Input needed** filter. Child→parent questions (`agent-questions`) have **no UI at all**; they route to the parent agent, and a human only sees them if the parent re-asks. |
| 4 | **Review & land changes** | Turn card "Edited 2 files" → right-pane **Review · turn N** diff; or **pulls.review** page (main..@ scopes, per-file Reviewed); or **Jujutsu: Source Control** (Commit / Describe @); or **JJ Integration: Thread integration** (Needs attention / Ready / Blocked, **Integrate** / Integrate all); or Home "1 thread has work to rebase →"; then **Settle** the thread in the sidebar | 4–8 | 4–5 | Four review/land surfaces with **four verbs for one outcome**: Rebase (home, AGENTS docs), Integrate (Thread integration), Commit (Jujutsu), Land (docs), plus Settle (sidebar). Review is not connected to land: pulls.review has no Integrate button; Thread integration has no diff. (pulls-review/thread-review-scopes.png, jj-integration/thread-workspaces-panel.png, jujutsu/source-control.png) |
| 5 | **See what's running / what needs me** | Sidebar row dots + inline labels ("Turn finished" green, "Answer"), **Working (n)** tab, unread counts per view tab, Thread board, **Activity** page ("0 attention"), **Jobs** page ("0 running"), Thread integration **Needs attention 1**, Backlog **Inbox** + attention flags, AI Accounts quota continuations, Traces alert banners that also "mark threads unread", toasts | 1–3 per signal | **≥8** | See §3.5: no single "needs me" surface; each plugin invented its own attention vocabulary and counter. |
| 6 | **Find a past thread** | Sidebar **Search threads** → in-list search; or ⌘ palette › **Threads** tab (shows absolute path per hit); or Thread board; or saved views (Inactive/Interrupted/Archived); or Memory › **Threads** tab | 2–3 | 2–4 | Three search UIs with different result rows (sidebar row vs palette row with initials avatar + path vs memory digest). Grouping defaults differ between captures (Group: Date vs Group: Status). |
| 7a | **Connect an AI account** | Navigation **AI Accounts** page → **Add account** (blue) → provider → modal "Connect Claude" (Claude account / API key segmented, More options, Import from Secret Catalog) → Verify; *or* sidebar footer "+" next to quota cards; *or* Settings › AI Accounts (listed twice in the Settings nav: core section and Plugins list) | 4–5 | 3 | Three entrances to one task; modal on phone is a near-full-height sheet over the rail (ai-accounts/quick-account-setup-mobile.png). |
| 7b | **Add an MCP server** | Navigation **MCP servers** page ("Global MCP servers") → inline form → Add server | 3–4 | 1 | It is **not** in Settings, though permission, models, agent presets are. Page uses a centred max-width column unlike every other page (mcp-servers/server-configuration.png). |
| 7c | **Store a secret** | Navigation **Secret Catalog** page → choose host + project folder (picker lists JJ thread workspaces as projects) → Add secret; or inline "reference setup" inside other forms | 3–5 | 2 | Project picker offers thread workspaces (`sample · thread-513a37`, "JJ workspace"), contradicting the kit rule "project pickers over thread workspaces" (secret-catalog/scoped-alias-catalog.png). |
| 8 | **Check cost / usage** | Sidebar quota card ("CC1 10% ↻ 2d 23h"), composer footer "≈$0.00 · 0%", per-message "Usage 0 tok", conversation **Requests** tab, sidebar footer **Usage** link, **AI Accounts: Usage history**, **AI Accounts: Quota forecast**, AI Accounts dashboard › **Usage** tab, **Usage: Analytics** page, Usage request log, Traces span cost | 1–3 each | **≥7** | Two full dashboards with different charts and KPIs for the same data (ai-accounts/reference-dashboard-usage.png vs usage/usage-charts.png), plus two more nav entries (Usage history, Quota forecast). |

---

## 3. Frankenstein seams

### 3.1 Visual

| Seam | Evidence |
|---|---|
| **Five page-header patterns.** (a) bare H1 + grey description + pill counters + Refresh (Activity, Jobs, Traces); (b) 44 px icon tile + H1 + badge + underline tabs (Memory, Hosts, Thread integration); (c) H1 + count pill + full-bleed band (Secret Catalog); (d) compact inline label + segmented nav + toolbar in one 48 px row (Backlog, Thread board, pulls.review with lower-case `pulls.review` title); (e) centred max-width column, larger H1 (MCP servers); Agents has no page header, only an "AGENTS" caps list label. | activity-timeline/activity-feed.png, background-jobs/jobs-board.png, memory/memory-panel.png, multi-host/host-management.png, secret-catalog/scoped-alias-catalog.png, backlog/board-card-detail.png, pulls-review/thread-review-scopes.png, mcp-servers/server-configuration.png, agents/agent-registry.png |
| **Primary button colour** differs per plugin: black (MCP Add server, Memory Add memory, Backlog New, Hosts Add host, Integrate), blue (AI Accounts Add account), grey disabled-looking (Jujutsu Commit). Toggles: black (MCP, Agents) vs blue (AI Accounts). | the same screenshots |
| **Tab styles**: blue underline (conversation Chat/Trajectory), black underline with icons (Memory, AI Accounts Models/Settings/Usage), grey pill segmented (Traces, Backlog, Activity filters as outline buttons, Jobs Running/Finished/All), Dockview strip tabs (centre), sidebar view tabs (All threads / Working). | workbench/conversation-header.png, traces/trace-explorer.png, memory/memory-panel.png |
| **Form label casing**: ALL-CAPS labels (Agents: NAME, HANDLE, GLYPH; Backlog: RELATIONSHIPS, ACTIVITY; Jujutsu: CHANGES) vs sentence case (Settings, MCP, AI Accounts). | agents/agent-registry.png, jujutsu/source-control.png |
| **Empty states**: centred grey sentence inside a bordered box (MCP), plain left-aligned sentence (Jobs "No background job matches this view."), centred sentence + CTA button (Jujutsu "Choose a repository…"), dashed-border placeholder panel (Memory detail), "Nothing here" per kanban column (Backlog), "No threads in this section." (sidebar). | listed screenshots |
| **List vs card**: Hosts and Thread integration use bordered row-cards with inline action clusters; Secret Catalog and AI-Accounts dashboard use tables; Activity uses a bulleted timeline inside a card; Backlog uses kanban cards; sidebar uses dense two-line rows. | multi-host/host-management.png, jj-integration/thread-workspaces-panel.png |
| **Toasts**: dark top-centre banner (home) vs white bottom-right card with green left border (dialogs). | home/home-screen.png, dialogs/app-dialogs.png |
| **Doubled headline**: Home renders "sample Into the Unknown" + native "Preview" badge although `home` README says it hides the native headline and badge by CSS-module class suffix — the hack has visibly failed in its own capture. | home/home-screen.png, `plugins/@dshfiles/home/README.md` (Limits) |
| **Raw identifiers leak into UI**: absolute temp paths in palette, picker and Jujutsu header; `thread-4aa3a9` in the composer chip and Activity feed; `dshx_fake_commandcode/gpt-6-luna` as model label; `[hidden]` dark chip over the host name in a thread row. | command-palette/palette-search.png, jujutsu/source-control.png, home/home-screen.png, thread-sidebar/navigation-layout.png |
| **Icon rail is unlabeled**: collapsed sidebar shows ~10 glyphs (plugins, accounts, chart, kanban, server, branch, …) with no labels; their order differs between captures. | thread-sidebar/collapsed-sidebar-navigation.png, activity-timeline/activity-feed.png, background-jobs/jobs-board.png |

### 3.2 Interaction

- **Same thing, different container.** Settings opens as a centre tab, a right-pane tab, a dialog with expand, or a
  native side panel (`settings-shell/README.md`). Account connection is a modal; MCP connection is an inline page form;
  secret creation is a table row action; agent creation is a split list/form page. Thread board is a page; the same
  data is the sidebar.
- **Docking chrome everywhere.** Every left-sidebar block is itself a Dockview group with its own tab strip, "+", "⌄1",
  "⋯", "×" (thread-sidebar/navigation-layout.png). Users can close or move the thread list itself; Workbench needed a
  "layout recovery" feature (workbench/layout-recovery.png) because this goes wrong.
- **Two navigation lists that overlap**: the left **Navigation** panel and the **New tab › Choose a view** chooser list
  mostly the same pages with different names and order (§3.3), plus the ⌘ palette and the collapsed rail. Four ways to
  open "Jujutsu".
- **Selection models differ**: Thread integration and Backlog use row checkboxes + batch verbs; pulls.review uses
  checkbox + "Shift-click extends, Cmd/Ctrl-click toggles" hint; sidebar rows use keyboard nav; Hosts use drag
  handles + up/down chevrons for reorder.
- **Project scoping is re-implemented per page**: sidebar "All projects ▾", Thread board "All projects ▾", Memory "All
  projects ▾", Backlog "All projects", Secret Catalog "Choose a project folder…", Jujutsu "repository" picker, pulls
  "project-workspace picker". None follows the current conversation's project.
- **Refresh buttons** on Activity, Jobs, Traces, Secret Catalog, Thread integration, MCP ("Refresh status"): users are
  asked to poll manually on pages that otherwise feel live.

### 3.3 Naming

| Concept | Words used in UI | Evidence |
|---|---|---|
| Conversation | **thread** (New thread, Threads), **session** (New Session in stock sidebar, "Every background job across Sessions", Jobs "Session ▾" filter), **chat** (row "New chat", tab "Chat"), **conversation** (Current conversation, tab "Conversation") | thread-sidebar/navigation-layout.png, background-jobs/jobs-board.png, sidebar-right/addressable-resources.png; 231 "conversation" vs 18 "New thread" UI string hits |
| Folder you work in | **project** (All projects, Project), **workspace** (Workspaces tree, "Workspace views", ☐ workspace chip, "Workspace Write", "JJ workspace", "default-workspace"), **repository** (Jujutsu), **folder** ("No folder", "Choose a project folder"), **worktree** (git-worktrees) | home/home-screen.png, secret-catalog/scoped-alias-catalog.png, jj-integration/new-thread-project-picker.png |
| Page | view, panel, page, tab, surface; names prefixed **Plugin: View** in some lists ("AI Accounts: Usage history", "JJ Integration: Thread integrati…", "Multi-host: Hosts", "Thread Sidebar: Navigati…") and not in others ("Usage history", "Hosts") — and the prefix truncates the label in a 280 px sidebar | thread-sidebar/navigation-layout.png, jj-integration/new-thread-project-picker.png, `plugins/@dshfiles/workbench/README.md` ("View names") |
| Finishing work | Rebase, Integrate, Land, Commit, Settle, Archive, Park | §2 #4 |
| Cost | Usage, Usage history, Usage analytics, Quota forecast, Requests, Cost, tok | §2 #8 |
| Plugin names in Settings | Title Case ("Thread Sidebar", "Rich composer", "Jj integration") mixed with package ids ("agent-loop", "bash-sandbox", "session-log-deepseek", "tool-subagent/model-…", "web"); "AI Accounts" appears twice | settings-shell/settings-workbench-panels.png |
| Mode/permission | "Standard mode" (agent mode) next to "Workspace Write" (sandbox permission): two adjacent dropdowns whose difference is unexplained | home/home-screen.png |

### 3.4 Duplicated navigation

Entry points per destination (owned stack): New thread ≥7; Settings 4 (gear, Mod+,, palette, New-tab chooser) ×4
presentations; Jujutsu 4; usage/cost ≥7; thread search 3; project picker 7 separate implementations. The sidebar has a
fixed top row (history, palette, sliders) **and** a Threads-panel gear (Customize sidebar) **and** a sliders control
(Thread list settings) **and** a footer sliders icon — four settings-like icons within 280 px
(thread-sidebar/README.md "Tabbed left pane"; navigation-layout.png).

### 3.5 Competing attention signals

Each plugin has its own "needs you" model; there is no shared inbox or priority:

| Signal | Where | Vocabulary |
|---|---|---|
| Row dot + inline label | thread-sidebar rows | Approval needed, Input needed ("Answer"), Turn finished (green), Needs resume, Interrupted, Usage limit; plus Unread |
| View-tab counts | thread-sidebar view tabs | Working (n) = running; other tabs = unread count; coloured dot = attention-label match "not itself an unread count" (`thread-sidebar/README.md` L259–283) |
| Activity page | activity-timeline | "n attention", "Attention only" filter |
| Thread integration | jj-integration | "Needs attention", Blocked, Conflicts |
| Backlog | backlog | Inbox, attention = needs-input / blocked / waiting |
| Accounts | ai-accounts | quota-blocked continuations, red % on quota cards |
| Traces | traces alerts | in-app banner + browser notification + "mark threads unread" |
| Jobs | background-jobs | running / finished counters |
| Toasts | dialogs, home | transient warnings |
| Home | home | "1 thread has work to rebase →" |

Thirty-three thread-sidebar source files, 37 backlog, 20 jj-integration, 17 ai-accounts, 15 activity-timeline files
reference attention/unread state (grep of `*/src`). A user cannot answer "what needs me right now, across everything"
from one place.

### 3.6 Mobile (iPhone Chrome/WebKit, 360–390 px)

- **The left rail never leaves.** At 360 px a 56 px icon rail stays docked (≈16 % of the width) with three stacked "⋯"
  and a dashed "+" (workbench/responsive-main-360.png, conversation-header-narrow.png). There is no phone navigation
  pattern (bottom bar, drawer).
- **Desktop tab strip squeezed**: "New tab ×", "Workbench seco…", "+ ⌄1" truncate; the conversation sub-tabs
  Chat/Trajectory/Traces/Requests overflow off-screen (conversation-header-narrow.png).
- **Page headers don't reflow**: Jujutsu at 360 px overlaps "Choose repository…" with Fetch/Push and truncates the
  description mid-word (responsive-main-360.png).
- **Error text wraps into a 140 px column** beside a "Resume" button (conversation-header-narrow.png).
- Only `frame-layout/src/native/client/AppFrame.module.css` among the shell plugins carries a media query; thread-
  sidebar, workbench, main-tabs and settings-shell have none (grep). Mobile works where the forked native packages
  (chat, rich-composer, user-questions) already handled it, not by shell design.
- Modal sheets (account connect) are reasonable on phone (ai-accounts/quick-account-setup-mobile.png) — the dialog
  layer is the most phone-ready part of the shell.

---

## 4. What works and must be preserved

1. **Instant New thread** (workspace-nav local blank drafts, no Host round-trip; multiple unsent drafts per project).
   Keep the zero-latency composer and per-draft identity.
2. **Conversation-as-tab with retained drafts**: each thread is its own bound tab; switching between projects keeps the
   scene (main-tabs "Window scope"). Split view of two independent conversations works (workbench/conversation-header-split.png).
3. **The composer** is rich and discoverable: chips for destination, permission, Drafts, Prompts, model with Default
   tag, footer with turns/steps/tok/s/cost/context %. Prompt recall, large-paste-as-file, @mentions of files and
   sessions (rich-composer screenshots).
4. **Transcript ergonomics**: collapsed "Completed in 3s" work groups, turn-summary line ("Ran 6 commands · edited 3
   files · 1 failed ›"), per-turn "Edited 2 files" card that opens a real diff in the right pane, windowed rendering.
5. **Inline question card** replacing the composer with numbered options, free-text, Skip/Submit, and the sidebar
   "Answer" label — the clearest attention loop in the product.
6. **Command palette** with scoped tabs (Everything/Threads/Files/Backlog), prefixes (`<`, `thread:`, `>`), ⌘1–9 hotkeys
   and a keyboard legend — the de-facto global navigator; extend it rather than replace it.
7. **Thread lifecycle model**: Pinned / Active / Parked / Inactive / Settled / Archived, saved views, Working count,
   auto-settle after landing. The model is right; its presentation is overloaded.
8. **Thread integration page**: status filter strip with counts, "n workspace(s) can be integrated" banner, per-row
   target bookmark + Integrate, batch Integrate all. Best "ready-to-land" UX in the app.
9. **Per-file review with progress** (pulls.review: scopes, Reviewed toggles, progress bar, Summarize).
10. **Docking power for power users**: any view in any pane, float, named layouts, layout recovery — keep it as an
    advanced mode, not the default shell.
11. **Consistent observability family**: Activity, Jobs and Traces already share header+counters+filters+detail-pane
    structure; it is the closest thing to a house style.
12. **Credentials as references** (`secret:ALIAS`, Import from Secret Catalog inside account setup) and every user
    action having an agent tool — invisible but foundational.
13. **Geometry persistence** (frame-layout): widths and collapse survive reloads.

---

## 5. Implications for the redesign (input, not a plan)

- One **attention model** (one inbox, one vocabulary, one badge) that thread-sidebar, jj-integration, backlog,
  ai-accounts, traces and activity publish into.
- One **"finish work" flow**: review → integrate → settle on one surface per thread, one verb in the UI.
- One **cost surface** with drill-down; quota card and composer footer link into it.
- A **page template** in plugin-ui (header, tabs, empty state, primary button, project scope bound to current
  conversation) that every plugin page uses.
- A **glossary** enforced in copy: thread (not session/chat/conversation), project (not workspace/folder/repository),
  isolated workspace only for the jj concept.
- Navigation grouped by job (Work, Review, Agents, Knowledge, Observe, Configure), with Settings absorbing
  MCP/Secrets/Accounts/Hosts configuration.
- A **phone layout** designed on purpose: drawer navigation, single pane, bottom composer, no Dockview chrome.

---

## 6. Screenshots examined

thread-sidebar: navigation-layout, thread-classification, collapsed-sidebar-navigation · workbench:
conversation-header, dockable-panel-layouts, responsive-main-360, conversation-header-narrow · home: home-screen ·
settings-shell: settings-workbench-panels · ai-accounts: sidebar-account-settings, quick-account-setup-mobile,
reference-dashboard-usage · usage: usage-charts · jj-integration: thread-workspaces-panel, new-thread-project-picker ·
chat: windowed-transcript · user-questions: answered-question-stays-closed · pulls-review: thread-review-scopes ·
jujutsu: source-control · command-palette: palette-search · activity-timeline: activity-feed · background-jobs:
jobs-board · backlog: board-card-detail · traces: trace-explorer · mcp-servers: server-configuration · secret-catalog:
scoped-alias-catalog · memory: memory-panel · turn-summary: turn-summary-line · agents: agent-registry · dialogs:
app-dialogs · multi-host: host-management · sidebar-right: addressable-resources (32 total).

Unverified: live composition of the user's actual profile (which nav entries and footer cards are enabled), real
iPhone WebKit rendering (captures are 360 px Chromium-class), and dark mode — none were measured here.

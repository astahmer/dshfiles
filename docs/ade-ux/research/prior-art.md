# Prior art: one coherent shell for many capabilities and many concurrent work items

Research input for the ADE UX plan. Scope: proven **non-agent** software that solved
(a) "~80 plugins, one coherent shell" and (b) "supervise many concurrent work items
and answer the few that need a human". No DSH code was changed for this document.

**Sources.** Pages fetched this session (2026-11-04) are marked **[F]**. Pages
cited from established knowledge but not re-fetched (web search was unavailable;
some vendor pages render client-side) are marked **[K]**. Verify [K] claims before
quoting them as hard rules. All fetched content was treated as untrusted data.

- [F] VS Code UX guidelines overview — https://code.visualstudio.com/api/ux-guidelines/overview
- [F] VS Code Activity Bar — https://code.visualstudio.com/api/ux-guidelines/activity-bar
- [F] VS Code Views — https://code.visualstudio.com/api/ux-guidelines/views
- [F] VS Code Status Bar — https://code.visualstudio.com/api/ux-guidelines/status-bar
- [F] VS Code Notifications (incl. decision tree) — https://code.visualstudio.com/api/ux-guidelines/notifications
- [F] Linear Inbox — https://linear.app/docs/inbox
- [F] Linear Triage — https://linear.app/docs/triage
- [F] GitHub, About notifications — https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications
- [F] NN/g, Progressive Disclosure — https://www.nngroup.com/articles/progressive-disclosure/
- [F] NN/g, Indicators, Validations, and Notifications — https://www.nngroup.com/articles/indicators-validations-notifications/
- [K] VS Code contribution points and `when` clauses — https://code.visualstudio.com/api/references/contribution-points, https://code.visualstudio.com/api/references/when-clause-contexts
- [K] VS Code Command Palette, Quick Picks and Settings guidelines — https://code.visualstudio.com/api/ux-guidelines/command-palette, https://code.visualstudio.com/api/ux-guidelines/quick-picks, https://code.visualstudio.com/api/ux-guidelines/settings
- [K] JetBrains tool windows — https://jetbrains.design/intellij/components/tool_window/
- [K] Linear Method — https://linear.app/method
- [K] Raycast API, User Interface (List, Detail, Form, ActionPanel) — https://developers.raycast.com/api-reference/user-interface
- [K] Apple HIG: Split views, Sidebars, Layout (size classes) — https://developer.apple.com/design/human-interface-guidelines/split-views, …/sidebars, …/layout
- [K] Material 3 / Android canonical layouts (list-detail, supporting pane, feed) and window size classes — https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts (the fetch returned only the page shell)
- [K] NN/g 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/
- [K] Figma plugin UI and "Figma plugin guidelines" — https://www.figma.com/plugin-docs/
- [K] Buildkite pipelines and builds UI; Superhuman "Split Inbox" and keyboard model; Slack "Activity" and sidebar sections; Arc Spaces — vendor help pages, not re-fetched.

---

## 1. Patterns for "many capabilities, one coherent shell"

### 1.1 VS Code: a fixed workbench with contribution points (the canonical plugin shell)

**What it is.** The workbench has a small, fixed set of **containers**: Activity Bar,
Primary Sidebar, Secondary Sidebar, Editor (groups), Panel and Status Bar. Inside them
it has a fixed set of **items**: View, View toolbar, Sidebar toolbar, Editor toolbar,
Panel toolbar and Status Bar item. Common UI is shared: Command Palette, Quick Pick,
Notifications, Webviews, Context menus, Walkthroughs and Settings [F overview].
Extensions do not draw chrome. They *declare* contributions (`viewsContainers`,
`views`, `commands`, `menus`, `configuration`, `statusBarItems`, `keybindings`), and
`when` clauses gate visibility [K contribution points].

**Why it works.**
- Each plugin can only land in a few slots, so the shell stays recognisable at any
  extension count. Users learn the shell once; every extension then "looks native".
- Each slot carries a **scope rule**. Status Bar left is workspace-wide and right is
  the active file [F status bar]. Panel toolbar actions follow the selected view.
  Editor actions are scoped to the active editor [F overview]. Scope is part of the
  contract, not left to each plugin.
- Views can be moved between containers. Each view needs an icon "in case it is moved
  to the Activity Bar or Secondary Sidebar" [F views]. So **placement is the user's
  choice, and the plugin cannot depend on it**.
- Declarative contributions allow lazy activation and keep a plugin's presence
  independent of its runtime.

**Failure modes (named in the guidelines).**
- **Too many views and Activity Bar icons.** The guidelines repeat "keep the number of
  Views to a minimum", "limit the number of items" and "don't duplicate an existing
  icon" [F views, F status bar, F activity bar]. In practice the Activity Bar bloats
  with one icon per extension, and VS Code had to add overflow, hiding and drag-to-Panel.
- **Webviews bypass the design system.** VS Code asks extensions to "limit the use of
  custom Webview Views" and to use Tree Views for data [F views].
- **Tree items used as buttons** ("don't use tree items as single action items") and
  more than three actions per item [F views].
- **Notification spam.** VS Code needed an explicit decision tree. Its defaults are:
  show one notification at a time; add "Do not show again" to every notification;
  never use them for promotion; keep progress in context [F notifications].

**ADE mapping.**
- The ADE's competing sidebars come from plugins that each own chrome. Adopt the
  VS Code split instead: the **shell owns containers, plugins own content**.
  "Backlog", "Memory", "Traces", "Usage", "Jobs" become *views* the user can place.
  They are not separate sidebars.
- Every DSH plugin feature maps to exactly one existing item type:
  - a thread list or job list → View (list/tree)
  - "Land", "Rebase" or "Open diff" → View or Editor toolbar action
  - account quota or the multi-host connection → Status item
  - a slash action → Command
  - a model picker → Quick Pick
- Add a lint or Host check, like the existing workspace contract, that rejects a plugin
  creating its own top-level container.

### 1.2 JetBrains tool windows: stripes, modes and a stable "main editor" [K]

**What it is.** Tool windows (Project, Git, Run, Problems, Services) attach to edge
"stripes" left, right or bottom. Each window has a view mode (docked, undocked,
floating, window) and a numbered shortcut (Alt+1, …). The **Services** tool window
unifies many running things: run configs, Docker, DBs and app servers. They form one
tree with a detail pane.

**Why it works.** The centre editor never moves, and tools orbit it. The Services
window shows that **heterogeneous concurrent processes fit one list-detail surface**
when each is a node with a common status grammar (running, stopped, failed). That
beats a separate window per process type.

**Failure modes.** Stripes fill with icons from plugins. New users drown in the chrome.
JetBrains' "New UI" (2022–23) hid most stripes by default and moved to a compact main
toolbar and a single widget, an explicit retreat to progressive disclosure.

**ADE mapping.**
- The thread transcript is the "editor" and must never be displaced.
- "Background jobs", "project checks", "multi-host runtimes" and "agents" are one
  **Services-like supervisor view**: rows of *work items* with one status grammar. They
  are not four boards.
- Numbered view shortcuts give fast desktop access.

### 1.3 Command palette and launchers (VS Code, Linear Cmd-K, Raycast/Alfred)

**What it is.** One global, fuzzy-searchable entry point lists every command, entity
and setting. Raycast extends it: extensions return **only a few primitives** (List,
Grid, Detail, Form, ActionPanel). Every list item carries a typed action panel whose
first action is the default (↵) and whose second is ⌘↵ [K Raycast]. Linear's Cmd-K is
contextual: it offers actions on the focused issue first [K Linear Method].

**Why it works.**
- It gives **recognition rather than recall** and **flexibility and efficiency of use**
  for experts (Nielsen heuristics 6 and 7) [K].
- It decouples *capability* from *placement*. A plugin can have zero visible chrome
  and still be fully reachable, which is the escape valve that keeps slots scarce.
- Raycast shows that a launcher with ~1,000+ third-party extensions stays coherent
  *because* extensions can only compose a handful of primitives and cannot style them.

**Failure modes.**
- Discoverability is poor for novices: the palette is invisible until learned.
- Naming collisions and duplicates appear ("Open Settings" ×6), and command lists
  become unranked dumps.
- If the palette is the *only* path, mobile users (no ⌘K) lose access.

**ADE mapping.**
- Every agent tool already has a capability (AGENTS.md: "A capability the user has, the
  Agent gets"). Make the converse a rule: **every user capability is a Command** with an
  id, a category (= owning domain, not plugin package), a `when` context and an optional
  keybinding.
- The palette also searches *entities*: threads (`find_threads`), backlog `b:<id>`,
  `jj:` revisions, agents `@{handle}`, settings and secrets aliases. Linear and Raycast
  mix entities and commands this way.
- Adopt Raycast's primitive set for plugin-rendered content: List, Detail, Form and
  Actions. Prefer them over arbitrary webviews.

### 1.4 Centralised settings with a schema (VS Code Settings, macOS System Settings) [K]

**What it is.** Each extension declares a JSON-schema `configuration`. The shell renders
one searchable Settings editor with categories, scopes (user, workspace, folder), "modified"
indicators and a JSON escape hatch. VS Code's settings guideline asks extensions to use
the native Settings editor rather than a custom webview.

**Why it works.** There is one place to look and one search box. Scope (user, workspace,
folder) is a property of the setting, not of the screen. Defaults are visible and can
be reset.

**Failure modes.**
- Too many settings get exposed because "make it configurable" replaces design.
- Category trees mirror *plugin packages* instead of user tasks.
- Plugins ship their own "Settings" button and duplicate the editor.

**ADE mapping.**
- MCP servers, secrets, AI accounts, network access, memory and fallback chains go into
  **one Settings surface** grouped by *user task*: Models & Accounts, Tools & MCP,
  Secrets, Workspace & VCS, Hosts, Notifications, Appearance, Advanced. The grouping is
  not per plugin.
- Plugins contribute schema sections (`defineSettings` already exists). The shell
  renders them.
- Deep config such as an MCP server editor is a **Form in the settings detail pane**.
  It is not a separate sidebar.
- Settings carry scope: global, project, or thread. That matches DSH's
  global/project/local secret scopes and per-thread model selection.

### 1.5 Progressive disclosure (NN/g) [F]

**What it is.** Show the few important options first and reveal specialised ones on
request. Two levels are good. Three or more "typically have low usability because
users often get lost". When you must have more, chunk them into groups that make
sense, and use usage data to decide the split [F progressive disclosure].

**Why it works.** It improves learnability, efficiency and error rate together.
Novices aren't misled into a "limited mental model" [F].

**Failure modes.**
- The wrong split hides a frequent action.
- A weak "information scent" on the More/Advanced control.
- Multiple competing paths to the same secondary screen.

**ADE mapping.**
- The default shell shows threads, the current thread, attention and the composer.
- Traces, usage, memory curation, MCP, hosts and policies are second level, reached by
  palette or the "More" view switcher.
- DSH already records per-tool usage (`usage_activity_report`). **Use real frequency
  data to pick the first-level set**, as NN/g recommends.
- Never three levels.

### 1.6 Spaces and contexts (Arc Spaces, Slack workspaces, Linear teams) [K]

**What it is.** A top-level switcher scopes the entire sidebar to one context. Examples
are an Arc Space with its own pinned tabs and theme, a Slack workspace, or a Linear team.

**Why it works.** It cuts list length by an order of magnitude, and switching context is
one deliberate act.

**Failure modes.** Cross-context items become invisible: "I missed the urgent thing in
the other space". Arc and Slack both had to add cross-space unread indicators.

**ADE mapping.** A **project** (DSH Workspace or repo) is the natural space. Scope the
thread list, backlog and jj views to it. But **attention is global**: the inbox and the
attention badge always count across all projects and hosts. This mirrors Slack's
cross-workspace badge.

### 1.7 Figma plugins and Notion blocks: constrained surfaces [K]

- **Figma** runs a plugin in a sandbox with its own iframe UI, a modal-ish floating
  window of plugin-chosen size. Figma's guidance pushes toward its design tokens. Lesson
  (a failure mode): **free-floating plugin windows** feel foreign and stack badly. Figma
  later added "widgets" and right-panel integration (Dev Mode plugins live in the
  inspect panel) to pull plugins into fixed regions.
- **Notion** makes everything a block with a uniform menu (drag handle, "turn into",
  comment, link). Lesson: **uniform per-item affordances** (one ⋯ menu, one drag
  handle, one "copy link") make heterogeneous content feel like one product.

**ADE mapping.**
- No floating plugin windows. Plugin UI goes into a view, a detail pane or a dialog
  from the shell kit.
- Every row type (thread, job, backlog item, revision, agent, question) gets the
  **same row anatomy**:
  - status glyph
  - title
  - secondary line
  - right-aligned meta (time, cost)
  - hover or long-press actions
  - ⋯ menu that includes "Copy reference" (`b:`, `jj:`, session link)

---

## 2. Patterns for "supervise many concurrent work items"

### 2.1 One inbox with triage verbs (Linear Inbox and Triage, GitHub Notifications, Superhuman)

**What it is.**
- **Linear Inbox:** one notification center with a **Priority** tab separating
  "notifications that need your attention" from other updates. It has J/K navigation,
  `U` read/unread, `H` snooze, Backspace delete and a reason-based filter. Snoozed items
  return at the chosen time [F inbox].
- **Linear Triage:** a separate *team* queue for intake. Each item takes exactly one of
  a few verbs: accept (1), decline (2), duplicate (3) or snooze (H). Snooze returns
  early "when there's new activity". Triage responsibility assigns an owner and rotation
  [F triage].
- **GitHub:** each notification carries a **reason** label (`mention`,
  `review requested`, …). Triage verbs are **Done**, read/unread, **Save** and
  **Unsubscribe**. Filters (`reason:review-requested`, `is:saved`) and bulk triage are
  available. Unsaved items expire after 3 months [F github].
- **Superhuman [K]:** split inbox (VIP, team, calendar, news) and "Done = archive"
  (`E`). Inbox zero is a visible goal. Every action has a key, and reminders bring items
  back.

**Why it works.**
- Attention becomes a **queue with a finite set of verbs**, so it can be emptied. Badges
  alone cannot be "finished".
- The **reason** label explains *why* the item is here, which builds trust.
- **Snooze/remind** lets you defer without losing the item.
- **Priority split** separates "needs me" from "FYI", and that split is the single most
  important attention decision.

**Failure modes.**
- When everything is subscribed, the inbox becomes an activity log and users declare
  bankruptcy (the GitHub notification-fatigue meme).
- "Read" gets conflated with "handled".
- One inbox per tool: Slack, GitHub, Linear and email each run their own, and users
  give up. This is exactly the ADE's current problem across plugins.

**ADE mapping.**
- **One Attention Inbox for the whole ADE.** Agent questions (`ask_user_question`, child
  questions), failed or blocked integrations, landing-ready threads, quota-blocked
  continuations, failing project checks, firing trace alerts, backlog `needs-input`
  items and finished turns all post here.
- Each item carries `reason`, `source` (thread, agent, host, plugin), `severity`, the
  required verb(s) and a deep link.
- The **Priority / Needs you** tab holds only items that block an agent or need a
  decision. The other tab is FYI.
- Verbs:
  - **Answer** (inline form for questions)
  - **Approve / Land**
  - **Open**
  - **Done** (dismiss, not read)
  - **Snooze** (time, or "until it changes")
  - **Mute source**
- Several pieces already exist and should become *providers* to the inbox rather than
  each having a UI: DSH `thread_attention_state`, `list_thread_questions`,
  `activity_timeline_attention`, `ai_accounts_continuations`, `traces_alerts` and the
  backlog `attention` field.

### 2.2 Channels, threads, unread vs mention (Slack and Discord) [K]

**What it is.** The sidebar lists channels. **Bold = unread** activity (passive) and a
**red numeric badge = mention or DM** (directed at you). These are two distinct signal
strengths. Slack added "Activity" (mentions and reactions across channels), "Threads"
(only replies you're in), custom sidebar sections, per-channel mute and "Unreads only".

**Why it works.** It encodes a two-level attention model visually: *something changed*
versus *someone needs you*. Mute lets the user tune noise per source.

**Failure modes.**
- Hundreds of bold channels lead to anxiety.
- Badge counts accumulate past usefulness (99+).
- The separate Activity and Threads views duplicate the inbox concept.
- Slack's 2023 redesign (Home, DMs, Activity tabs) was partly driven by mobile.

**ADE mapping.** An agent thread is a channel. In the thread list:
- **Bold title** = the agent finished a turn you haven't seen (FYI).
- **Badge/dot with severity colour** = the agent is waiting on you (question, approval,
  failure).
- **Running spinner** = in progress.

Never use numeric badges on threads, because one question per thread is enough to show.
Use a count only on the global inbox entry.

### 2.3 Ops dashboards, CI boards and air-traffic control (Buildkite, Grafana, ATC) [K]

**What it is.** The screen shows dense rows of concurrent jobs and builds with a
**strict status-colour grammar**: passed (green), failed (red), running (amber or
animated), blocked or waiting (purple, or a "manual unblock" step in Buildkite),
canceled and scheduled (grey). Buildkite's **block step** pauses a pipeline until a
human clicks Unblock, sometimes filling a small form: a *human-in-the-loop gate*
inside a running job. ATC and ops consoles follow **"dark cockpit" / management by
exception**: everything normal stays quiet and grey, and only deviations gain colour,
motion or sound. Alarm levels are few and fixed (advisory, caution, warning), with
acknowledgement required for the top level.

**Why it works.**
- Humans can supervise dozens of concurrent agents only if normal is visually silent.
- A fixed, small severity scale is learnable. "Waiting for human" is its own status,
  distinct from failed and from running.

**Failure modes.**
- Alarm fatigue: too many cautions and everything flashing get ignored.
- Colour as the only channel fails for accessibility and on small screens.
- Dashboards with no drill-down path to act.

**ADE mapping.** Define a **single work-item status grammar** used by threads, subagents,
background jobs, project checks, integrations and remote runtimes:

| Status | Meaning | Visual |
| --- | --- | --- |
| `idle` | nothing happening | no glyph or neutral |
| `running` | working | subtle animated glyph, no colour |
| `waiting-human` | blocked on the user (question, approval, unblock) | accent colour + inbox item (Buildkite "blocked") |
| `waiting-external` | quota reset, rate limit, remote host | muted clock glyph |
| `done-unseen` | finished, not yet looked at | bold title |
| `failed` | error with a recovery action | danger colour + inbox item |
| `done` | finished, seen | nothing |

The Supervisor view sorts by "needs you" first. **Dark-cockpit rule:** a healthy fleet
of 20 running agents should look calm.

### 2.4 PR review as the "landing" surface (GitHub pull requests) [K]

**What it is.** A PR is the unit of review. It has a header with status (checks,
mergeability), tabs (Conversation, Commits, Checks, Files changed), "Viewed" checkboxes
per file and a single primary action (Merge) whose availability reflects all gates.

**Why it works.** Every precondition for "ship it" sits on one page, and the primary
action is disabled with the reason shown.

**Failure modes.** Very large diffs, review comments lost on force-push, and
status-check sprawl.

**ADE mapping.** A thread's workspace is a PR:
- one **Review & Land** detail with tabs: Summary, Changes (`pulls_review` scopes), Checks
  (project-check receipts) and Conversation (the transcript)
- one primary action, **Land** (`jj_thread_rebase`), disabled with reasons such as
  conflicts, undescribed revisions, a running session or a failing check

"Ready to land" posts to the inbox.

---

## 3. Mobile adaptation of multi-pane apps

### 3.1 Size classes, list-detail and supporting pane (Apple HIG, Material 3) [K]

**What it is.**
- **Apple** defines compact and regular **size classes**. A `NavigationSplitView`
  (sidebar → content → detail) collapses into a **navigation stack** in compact width:
  the sidebar becomes the root list and detail is pushed. A tab bar holds the 3–5
  top-level destinations on iPhone, while iPad uses a sidebar.
- **Material 3** defines window size classes: compact < 600dp, medium 600–840,
  expanded ≥ 840, and large/extra-large above. It also defines canonical layouts:
  - **list-detail**: two panes when expanded, a single pane that navigates on compact
  - **supporting pane**: the main pane plus a secondary pane that moves to a bottom
    sheet on compact
  - **feed**

  Navigation moves from a bottom navigation bar (compact) to a navigation rail (medium)
  to a drawer (expanded).

**Why it works.** The information architecture stays the same and only the
*presentation* collapses. The user's mental model survives the device change.

**Failure modes.**
- "Shrunk desktop": three panes squeezed into 390pt, hover-only actions, tiny targets.
- Losing the selected item or the scroll position when rotating or resizing.
- Too many tabs: more than five means a "More" tab graveyard.

### 3.2 ADE mobile rules (iPhone Chrome/WebKit)

1. **Same IA, collapsed presentation.** Sidebar → list → detail becomes a stack. The URL
   encodes the stack (`?thread=…&view=…`) so the back gesture and deep links work.
2. **At most four bottom tabs:** Threads, Inbox (with badge), New (compose), More
   (palette, views, settings). Supervisor and secondary views live under More or are
   reached from the inbox.
3. **The Inbox is the mobile home when anything needs you.** Answering an agent question,
   approving a land or snoozing must work one-handed. Use inline answer forms with large
   targets (≥ 44pt per Apple HIG).
4. **No hover-only affordances.** Every hover action has a long-press or ⋯ equivalent,
   and swipe actions on rows mirror the inbox verbs (swipe right = Done, left = Snooze).
   This is the Mail/Superhuman convention.
5. **Supporting panes become sheets.** Diff, traces and job output open as a bottom sheet
   or full-screen push, never as a side-by-side split under ~840px.
6. **The status bar collapses** into a single attention/health chip in the header.
7. **The command palette** becomes a search field atop the More tab. Keyboard shortcuts
   are desktop-only accelerators, never the only path.
8. **Respect WebKit specifics.** Use safe-area insets and avoid `100vh`; use `dvh`. Make
   sure the composer stays visible when the iOS keyboard opens, and that fixed bars
   survive the visual-viewport resize. Test at iPhone size with Playwright WebKit (memory
   n:2), not desktop Chromium.

---

## 4. Recommended plugin shell contract

Principle: **the shell owns regions, chrome, status grammar, attention and navigation;
plugins contribute declarative items into a fixed set of slots.** A plugin that cannot
fit a slot below is a design smell. Raise it as a shell change; do not add a new slot
ad hoc.

### 4.1 Regions (fixed, owned by the shell)

| # | Region | Desktop | Mobile (compact) | Holds |
| --- | --- | --- | --- | --- |
| R1 | **Navigator rail** | left icon rail, ≤ 7 entries + overflow | bottom tab bar (≤ 4) | view-container switchers: Threads, Inbox, Supervisor, Backlog, More |
| R2 | **List pane** | left pane (resizable) | root of stack | exactly one *View* at a time (list/tree + filter + view actions) |
| R3 | **Main stage** | centre | pushed screen | a thread transcript + composer, or one *Detail* (diff/review, settings page, trace) |
| R4 | **Context pane** | right, optional, collapsible | bottom sheet | *Detail* about the selection in R3 (workspace status, files, memory for this thread, cost) |
| R5 | **Status strip** | bottom bar: left = global, right = current-thread context | one header chip | *Status items* (≤ 1 per plugin, text-first, no custom colours) |
| R6 | **Command palette** | ⌘K overlay | search on the More tab | *Commands* and *entity providers* |
| R7 | **Attention inbox** | rail entry + badge; list in R2, item in R3 | Inbox tab | *Attention items* only, via the attention API |
| R8 | **Settings** | a Detail in R3 reached from palette/More | stack screen | *Settings sections* (schema-rendered) |
| R9 | **Transient feedback** | toast stack, max 1 visible | top banner | *Toasts*, only for confirmation of the user's own action |

### 4.2 Contribution points (what a plugin may declare)

1. **`command`**: id, title, domain category, `when`, optional keybinding, optional
   `agentTool` binding. Required for every user capability.
2. **`view`**: list or tree in R2 using shell row anatomy. It has a title, icon, empty or
   welcome state, view actions (≤ 3 inline + overflow) and a default container. Users
   can move it.
3. **`detail`**: an R3/R4 page built from shell primitives (Detail, Form, Tabs, Diff,
   Table). Custom canvas is allowed only by exception (e.g. trace waterfall), and it
   still uses theme tokens.
4. **`rowDecorator` / `rowAction`**: add a status glyph, meta text or action to *another
   owner's* rows (e.g. jj adds "Land" to thread rows). The owner declares the registry,
   per AGENTS.md "dependencies point one way".
5. **`statusItem`**: R5, at most one per plugin. It is global or contextual and opens a
   command or detail on click.
6. **`settingsSection`**: a schema plus a task category (from a fixed list) and a scope
   (global, project or thread).
7. **`attentionProvider`**: emits attention items (see §5). This is the *only* way to
   get the user's attention.
8. **`entityProvider`**: searchable entities for R6 (threads, `b:` items, `jj:`
   revisions, agents, secrets aliases).
9. **`composerContribution`**: chips, slash commands and attachments in the thread
   composer. The composer is the one place an agent-centric shell must allow it.

### 4.3 Rules

- **No new chrome.** A plugin must not render its own sidebar, top bar, floating
  window, global banner or notification UI. A check rejects it, in the spirit of the
  existing workspace contract.
- **Icon on every view.** Placement is the user's choice [F views].
- **Group by domain, not package.** Commands, settings and views carry one of a fixed
  set of domains: Threads, Agents, Review & Land, Work (backlog), Knowledge (memory),
  Runtime (jobs, hosts, checks), Models & Accounts, Tools & MCP, Observability
  (traces, usage), System. Several plugins can share one domain container; that's how
  80 plugins become about 10 places.
- **One status grammar** (§2.3) for every work item. Plugins map their states onto it
  and may add detail text, but not new colours.
- **Parity:** every command has an agent tool and vice versa, already a repo rule.
  Every view row has a copyable native reference.
- **Progressive disclosure budget:** first-level rail entries are chosen from usage
  data. Everything else goes through More or the palette. No third level.
- **Mobile-complete:** every contribution must declare or inherit compact behaviour.
  Views stack, details push, context panes become sheets, and hover actions have a touch
  equivalent. CI renders each view at 390×844 in WebKit.

---

## 5. Recommended attention model

Combine the GitHub/Linear inbox, the Slack two-strength signal, the VS Code notification
decision tree and dark-cockpit severity.

### 5.1 One inbox, badges as pointers, toasts almost never

- **The inbox is the single source of truth** for "something needs you". Every badge
  anywhere is a *projection* of inbox state, so clearing the item clears every badge.
  No plugin keeps its own unread counter.
- **Indicators** (NN/g: contextual, conditional, passive [F indicators]) are on rows:
  bold for done-unseen, a severity glyph for waiting or failed. They come from item
  state, not from separate notifications.
- **Toasts** are only for acknowledging the user's own action ("Landed `jj:main`",
  "Copied"), with Undo where possible. Never use one for agent events. VS Code's
  decision tree (no notification if not needed; combine multiples; progress in context;
  modal only for immediate user-initiated input) is the guard [F notifications].
- **Modals** are only for a user-initiated destructive confirm. An agent never opens a
  modal; it posts a `needs-you` item.
- **OS or push notifications** (desktop when hidden, iPhone push) are only for
  `blocking` severity, and only if the user opted in per source.

### 5.2 Severity levels (four, fixed)

| Level | Meaning | Where it shows | Example |
| --- | --- | --- | --- |
| **blocking** | an agent or job cannot continue without you | Inbox ▸ Needs you, rail badge count, row accent, optional push | agent question, land approval, Buildkite-style unblock, quota continuation needing a choice |
| **failed** | something broke; has a recovery action | Inbox ▸ Needs you, row danger glyph | integration conflict, failed check, MCP server down, alert firing |
| **ready** | done and awaiting review or decision, not blocking | Inbox ▸ Other (or Needs you if user opts), bold row | turn finished, workspace ready to land |
| **info** | FYI | activity timeline only (not inbox), row indicator at most | job finished cleanly, memory digest written |

Every inbox item has:
- `reason`: why you're seeing it [F github]
- `source`
- `severity`
- `verbs`: subset of Answer, Approve, Land, Retry, Open, Done, Snooze, Mute source
- a stable `dedupeKey` so repeats merge, not stack. VS Code says "combine into one"; the
  DSH comm API already has `dedupeKey`.
- an automatic **resolve**: when the underlying state changes (the question is answered
  elsewhere, the job is retried and passes), the item closes itself.

Snooze supports "until it changes" (Linear triage semantics [F triage]). Per-source mute
and a "Do not show again" equivalent [F notifications] live in Settings ▸ Notifications.

### 5.3 Lists of concurrent agents (the Supervisor view)

- **Sort:** waiting-human, then failed, then running, then done-unseen, then idle/done.
  Group by project (space), with a toggle to group by agent `@{handle}` or by host.
- **Row:** status glyph · title · agent handle · elapsed or last activity · cost (meta,
  muted) · inline primary verb when waiting (Answer / Land / Retry).
- **Dark cockpit:** running rows have no colour. Only exceptions are coloured.
- **Subagents** nest under their parent (one level). Background jobs nest under the
  owning thread (Services-style tree).
- **Detail** opens in R3 without leaving the list (list-detail). On mobile it pushes.

---

## 6. Summary table: pattern → ADE decision

| Pattern (source) | ADE decision |
| --- | --- |
| Fixed containers + contribution points (VS Code) | Shell owns 9 regions; plugins declare 9 kinds of contribution |
| Views movable; icon required (VS Code) | Placement is the user's; plugins can't assume a sidebar |
| Services tool window (JetBrains) | One Supervisor view for threads, subagents, jobs, checks, hosts |
| Cmd-K + few UI primitives (VS Code, Linear, Raycast) | Every capability is a command; plugin UI = List/Detail/Form/Actions |
| Schema settings editor (VS Code) | One Settings, grouped by task, scoped global/project/thread |
| Progressive disclosure, 2 levels (NN/g) | Usage-data-chosen first level; More + palette; no third level |
| Spaces with cross-space unread (Arc, Slack) | Project scopes lists; attention is global |
| Inbox + reasons + triage verbs + snooze (GitHub, Linear, Superhuman) | One Attention Inbox with Needs you / Other; verbs; auto-resolve |
| Bold vs mention badge (Slack) | Bold = done-unseen; accent glyph = waiting on you; count only on inbox |
| Block step, status grammar, dark cockpit (Buildkite, ATC) | 7-state work-item grammar; calm when normal; `waiting-human` is first-class |
| PR page with one gated primary action (GitHub) | Review & Land detail; Land disabled with reasons |
| Notification decision tree (VS Code) | Toasts only for own actions; no agent modals; push only for blocking |
| Size classes, split view → stack, list-detail (Apple, Material) | Same IA; stack on compact; ≤ 4 tabs; panes → sheets; touch parity |

## 7. Open questions for the plan

- Which existing DSH surfaces map to which region? Audit `dshx inspect slots` against §4.1.
- Does DSH's native slot system allow enforcing "no new chrome", or is it a lint-only rule?
- Attention API ownership: which plugin owns the inbox registry (`defineRegistry`), and
  how do native sources (thread attention, questions) feed it without core patches?
- First-level rail set: pull 30 days of `usage_activity_report` and choose by data.

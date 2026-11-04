# Competitor UX research A: T3 Code, OpenAI Codex, Claude Code

**Snapshot:** 2026-11-04. This file covers information architecture and UX: how
each product presents its features as one coherent experience. For capability
comparisons, see
[harness-landscape](../../../docs/research/harness-landscape/README.md)
([t3-code](../../../docs/research/harness-landscape/t3-code.md),
[codex](../../../docs/research/harness-landscape/codex.md),
[claude-code](../../../docs/research/harness-landscape/claude-code.md)). This
file does not repeat that material.

**Evidence labels**

- **verified**: read in first-party source code, docs or release notes on 2026-11-04.
- **best-effort**: inferred from first-party material, without direct observation of the running UI.
- **unknown**: not established.

I ran none of the three apps. Web search was not available in this session (no
Brave key), so I read first-party sources only: the T3 Code repository at
commit `8b44f42` (2026-11-04, release `v0.1.7` plus nightly `v0.1.8`), the Codex
docs at `learn.chatgpt.com` (linked from the
[Codex docs index](https://developers.openai.com/codex/llms.txt)), the Claude
Code docs at
[code.claude.com/docs](https://code.claude.com/docs/llms.txt), and GitHub issues
ranked by reactions. All fetched content was treated as untrusted data.

> **Headline shift since the 2026-10-28 snapshot (verified):** the Codex
> desktop app now lives inside the **ChatGPT desktop app**. A product selector
> switches between **ChatGPT** (Chat/Work) and **Codex**, and Codex is the
> developer view of the same agent
> ([use-chatgpt](https://learn.chatgpt.com/docs/use-chatgpt.md),
> [app](https://learn.chatgpt.com/docs/app.md)). Claude Code likewise lives in
> the **Code tab** of the Claude desktop app, next to Chat and Cowork
> ([desktop](https://code.claude.com/docs/en/desktop.md)). Both vendors make
> the coding agent one *mode* of a general agent app. T3 Code is the only one
> of the three that is purely a coding ADE.

---

## 1. T3 Code (pingdotgg/t3code)

Sources: the repository at `8b44f42`: `apps/web/src/routes/*`,
`components/Sidebar.tsx`, `components/sidebar/SidebarChrome.tsx`,
`components/settings/settingsSearch.ts`, `rightPanelStore.ts`, and the
`docs/user/*.md` pages linked below. Release notes come from the
[GitHub releases](https://github.com/pingdotgg/t3code/releases).

### Primary metaphor
**A chat inbox with a triage sidebar, plus an IDE-style right panel** (verified).
The thread list behaves like an email inbox. Threads are **Pinned**, **Active**,
**Working**, **Snoozed** or **Settled** (archived) and move between these sections by
drag ([thread-sidebar.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/thread-sidebar.md)).
Snooze, settle and undo come straight from email clients.

### Top-level IA
- **Routes** (verified, `apps/web/src/routes`): chat (`/_chat.$env.$thread`,
  `/draft`, `/new`), `/pull-requests`, `/usage`, `/settings/*` (26 page routes),
  plus connect/pair/guest/welcome flows.
- **Left sidebar** (verified): a project picker/filter, then thread search, then
  the sections Pinned / Active / Working (collapsed) / Snoozed / Settled. The footer has
  only **three utility entries: Settings, Pull requests, Usage**
  (`SidebarChrome.tsx`), plus update and provider-status pills. On a utility
  page, the footer turns into a **Back** button.
- **Main**: the conversation and composer. The composer carries the model,
  permission mode, branch, worktree mode and environment selectors in a
  toolbar (`BranchToolbar*`).
- **Right panel**: a tabbed "surface" host (verified, `rightPanelStore.ts`)
  with these kinds: `diff`, `files`, `file`, `preview` (browser), `device` (iOS/Android
  simulators), `terminal` (splittable), `pull-request`, `pull-requests`, and
  `side-chat`. Tabs have close / close others / close to the right. An empty
  panel shows "Open a surface".
- **Count:** 3 primary areas (Threads, Pull requests, Usage) plus Settings.
  Everything else is a right-panel surface or a settings page.
- **Settings** (verified, `SETTINGS_NAV_GROUPS`): an ungrouped head (General,
  Appearance, Chat, Diffs, Keybindings, Snap-shot), then **Agents** (Providers,
  Threads, Browser, Devices, Scheduled tasks), **Code** (Projects, Source
  control, Worktrees), **Connections** (Connections, Sharing & access,
  Secrets), and an ungrouped tail (Maintenance, Labs, About, Archive).
  Settings has **its own search**, which also indexes every keybinding.
  Settings is **scoped**: one control applies to one environment, "All
  environments", or a project override, and shows **Mixed** when values
  differ (`settingsScope*.ts`, `SettingInheritance.tsx`).

### Thread / task model, parallelism, worktrees
- A thread lives in a project (or **no project**: a scratch folder under
  `~/.t3/scratch`, with **Turn into project** later) on an *environment*
  (a machine) (verified).
- Workspace mode is chosen per thread: current checkout or **New worktree**.
  **New thread in this worktree** reuses one.
- **Background start** (verified): `Cmd+Enter` submits and immediately opens
  the next draft. **Shift-click several models** in the picker to fan out one
  prompt into N threads, each with its own worktree.
- **Working section (beta, on by default)** (verified): threads that are busy,
  or waiting on subagents, PR watches or background commands, fold into a collapsed
  section. A thread returns to the top of Active "when it finishes,
  fails, or needs an approval or answer". The active list is then ordered by
  "when each thread last came back to you". This is an attention-ordered list.
- **Subagents** (verified): an **Agents** view follows delegated work.
  Subagent threads take no messages; their approvals surface in the parent
  ("Child approvals", v0.1.7).
- **Side chats** (verified): `/side` or `/btw` opens a tab in the right panel
  that does not pollute the thread. **Bring back** merges what you learned.
- **Auto-settle** (verified): idle threads settle after 3 days, or when their PR
  merges. Settling can run a cleanup script (`runOnSettle`, e.g. `cargo
  clean`) to reclaim disk.

### Diffs, review, landing
- The **Diff** surface shows *turn-scoped* changes by default: files brought in by
  pull, merge or rebase are excluded. A source picker switches to a branch comparison or
  **Commits** (verified, [source-control.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/source-control.md)).
- Thread **Git actions**: commit, push, create PR, with generated messages.
  Writing style and model are set in Settings → Source control.
- A **first-class Pull requests page** covers 7 forges: list, summary,
  code, timeline, reviewers, labels, stacks, auto-merge, revert, shift-drag to
  close many. **Review guides** (beta) are an agent-written "tour" of a PR with
  ordered stops and **Look closely** flags. Selecting lines lets you "ask an agent
  about this stop". **Mark as viewed** syncs with GitHub (verified).
- The server links each thread to its PR automatically, by branch (verified).

### Approvals, permission modes, agent questions
- There are 4 modes: **Supervised / Auto-accept edits / Auto / Full access**. Each
  is chosen in the composer and applies per thread (`mod+shift+a`). The default is
  **Full access**, and project overrides are possible. Managed policy caps the modes
  ([permission-modes.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/permission-modes.md)).
  The doc includes a provider-differences table that says honestly where each
  provider degrades a mode.
- Approvals are answered **inline in the conversation**. With Claude, typing a
  text reply *declines with feedback*.
- Question answers accept file attachments, kept per question
  ([question-attachments.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/question-attachments.md)).
- Pending input is modeled in `pendingUserInput.ts` and drives the
  sidebar ordering (best-effort).

### Attention / notifications
- The sidebar itself is the attention system: the Working fold, "needs you" dots on
  collapsed project folders, and a snooze that wakes early "when it needs an
  approval or answer, when a run fails, or when you send it a message" (verified).
- Desktop/web: `ThreadNotificationCoordinator`, `BackgroundThreadAnnouncer`
  (best-effort: OS notifications plus an announcement for background threads).
- Mobile: push through T3 Connect for finish, fail, needs approval or needs input,
  plus **iOS Live Activities / Android Live Updates** that show running work
  ([mobile-notifications.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/mobile-notifications.md)).
- **Usage-limit stops are a thread state** ("Limited") with **Resume**,
  **Resume at reset** and **Snooze until reset** (verified).

### Settings and extensibility
- Skills come in through `$` and `/` in the composer, from the selected provider.
  **Restart agent session** (in the palette) picks up new skills, plugins and MCP
  servers. T3 Code does not host its own plugin system; it surfaces the
  providers' systems (verified).
- **Outside agents**: T3 exposes an **MCP URL** so that external agents (Claude
  Code, Codex, ChatGPT) can drive T3 threads
  ([outside-agents.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md)).
- ACP Registry agents are installed through a wizard (`AcpRegistrySearchStep.tsx`).

### Usage / cost / limits
- A **dedicated Usage page** (`mod+u`) aggregates history across 8 providers and all
  environments: tokens, cache savings, model breakdown, an API-equivalent cost
  ("not your subscription bill"), and a **Premium** line for Fast/Ultrafast. You
  can set custom model prices per environment, with **Mixed** shown where they differ. Totals
  arrive per environment as each one answers, and values still loading are dimmed
  ([usage.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/usage.md)).
- The context meter is **off by default** (Labs → legacy). This caused issue
  [#9352](https://github.com/pingdotgg/t3code/issues/9352) "hidden by default
  without an in-app notice" (verified).

### Remote / mobile / multi-device
- Remote access is the core of the product: web, Electron and native iOS/Android all talk to
  *environments* (machines) through LAN, Tailscale, the T3 Connect relay or SSH
  (already covered in the harness-landscape file).
- UX details (verified): the environment is a visible chip in the composer. Settings
  apply per environment or to all of them. Pairing uses a QR code. Mobile has offline-readable PR
  reviews and an offline message queue. Guest links share a thread.

### Command palette / keyboard
- `Cmd/Ctrl+K` palette: thread search across environments by title, branch,
  PR or project, ranked by frecency, with **In messages** full-text hits that open at the
  matching message. It also holds actions ("Triage an issue", "Restart agent session",
  "New thread in…") (verified).
- **F6 / Shift+F6 cycles focus between workspace areas** (sidebar, conversation,
  composer, panels). The thread list supports arrow keys, `F2` rename and `Shift+F10` context menu
  ([keyboard-focus.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/keyboard-focus.md)).
- Keybindings live in a JSON file with `when` conditions, and the settings UI can be searched by
  keystroke. `mod+z` undoes the last sidebar action, even from the composer.

### Empty states / onboarding
- A **Welcome wizard**: connect computers → check agents (opens a terminal with
  the install or login command ready) → **import projects** found from Claude Code,
  Codex and Pi history. Active git repos are preselected (≥3 conversations in 30
  days) ([welcome-wizard.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/welcome-wizard.md)).
  You can rerun it at `/welcome`.
- Dedicated empty states: `NoProjectsHero`, `NoActiveThreadState`,
  `HostedEmptyState`, `PullRequestListEmptyState` (verified file names).
- **"Triage an issue"** in the palette opens a thread in which your own agent
  debugs T3 Code itself, using the server's logs and source
  ([triage.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/triage.md)).

### Distinctive ideas worth stealing
1. **Inbox triage verbs for threads**: pin / snooze (with presets and "until
   reset") / settle / undo toast. Auto-settle on PR merge.
2. **Working fold plus "came back to you" ordering**: the list shows *your* queue,
   not the agents' activity.
3. **A right panel as a typed surface registry** (diff, files, terminal, browser,
   device, PR, side chat), all opened from one tab strip.
4. **Settings search, scope and inheritance**, with *Mixed* values.
5. **Activity-log grouping** with honest counts ("Sent 5 messages to 2
   threads", and "waiting ≠ finished")
   ([activity-log.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/activity-log.md)).
6. **Usage limit as a resumable thread state.**
7. The **Composer banner stack** as the one pattern for every notice in a thread
   ([web-ui.md](https://github.com/pingdotgg/t3code/blob/main/docs/internals/web-ui.md)).

### Known complaints / weaknesses
- **Feature sprawl**: 26 settings routes, a Labs page, and "legacy" toggles. v0.1.7
  had "659 changes from 160 contributors"
  ([release](https://github.com/pingdotgg/t3code/releases/tag/v0.1.7)). The
  sidebar has three alternative modes (default, Working-fold, "Boring sidebar (group by
  project)"), and these disable each other's features (drag is off in two of them) (verified).
- Open sidebar bugs: flicker
  ([#7766](https://github.com/pingdotgg/t3code/issues/7766)), drag offset,
  search cleared when a thread opens, collapsed state not restored, a "Working"
  timer that resets (verified issue titles).
- The context indicator is hidden by default (#9352). Session import cannot be reached
  after onboarding ([#10961](https://github.com/pingdotgg/t3code/issues/10961)).
- The most-reacted open request asks to manage Cursor, Codex and Claude **cloud** sessions
  from inside T3 ([#15644](https://github.com/pingdotgg/t3code/issues/15644)),
  which suggests users want one inbox across every runtime.

---

## 2. OpenAI Codex (ChatGPT desktop app, Codex Cloud, IDE, CLI)

Sources: [app](https://learn.chatgpt.com/docs/app.md),
[use-chatgpt](https://learn.chatgpt.com/docs/use-chatgpt.md),
[projects](https://learn.chatgpt.com/docs/projects.md),
[settings](https://learn.chatgpt.com/docs/reference/settings.md),
[commands](https://learn.chatgpt.com/docs/reference/commands.md),
[worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees.md),
[code-review](https://learn.chatgpt.com/docs/code-review.md),
[notifications](https://learn.chatgpt.com/docs/notifications.md),
[permission-modes](https://learn.chatgpt.com/docs/permission-modes.md),
[mobile](https://learn.chatgpt.com/docs/mobile.md),
[remote-connections](https://learn.chatgpt.com/docs/remote-connections.md),
[cloud](https://learn.chatgpt.com/docs/cloud.md),
[plugins](https://learn.chatgpt.com/docs/plugins.md),
[automations](https://learn.chatgpt.com/docs/automations.md),
[pricing](https://learn.chatgpt.com/docs/pricing.md).

### Primary metaphor
**Chat with projects, where the "Codex" mode adds developer panes** (verified). The
same chat is shown with or without technical detail: "ChatGPT … hide[s]
technical details like Git or shell commands; Codex … see[s] developer details,
including diff and review views"
([use-chatgpt](https://learn.chatgpt.com/docs/use-chatgpt.md)). Codex Cloud
keeps a **task** framing: environment → task → review → PR
([cloud](https://learn.chatgpt.com/docs/cloud.md)).

### Top-level IA
- A **product selector** (ChatGPT ↔ Codex). Inside ChatGPT, a Chat/Work toggle
  sits above the composer. In Codex, the entry point is **New chat**, plus **Quick chat** (verified).
- **Sidebar** (verified/best-effort): projects (pinnable) containing chats (pinnable),
  **Search chats**, the **Activity** bell, **Scheduled**, a **Plugins** tab, and
  plugins pinned to the sidebar. **Code Review** is a plugin "you can pin to the app
  sidebar". So the sidebar is extensible by plugins (verified,
  [code-review](https://learn.chatgpt.com/docs/code-review.md)).
- **Projects view**: ChatGPT projects (Chats + Sources + instructions) and
  *local projects* (folders on disk) appear in one list (verified).
- **Codex-only panels** (verified from shortcuts): bottom panel (`⌘J`),
  terminal (`⌃\``), file tree (`⌘⇧E`), file search (`⌘P`), side chat
  (`⌘⌥S`), the review pane, and the browser with comment mode (`⌘⇧.`).
- **Settings** (verified): General, Profile (usage stats, streaks, profile card),
  Keyboard shortcuts, Notifications, Appearance, Pets, Browser (per-site agent
  permissions), Computer Use, Personalization (AGENTS.md, memories), Suggested
  prompts, Archived chats, Worktrees, Code Review, Connections.
- **Count:** about 4 primary areas (Chats/Projects, Activity, Scheduled, Plugins and
  pinned plugin views) plus Settings.

### Thread / task model, parallelism, worktrees
- A unit is a **chat**, inside a project or standalone. Run location is chosen per chat:
  **Local**, **Worktree**, or **Cloud** (an environment). On a remote host, it uses
  SSH (verified).
- Worktree is chosen under the composer, with a starting branch. The work runs in
  **detached HEAD**. **Hand off** moves the chat *and* its code between Local
  ("foreground") and Worktree ("background"). **Create branch here** turns the work into a branch.
  The app keeps the 15 most recent managed worktrees, snapshots a worktree before deleting it, and
  offers **restore** when you reopen the chat. Pinned and in-progress chats are protected
  from cleanup
  ([worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees.md)).
- Subagents are shown inside chats. Scheduled tasks run on dedicated background
  worktrees (verified).
- **Pop-out chat window with Always on top**, to keep a chat next to your editor
  (verified, settings).

### Diffs, review, landing
- **Review pane** (verified): scope **Unstaged / Staged / Commit / Branch /
  Last turn**, a repository selector for multi-repo projects ("All repos" for the last
  turn), inline line comments (hover **+**), then "send a message back".
  **Stage / unstage / revert** at three levels: whole diff, file, hunk.
  `Cmd+click` opens the line in your editor.
- `/review` presets: base branch / uncommitted / commit / custom instructions.
  Findings come back prioritized and do not touch the working tree.
- The **Code Review plugin** (PRs): a personal inbox (*Assigned to me / my team /
  Authored by me*), Summary/Changes tabs, Mark as viewed, Stack navigation,
  **Review with Codex** in a new chat, and editable review instructions (verified).
- Landing: commit, push and open a PR from the header (best-effort for the merge UI).

### Approvals, permission modes, agent questions
- Two orthogonal controls, explained in plain language: the **sandbox** (what it can
  reach) and **approvals** (when it pauses). The modes are **Ask for approval** and
  **Approve for me** (requests go to an *auto-review* agent). "Changing who
  reviews a request doesn't expand the sandbox"
  ([permission-modes](https://learn.chatgpt.com/docs/permission-modes.md)) (verified).
- The control sits below the composer. Browser permissions are set per site (Browse,
  Download, Upload × Requires approval / Always allow / Block).

### Attention / notifications
- An **Activity view** (bell in the sidebar, `⌘⌥U`) lists chats that are **unread,
  running, or waiting for your response**, with filters (Work, Chat, Pinned,
  Scheduled) and **Mark all as read** (verified).
- Turn-completion alerts can be set to never, background-only or always. Permission and
  question notifications can be switched separately.
- A **floating pet** overlay shows Running / Needs input / Ready / Blocked while you
  work in other apps (verified). This is a whimsical ambient status indicator.

### Settings and extensibility
- One **universal plugin directory** shared by ChatGPT and Codex. Plugins bundle
  skills plus MCP servers, are installed from a **Plugins tab**, and can pin a view to the
  sidebar. In the CLI, `/plugins`. The IDE extension has no plugins (verified).
- Hooks, rules, AGENTS.md and subagents live in config files
  (`config.toml`), and are documented under "Customization".

### Usage / cost / limits
- The usage dashboard is a **web page** (`chatgpt.com/codex/settings/usage`).
  In the CLI, `/status`. **Profile** shows lifetime and peak tokens and streaks (verified).
- The in-app context/token indicator was removed and then requested back:
  [openai/codex#23794](https://github.com/openai/codex/issues/23794) (253
  reactions). Also #11325 (manual `/compact`). Rate-limit opacity is a top
  complaint ([#28879](https://github.com/openai/codex/issues/28879), 557) (verified issue titles).

### Remote / mobile / multi-device
- **ChatGPT mobile → Codex**: pair with a QR code from the desktop app's **Settings → Connections →
  Control this Mac or PC**. From the phone you can start, steer, approve and review diffs on the
  connected computer or in Cloud. One task list covers Cloud and all connected
  hosts (verified, [mobile](https://learn.chatgpt.com/docs/mobile.md)).
- The desktop app can connect to SSH hosts. Another desktop can **Control other devices**.
- "Local computer access with Work Cloud": cloud coordinates the task, and an online
  computer executes the local steps. If the computer is offline, the next turn falls back to a
  cloud container, with an explicit warning about what it cannot reach (verified).

### Command palette / keyboard
- Shortcuts are rebindable, and the shortcut settings can be searched by command name *or by
  pressing the keystroke* (verified). "Search chats" has **no default
  shortcut** (verified). A distinct `Cmd+K` palette is **unknown**.

### Empty states / onboarding
- Four steps: install → sign in → choose where to work (chat / project / folder)
  → send. Suggested prompts are context-aware "to surface follow-ups and tasks
  you may want to resume". Cloud onboarding has the agent inspect the repo, install
  dependencies and test the environment, then **Publish** it (verified).

### Distinctive ideas worth stealing
1. **Local ↔ Worktree Hand off** as one verb, with "foreground/background"
   language.
2. **Snapshot before auto-deleting a worktree, then restore on reopen.**
3. **Review pane scopes** (Unstaged/Staged/Commit/Branch/Last turn) with hunk
   staging.
4. **Activity view** as a single "what needs me" list with mark-all-read.
5. **Plugins that pin views into the sidebar.** This is the extensible-nav model.
6. **One agent with two presentations** (technical detail on or off).

### Known complaints / weaknesses
- The product split is confusing: ChatGPT Work vs Codex "have overlapping capabilities"
  per the docs themselves, and features vary by "plan, platform,
  region, rollout" (verified). This means a lot of conditional UI.
- Removed affordances caused backlash: **branch selection** ([#49532](https://github.com/openai/codex/issues/49532),
  "Put the Branch selection BACK"), the context indicator (#23794), thread
  deletion ([#13018](https://github.com/openai/codex/issues/13018)), and a GPU-heavy
  "thinking" animation ([#16857](https://github.com/openai/codex/issues/16857))
  (verified titles).
- Usage visibility sits off-app (a web dashboard).

---

## 3. Anthropic Claude Code (Desktop Code tab, claude.ai/code, mobile, CLI, IDE)

Sources: [desktop](https://code.claude.com/docs/en/desktop.md),
[desktop-quickstart](https://code.claude.com/docs/en/desktop-quickstart.md),
[agent-view](https://code.claude.com/docs/en/agent-view.md),
[claude-projects](https://code.claude.com/docs/en/claude-projects.md),
[claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web.md),
[mobile](https://code.claude.com/docs/en/mobile.md),
[remote-control](https://code.claude.com/docs/en/remote-control.md),
[mods overview](https://code.claude.com/docs/en/plugins/mods/overview.md),
[costs](https://code.claude.com/docs/en/costs.md),
[interactive-mode](https://code.claude.com/docs/en/interactive-mode.md),
[fullscreen](https://code.claude.com/docs/en/fullscreen.md),
[statusline](https://code.claude.com/docs/en/statusline.md),
[changelog](https://code.claude.com/docs/en/changelog.md).

### Primary metaphor
**It depends on the surface** (verified):
- Desktop Code tab: **an IDE-like workspace of draggable panes around a chat**.
- `claude agents` (CLI): **a dispatch board / table of sessions grouped by state**.
- **Projects** (cloud, beta): **a coordinator conversation plus an Overview kanban** of
  worker threads.

### Top-level IA
- **App level**: tabs at the top of the sidebar: Chat / Cowork / **Code** (verified).
- **Code tab sidebar**: **+ New**, the session list (grouped and sorted through a hover-only
  "Group and sort" icon, with **View all → Archived** tab), **Projects** (or under
  **More** during rollout), and **Customize** (connectors, skills, plugins in one
  place, synced through the claude.ai account) (verified).
- **Session window**: a title bar with pane buttons (Terminal, Changes, Browser,
  Files…). Overflow goes to a **⋮** menu, along with panes that have no button
  (Background tasks, Plan), which appear "once the session has something to show".
  Panes: **chat, diff, browser, terminal, file, plan, tasks, subagent, iOS
  Simulator**. They are draggable, resizable and can pop out into their own window (verified).
- **Session details rail** (verified): cards beside the chat for **Environment**
  (where it runs, Remote Control switch), **Changes** (`+12 −1`, PR plus CI
  status), what it's running, and **Context** (%) with a category breakdown.
- **Row under the prompt**: environment → project folder → Worktree toggle →
  permission mode → model → **usage ring** (plan usage). Settings → Code
  (or "Claude Code") holds worktree location, branch prefix, auto-archive, Remote
  Control default and prompt suggestions.
- **Count:** the Code tab has about 3 areas (Sessions, Projects, Customize) plus Settings.
  Most features are panes or rail cards inside a session.

### Thread / task model, parallelism, worktrees
- A unit is a **session** (each with its own folder and context). Environments are **Local / saved
  local / SSH / WSL / Cloud** (verified).
- Parallel work: `Cmd+N`. **Split view** (Option-click a session) or a **new window**
  (Cmd-click). The unfocused split is dimmed (verified).
- Worktree is a toggle under the prompt, stored in `.claude/worktrees/`, with a branch
  prefix. On archive, a dirty worktree prompts, and other cases auto-clean
  after 30 days (verified).
- **Suggested-task cards**: Claude proposes out-of-scope work with **Start / Do it
  here / Options / Start all**. Started sessions nest under the parent in
  the sidebar (verified).
- **Cross-session messaging**: you ask in plain language ("tell the payments session
  the schema changed"). The message appears as an attributed card with a back-link, and
  archiving another session needs approval (verified).
- **Agent view** (CLI, research preview): every background session is a row.
  States: **Working / Needs input / Idle / Completed / Failed / Stopped**, with shape glyphs
  for process alive, exited or looping. A **Haiku-written one-line summary** per row
  refreshes about every 15 s. A **PR label colored by status** (yellow/green/purple/grey).
  You can peek-and-reply without attaching. The terminal title shows "2 awaiting input" (verified).
- **Projects** (cloud): the Overview pane groups threads into **Ready for review /
  Waiting on you / Working / Landing / Idle**, with a dot on the Overview button when
  something waits on you (verified).

### Diffs, review, landing
- Diff pane: opened from the `+N −M` on the Changes card. Inline comments are queued and
  sent together with `Cmd+Enter`. You can **Compare against** any branch (web) (verified).
- `/code-review` yields a **Code review card** grouped by file: **Walk through in
  diff** steps finding by finding (**Fix this one** / dismiss), and **Apply
  fixes** fixes them all (verified).
- PR monitoring in the Changes card: CI status, **Auto-fix** (CI and review
  comments), **Merge when ready** (GitHub auto-merge), and **auto-archive on
  merge/close** (verified).

### Approvals, permission modes, agent questions
- Modes: **Manual / Accept edits / Plan / Auto (classifier) / Bypass**, chosen in the
  mode selector under the prompt (`Cmd+Shift+M`). In the CLI, `Shift+Tab` cycles
  them. The choice is remembered *per folder*, except Plan. Cloud offers a subset, and mobile
  never offers Bypass (verified).
- The docs note that labels were renamed ("earlier versions … labeled these modes
  Ask permissions, Auto accept edits, Plan mode") (verified).

### Attention / notifications
- An OS notification fires when a session finishes and you are not viewing it. Project-level
  notification settings exist. Mobile push arrives through Remote Control or Dispatch ("notify me when
  tests finish" works as a prompt) (verified).
- Agent view: terminal bell or notification on needs-input, finish or fail.
- Cross-surface: archiving in Desktop also archives the remote copy (verified).

### Settings and extensibility
- **Customize** in the sidebar is one hub for connectors (MCP with a GUI setup),
  skills and plugins. **+ next to the prompt** offers attach, skills, connectors and
  plugins *in context* (verified).
- Layers: CLAUDE.md, settings.json, hooks, skills, subagents, MCP, plugins,
  and new **mods**: JS/TS plugins that **draw panes, a band above the prompt,
  buttons and fields**, restyle built-in UI (tool rows, spinner, question
  dialog), intercept tool calls, and add instant `/commands`. They work in the CLI, Desktop
  and VS Code (verified, [mods](https://code.claude.com/docs/en/plugins/mods/overview.md)).
  This is the closest analogue to DSH's plugin slots.
- Debugging config: `/context`, `/doctor`, `/hooks`, `/mcp` show what actually loaded.

### Usage / cost / limits
- The **usage ring** under the prompt shows plan usage, and the **Context card** on the rail
  shows the percentage plus categories. `/usage` in the CLI shows a session block, a plan-usage
  breakdown *with recommendations*, and `f` to auto-fix them (verified). The
  status line is a user script fed session JSON (cost, context, git).

### Remote / mobile / multi-device
- Four ways in from a phone, all in the Claude app's **Code** tab: **Cloud
  sessions**, **Projects**, **Remote Control** (local execution, transcript synced),
  **Dispatch** (the Cowork agent decides to spawn a Code session). The docs carry an
  explicit table of where the work runs (verified, [mobile](https://code.claude.com/docs/en/mobile.md)).
- **Open in → Cloud** moves a session to the cloud (conversation summarized).
  `--teleport` pulls a cloud session into the terminal. Remote Control can be toggled per session,
  defaulted per computer, or disabled by policy (verified).
- Sharing: per-session visibility Private/Team or Public (verified).

### Command palette / keyboard
- Desktop: `Cmd+/` shows a shortcut sheet. `Cmd+Shift+D/B/M/I/E` open the diff,
  browser, mode, model and effort menus. `Ctrl+Tab` switches sessions. `1–9` selects in open
  menus. `Ctrl+O` cycles transcript view modes **Normal / Thinking / Verbose** (verified).
- A general `Cmd+K` palette in Desktop is **unknown**. The CLI has a `/` menu with fuzzy
  filtering mid-prompt, rebindable keybindings and a `/tui fullscreen` renderer.

### Empty states / onboarding
- Quickstart: install → **Code** tab → choose environment, folder, mode and model in the row
  under the prompt → send. **Suggested next prompt** appears as ghost text (`Tab` to
  accept). A setup failure gets its own fix steps in the docs (verified).

### Distinctive ideas worth stealing
1. **A state-grouped dispatch board with AI one-line row summaries** and PR status
   colors (agent view; Projects Overview).
2. **The session details rail**: a few cards (Environment, Changes, Context, Running),
   each opening its full pane.
3. **Suggested-task cards** that spawn nested sessions (Start / Do it here / Start
   all).
4. **The review→fix loop as UI**: a findings card → walk through in diff → fix one / apply all.
5. **Mods**: plugins can draw panes and *restyle native UI*, through one API across
   surfaces.
6. **Transcript density modes** (Normal/Thinking/Verbose).
7. **A "where does it run?" table** for every remote option.

### Known complaints / weaknesses
- **Layout churn**: the docs maintain "current layout" vs "earlier layout"
  instructions, with version thresholds that differ per provider type (verified,
  "Check which layout you have"). Users cannot tell which UI they have.
- **Fragmented parallelism**: subagents, agent view, agent teams, dynamic
  workflows, Projects and Dispatch are six overlapping ways to run in parallel, with a
  [comparison page](https://code.claude.com/docs/en/agents.md). Cross-session
  Claude "doesn't see cloud sessions, or sessions you started from the terminal
  CLI or the VS Code extension" (verified).
- Grouping and sorting hide behind a hover-only icon. Side chats are not saved to disk
  (verified).
- Top issues: **multi-account switching** in Desktop
  ([#18435](https://github.com/anthropics/claude-code/issues/18435), 1288) and
  mobile (#36151), usage limits drained fast (#16157, #38335), and terminal scroll
  jumps ([#826](https://github.com/anthropics/claude-code/issues/826)) (verified titles).

---

## 4. Cross-product synthesis

### Convergent patterns (table stakes)
| Pattern | T3 | Codex | Claude |
|---|---|---|---|
| Left sidebar = conversations grouped by project, pin + archive | ✓ | ✓ | ✓ |
| **Run-location chooser in the composer row** (local/worktree/cloud/SSH) | ✓ env + worktree | ✓ Local/Worktree/Cloud | ✓ environment selector + Worktree toggle |
| Permission mode + model selectors **under the prompt**, changeable mid-thread | ✓ | ✓ | ✓ |
| Per-thread worktree with `.worktreeinclude`-style copy and auto-cleanup | ✓ | ✓ | ✓ |
| Side chat (`/btw`) that doesn't pollute the thread | ✓ | ✓ | ✓ |
| Diff pane with inline line comments sent back to the agent | ✓ | ✓ | ✓ |
| PR linked to the thread, with CI status; archive/settle on merge | ✓ | partial | ✓ |
| Approvals answered inline in the transcript; subagent approvals bubble to the parent | ✓ | ✓ | ✓ |
| A single "needs you" surface | Working fold + dots | Activity view | agent view / Overview |
| Phone = remote control of the same sessions (pair by QR), push on needs-input/finish | ✓ | ✓ | ✓ |
| Integrated terminal, browser preview, file viewer as panes | ✓ | ✓ | ✓ |
| Rebindable shortcuts with searchable shortcut settings | ✓ | ✓ | ✓ |
| Collapsed tool-call groups with expandable detail | ✓ | ✓ | ✓ |

### Divergent bets
- **Where the "needs me" queue lives**: T3 puts it *in the sidebar order*
  (attention-sorted list). Codex uses a *separate Activity view*. Claude uses a *separate
  board* (agent view) or a *coordinator conversation* (Projects).
- **Coding as a mode of a general agent app** (Codex in ChatGPT, Claude Code tab) vs
  **a pure ADE** (T3). The vendors gain a shared plugin/connector catalog. T3 gains
  depth (PR page, usage page, 26 settings routes).
- **Extensibility surface**: T3 has none of its own (it relays providers' systems
  and exposes an MCP URL). Codex plugins can *pin views to the sidebar*. Claude mods
  can *draw panes and restyle native UI*.
- **Usage**: T3 has a full in-app cost page across providers. Claude shows a ring
  plus `/usage` with fix-it recommendations. Codex sends you to a web dashboard.
- **Pane model**: T3 uses a tabbed right panel. Claude uses free drag-and-drop panes and
  pop-outs. Codex uses VS Code-style toggles (bottom panel, file tree).
- **Autonomy framing**: T3 has 4 named modes, defaulting to Full access. Codex has sandbox ×
  reviewer (two orthogonal axes). Claude has 5 modes, including Plan and a classifier
  "Auto".

### 10 concrete lessons for our ADE
1. **Make the thread list the attention system.** Use explicit states (Needs
   you / Working / Ready for review / Idle / Settled) and sort by *"came back to
   you"*, not recency. All three converge on these state names. Copy Claude's
   *Ready for review / Waiting on you / Working / Landing / Idle*. Our backlog,
   agent questions and jobs should feed this one queue instead of separate
   panels.
2. **Keep top-level nav to 3–4 destinations.** For example Threads, Review/PRs,
   Usage, and Settings in the footer. Everything else (jj graph, jobs, traces,
   memory, MCP, hosts) becomes a *surface* inside a thread or a settings page.
   T3 keeps ~140 top-level component entries behind 3 sidebar entries.
3. **One typed right-panel surface registry** (T3) or rail of cards (Claude):
   diff, files, terminal, browser, jobs, jj, traces, side chat, each with a
   compact card in a session rail and a full pane on click. Our ~80 plugins
   should register *surfaces and cards*, not top-level pages. This is the
   anti-Frankenstein rule.
4. **Put run location, workspace, mode, model and account in one row under the
   composer.** That is where all three put the "where/how" decisions. DSH's
   multi-account routing and multi-host runtimes belong in that row (an
   environment chip plus an account chip), not in distant settings.
5. **Treat quota as a thread state, not an error.** Copy T3's Limited → *Resume
   / Resume at reset / Snooze until reset*. DSH already has quota continuations
   and should surface them as a state and verb in the list. Show plan usage as an
   always-visible ring (Claude) and a full Usage page (T3). Never hide the
   context meter: both T3 and Codex were punished for it (#9352, #23794).
6. **Triage verbs with undo**: pin, snooze (presets and "until reset"), settle,
   auto-settle on land. Every one gets a 5-second undo and `mod+z`. Pair settle
   with jj workspace cleanup (T3 `runOnSettle`, Codex snapshot-then-delete with
   restore).
7. **Close the review→land loop in one place**: a diff scope picker (turn /
   working copy / revision / vs `main`), inline comments batched to the agent, a
   findings card with "walk through / fix one / apply all", then a landing card
   (rebase onto main, CI, merge when ready). Our jj integration should present
   *Land* as the verb, the way Codex presents *Hand off*.
8. **Give plugins a constrained presentation contract**: surfaces, rail cards,
   composer chips, palette commands and settings sections, as Claude mods and Codex
   pinned plugins do. Never give plugins free top-level real estate. Then require
   **settings search with scope and inheritance** (*Mixed*, per-project and per-host
   overrides) so that 80 plugins' settings stay findable.
9. **One palette for every verb and search**: threads (frecency, plus full-text
   "In messages"), actions, settings, and keybindings searchable by keystroke.
   Add F6 area cycling. Every plugin capability should show up there. This
   matches our "a capability the user has, the agent gets" rule.
10. **Design for one UI that ships and keeps shipping.** Avoid Claude's
    "earlier layout vs current layout" split and T3's three mutually exclusive
    sidebar modes. Ship at most one Labs toggle at a time, and never remove an
    affordance users rely on (branch picker, context meter, delete) without a
    replacement. Also add the phone basics early: a pair-by-QR flow, push on
    needs-you, and a mobile layout that offers the same verbs (our user runs DSH
    on iPhone Chrome).

### Open questions / unknown
- Whether the Codex desktop app or Claude Desktop has a general `Cmd+K`
  command palette (unknown).
- The exact Codex sidebar composition in the Codex mode of the ChatGPT app
  (best-effort, from scattered docs). Screenshots were not inspected.
- T3's runtime look and density. Only source and docs were read, and the app
  was not run.

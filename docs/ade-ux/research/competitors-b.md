# Competitor UX research (B): how ADEs present agent features as one experience

**Snapshot:** 2026-11-04. Focus: information architecture (IA) and UX, not capabilities.
Capability notes already exist in
[cursor.md](../../../docs/research/harness-landscape/cursor.md),
[windsurf.md](../../../docs/research/harness-landscape/windsurf.md) and
[cline.md](../../../docs/research/harness-landscape/cline.md); this file does not repeat them.

**Method and confidence.** Web search was unavailable in this session (no search key), so every
claim comes from first-party pages fetched directly (docs, changelogs, blog posts, product pages)
plus one first-party forum search (Cursor). Labels:

- **verified**: stated on the cited first-party page fetched on 2026-11-04.
- **best-effort**: inferred from marketing copy, screenshots or partial pages.
- **unknown**: not found in fetched sources; do not rely on it.

Fetched content was treated as untrusted data.

---

## 1. Cursor (Cursor 3.x, "Agents Window")

Sources: [Agents Window docs](https://cursor.com/docs/agent/agents-window.md),
[Cursor 3 blog (2026-04-02)](https://cursor.com/blog/cursor-3),
[Projects](https://cursor.com/docs/agent/projects.md),
[Agent Review](https://cursor.com/docs/agent/agent-review.md),
[Worktrees](https://cursor.com/docs/configuration/worktrees.md),
[Cloud Agents](https://cursor.com/docs/cloud-agent.md),
[Bugbot](https://cursor.com/docs/bugbot.md),
[Agent overview](https://cursor.com/docs/agent/overview),
[changelog](https://cursor.com/changelog),
[forum search](https://forum.cursor.com/search.json?q=agents%20window%20order%3Alatest).

- **Primary metaphor (verified):** "a unified workspace for building software with agents".
  The Agents Window was "built from scratch, centered around agents"; the classic IDE remains
  as a second window. Users toggle with `Open Agents Window` / `Open IDE` in the palette.
- **Top-level IA (verified):** left sidebar lists **all local and cloud agents**, including
  ones started from mobile, web, Slack, GitHub and Linear. The sidebar also has a
  **Projects** section: a Project is a long-lived *coordinator agent* that plans and
  delegates to child agents, keeps shared context files, and can hold **subscriptions**
  (Slack channel, schedule, PR activity) shown as a "Listening" pill above the input.
  Multi-workspace by design. Files are reachable via Cmd+P / Cmd+Shift+F without leaving.
- **Session list and switching (verified/forum):** sidebar has Customize Sidebar → Ordering
  (e.g. "Updated"); per-chat icon and colour ("Edit Icon") to tell parallel agents apart.
  Chats can be dragged onto a Project row.
- **Parallelism (verified):** UI-native worktrees exist only in the Agents Window
  (`.cursor/worktrees.json` setup scripts; machine-wide cap, default 25, auto-cleanup).
  Cloud agents run in VMs; one-click **local ↔ cloud handoff** of a live session;
  `/in-cloud` hands a subtask to a cloud subagent; `/best-of-n` fans one prompt over models
  in separate worktrees.
- **Review/diff (verified):** "new diffs view" to review, stage, commit and manage PRs in
  the Agents Window. **Agent Review** runs a local review (Quick/Deep) automatically after
  commits, via `/agent-review`, or from Source Control. **Bugbot** reviews PRs remotely;
  `/review-bugbot` stores the reviewed diff's patch ID so the remote PR review is skipped
  when the same diff is pushed. Bugbot findings link back as "Fix in Cursor" / "Fix in Web".
- **Approvals and questions (verified):** the agent has an "Ask questions" tool and
  **keeps working while waiting** for the answer, merging it when it arrives. Checkpoints
  restore files only (messages stay).
- **Attention (verified/forum):** completion sound and OS notification; forum reports that
  the sound does *not* fire when the agent is blocked on a command approval. Remote Control
  (Oct 2026) lets the iOS app list and reply to **local** agents.
- **Artifacts (verified):** cloud agents produce screenshots, videos and logs "so you can see
  how the agent verified its work"; remote-desktop takeover; **Canvases** (interactive,
  shareable by link). Agent runs are shareable by URL (read-only by default).
- **Extensibility surfacing (verified):** plugins bundle MCP, skills, subagents, hooks;
  marketplace + team marketplaces. Settings live under Cursor Settings (Agents; Git & PRs).
- **Usage (unknown/forum):** usage dashboard exists; forum asks for per-subagent attribution.
  No in-window usage meter found in fetched docs.
- **Keyboard:** Cmd+Shift+P palette drives window switching (verified).
- **Steal:** coordinator "Project" that owns child agents + listening subscriptions;
  local↔cloud handoff as one verb; review that dedupes across local and PR surfaces
  (patch-ID); per-chat icon/colour.
- **Complaints (forum, best-effort):** no timestamps/durations on steps in long runs;
  large blank block under replies; workspace labels show relative paths; can't tell git
  repos apart in the Changes menu; chat stuck in the wrong project group after an agent adds
  a folder; Agents Window not localized; skills from other tools (`~/.claude`, `~/.codex`)
  silently injected (~10–14K tokens); hangs in grep/subagent loops.

## 2. Zed (Agent Panel, Threads Sidebar, ACP)

Sources: [Agent Panel](https://zed.dev/docs/ai/agent-panel),
[Parallel Agents](https://zed.dev/docs/ai/parallel-agents.md),
[Tool Permissions](https://zed.dev/docs/ai/tool-permissions.md).

- **Primary metaphor (verified):** threads inside an editor. A **Panel Layout** switch flips
  between **Agentic** (Agent Panel + Threads Sidebar on the left, project/git panels on the
  right) and **Classic**. Same app, two layouts, not two windows.
- **Top-level IA (verified):** Threads Sidebar groups threads **by project**, each row with
  title, status indicator and *which agent* runs it. Three thread types share one list:
  Zed Agent, External Agent (ACP: Claude Code, Codex…), and **Terminal Threads** (a CLI/TUI
  hosted as a thread). Multiple projects in one sidebar; "Add Project" bottom-bar button.
- **Switching (verified):** click, or `ctrl-tab` thread switcher across recent threads;
  `cmd-alt-j` toggles sidebar; `cmd-f` searches it; `cmd-g` opens Thread History (all
  threads incl. archived, fuzzy title search). Archive = `shift-backspace`; running threads
  cannot be archived until done.
- **Parallelism (verified):** worktree picker in the **title bar**; new worktrees start
  detached; `create_worktree` task hook for setup. Archiving a thread saves the worktree's
  git state and removes it from disk; **restoring the thread restores the worktree**.
- **Review (verified):** after edits, an accordion above the composer shows file/line counts;
  `Review Changes` opens a multibuffer of all agent edits with per-hunk keep/reject; optional
  inline single-file review overrides the git gutter while active. "Restore Checkpoint" on
  each message, even mid-interrupt. "Follow the agent" crosshair jumps the editor to each
  file it touches.
- **Approvals (verified):** tool card with Allow once / Deny once / Always for *tool* /
  Always for *pattern* (pattern extracted from the input). Rules: built-in deny → always_deny
  → always_confirm → always_allow → defaults; settings page has a "Test Your Rules" checker.
- **Queue/steer (verified):** messages sent while generating are queued; per-message
  **Steer** toggle interrupts at the next tool boundary; "Send Now"; edit/remove queued.
- **Attention (verified):** OS notification and/or sound when generation ends or the agent
  waits; keeps the OS awake while generating (not while waiting for confirmation).
- **Usage (verified):** token count for the active thread next to the profile selector;
  auto-compaction shows an expandable "Context Compacted" entry; "New From Summary".
- **Steal:** archive/restore that round-trips the worktree; terminal-as-a-thread; queue with
  per-message steer; one sidebar for heterogeneous agents; "Test Your Rules".
- **Complaints:** unknown (not researched beyond docs). Docs admit feature gaps per external
  agent (history restore, checkpoints, token display vary by ACP agent).

## 3. VS Code + GitHub Copilot (Agents Window, Chat view, github.com Agents)

Sources: [Agents Window](https://code.visualstudio.com/docs/agents/run/agents-window.md),
[Manage sessions](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions.md),
[Configure the Agents window](https://code.visualstudio.com/docs/agents/run/agents-window-configuration.md),
[Artifacts](https://code.visualstudio.com/docs/agents/run/artifacts.md),
[Approvals](https://code.visualstudio.com/docs/agents/run/approvals.md),
[GitHub Agent management](https://docs.github.com/api/article/body?pathname=/en/copilot/concepts/agent-capabilities/choosing-and-delegating-agent-work/agent-management).

The most elaborate IA in this set; it reads like a direct answer to "too many agent features".

- **Primary metaphor (verified):** a **session** = workspace + code changes + one or more
  chats. Two surfaces over the same sessions: the **Agents Window** (dedicated window, also
  in the browser at `insiders.vscode.dev/agents`) and the editor's **Chat view**.
  "Open in Editor" / "Open in Agents" moves a session between them without changing
  harness/workspace/worktree.
- **Top-level IA (verified):** five areas: **Sessions list** (left) · **Customizations**
  (sidebar action → one Agent Customizations editor) · **Chat** · **Changes** panel ·
  **Files** panel; plus Terminal, Tasks, Browser, Automations. Everything right of the list
  follows the **active session** (a table in the docs spells out what each panel shows).
  Quick chats (no workspace) live in a separate "Chats" group and can later be *promoted*
  into a workspace session without losing history.
- **Session list (verified):** across workspaces; group by workspace or time; pin; custom
  groups and subgroups with icon + colour; drag-and-drop; filters Active / **Done** /
  **External** (shows Claude Code, Codex, Copilot CLI sessions discovered on disk, with a
  time window). Nested sessions (child chats), side chats (`/btw`), forks (`/fork`), read-only
  subagent chats all hang under the parent. Moves have a 10-second **Undo**.
- **Parallelism (verified):** **sessions grid**: drag sessions into a 2-D split; one active
  pane drives Files/Changes/Terminal; Maximize/Restore; layout restored on reload; collapses
  to one pane on phone width. Isolation choice per session: **New Worktree** vs **Folder**,
  plus Dev Container, SSH/tunnel remote, cloud session. Compare-models with an optional
  **Judge**.
- **Review (verified):** Changes dropdown: branch / uncommitted / all / **last agent turn**;
  range-based feedback to the agent from a diff; Commit (generated message), Create PR form
  with "after creation" policy (manual, auto-merge, **Agent merge**: the agent watches the PR
  and fixes reviews, CI and conflicts until mergeable).
- **Approvals (verified):** permission picker in the composer: Manual / Assisted (LLM judge)
  / Allow all; Autopilot is a *mode*. Scoped approvals: Allow once, **in this Session**, or
  Always Allow, by command prefix, host or path. "Manage Tool Approval" groups by MCP
  server/extension. Notable trade-off: **worktree sessions use Allow all** (no prompts).
- **Attention (verified):** app-icon **badge** counts sessions that need attention, defined
  precisely: unread & finished, waiting for input, or failing CI on an open non-draft PR.
  Unread-but-running sessions are excluded. Also title-bar status indicator and a sessions
  welcome page. Per-chat progress/unread dots inside multi-chat sessions.
- **Artifacts (verified):** an **artifacts panel** beside the chat, grouped by origin
  (rules-based extraction by MIME/glob, agent-set via `#artifacts` tool, per-subagent groups).
  Distinguishes **artifacts** (things the session works on, incl. the PR/issue) from
  **references** (things it only consulted). PR/issue pills above the input.
- **Lifecycle (verified):** Close tab (hide) / **Mark as Done** (archive; commits uncommitted
  worktree changes to the session branch, removes folder, restore re-creates it) / Delete.
  **Worktree Cleanup** editor lists inactive worktrees with estimated sizes; auto-done for
  sessions whose PR merged; storage suggestion at ≥5 GiB / 20 worktrees.
- **Usage (verified):** context-window control in the composer; hover shows token
  breakdown by category and the session's total AI credits; `/compact`; Cache Explorer.
- **github.com (verified):** repo **Agents** tab + Copilot home: start (model, third-party or
  custom agent), live session log, **steer mid-session** (costs credits), "Open in VS Code" /
  "Continue in Copilot CLI", jump to PR, automations, query past sessions.
- **Steal:** precise attention definition; Done-with-resource-cleanup semantics; active-session
  table as an IA contract; external-session discovery; artifact vs reference split;
  quick chat → workspace promotion; undoable moves.
- **Complaints:** unknown from forums. Self-evident cost: a very large surface with many
  experimental settings (`sessions.*`, `chat.agentHost.*`), which the docs need dozens of
  pages to explain; harness feature parity is uneven (many "supported for Copilot/Claude
  only" notes).

## 4. Google Antigravity (App 2.0, IDE, CLI)

Sources: [features](https://antigravity.google/docs/features.md),
[artifacts](https://antigravity.google/docs/artifacts.md),
[artifact review](https://antigravity.google/docs/artifact-review.md),
[walkthrough](https://antigravity.google/docs/walkthrough.md),
[projects](https://antigravity.google/docs/projects.md),
[review changes](https://antigravity.google/docs/review-changes.md),
[customization discovery](https://antigravity.google/docs/customization-discovery.md),
[IDE side panel](https://antigravity.google/docs/ide/agent-side-panel.md),
[/usage](https://antigravity.google/docs/cli/commands/usage.md),
[llms.txt](https://antigravity.google/llms.txt).

- **Primary metaphor (verified):** the product split into surfaces: **Antigravity App**
  ("graphical command center … for monitoring and managing active background agents"),
  **Antigravity IDE** (editor with an Agent side panel), CLI, IDE extensions, SDK. The original
  "Agent Manager vs Editor" split has become *App vs IDE*. (The old `/docs/agent-manager` URL
  now 404s.)
- **Top-level IA (verified):** left sidebar: **Projects** (+ New Remote Project),
  conversations, **Customizations** (Installed / Marketplace), **Automations**, Settings at
  the bottom. A conversation has a side panel with an **Overview** (subagents, Review entry)
  and tabs added via **+**: Browser, Terminal, PDF, Review, artifacts. Conversations outside
  projects run in a scratch folder.
- **Projects (verified):** a project = set of folders (multi-repo) + **scoped settings and
  permissions** (presets: Inherit Global, Default, Auto, Turbo). Per conversation: **Local**
  vs **New worktree** mode.
- **Artifacts as first-class (verified):** implementation plans, task lists, diffs,
  diagrams, screenshots, **browser recordings**, **walkthroughs** (end-of-task summary with
  screenshots/recordings), interactive HTML (`/generative_ui`). Users **comment inline on
  artifacts** (including by voice) to steer. **Artifact review policy**: "Request review"
  (agent halts on plan/diff) vs "Always proceed". Execution modes: Planning vs Fast.
- **Review (verified):** Review pane: Uncommitted / Branch / **Agent Edits**; each turn's
  "N files changed" card opens Review **filtered to that turn**; line comments queue as a
  "1 Comment" chip on the next message; Quote (Cmd+L) adds a line-range reference; commit
  with generated message, amend, push.
- **Approvals (verified):** sandbox-first: in **Auto**, commands run inside a terminal
  sandbox without prompting, out-of-sandbox commands are risk-evaluated, risky ones ask.
  Grants made in a conversation can persist to the project. CLI: `Alt+J` jumps to the next
  subagent waiting for approval, `Ctrl+K` approves in place.
- **Attention (verified):** Remote Control (drive App and CLI sessions from any browser)
  with **browser push notifications** on completion or needed input.
- **Settings/extensibility (verified):** one discovery model (`.agents/` + `~/.gemini/config/`)
  for rules, skills, agents, plugins, hooks, MCP; Settings → Project → **Customizations**
  shows what loaded, **token cost of customizations**, and Global/Workspace badges with
  "Installed in / Included by" tooltips.
- **Usage (verified):** `/usage` panel with per-model quotas; `/credits`; status-line JSON
  includes token usage; automations pick a model tier.
- **Keyboard (verified):** Cmd+K palette searches past conversations (title, project,
  full text), files, app commands, and starts a conversation in another project.
- **Steal:** walkthrough artifact at task end; per-turn review filter; comments as a
  composer chip; "what's loaded and what it costs" panel; jump-to-next-waiting key.
- **Complaints:** unknown (not researched).

## 5. JetBrains (Air; Junie / AI Assistant)

Sources: [Air](https://www.jetbrains.com/air/), [Air in IDEs](https://www.jetbrains.com/air/ides/),
[Air blog](https://blog.jetbrains.com/air/).

- **Primary metaphor (verified):** "one system for building software with agents"; an
  **agent-agnostic** ADE (Claude Agent, Codex, Copilot, Cursor and any ACP agent from an
  **agent registry**) running in JetBrains IDEs, web (`air.jetbrains.cloud`), CLI, mobile
  (mobile announced for 2026-11-15). Copilot plans usable in Air (Nov 2026 blog).
- **IA (best-effort, from product-page mock):** web top nav **Tasks · Automations ·
  Projects**; a project page shows members, environments, **credits used/renewal**, members
  over quota, and an automations table (trigger, runs, last run, **AI credits spent** per
  automation). Each agent reply in the mock carries "0.58 credits · 4s".
- **Parallelism and status (verified):** "Keep several projects open, each with its own
  sessions, and track unread updates, changed files, and outgoing commits in all of them";
  Git worktrees; local → cloud handoff.
- **Review (verified):** diffs open from the session, validated with IDE inspections/tests,
  line comments to the agent.
- **Accounts (verified):** bring your own subscription/API key/base URL; "switch between
  subscriptions — even mid-session".
- **Junie / AI chat:** **unknown**; not fetched this session.
- **Steal:** per-message cost + latency footer; credits per automation; "outgoing commits"
  as a session status dimension; mid-session account switch presented as a normal action.
- **Complaints:** unknown.

## 6. Devin Desktop (ex-Windsurf) — Agent Command Center

Sources: [Agent Command Center](https://docs.devin.ai/desktop/agent-command-center.md),
[Devin Desktop docs nav](https://docs.devin.ai/desktop/introducing-devin-desktop).

- **Primary metaphor (verified):** editor-first product (Windsurf heritage: Tab, Cascade
  legacy, Codemaps, DeepWiki) with a separate **Agent Command Center** surface that manages
  local agents (editor sessions, ACP agents) and cloud Devin VMs in one view; "does not
  replace the editor".
- **Session list (verified):** filter/sort/group per workspace; right-click rename,
  **folders**, start **child sessions**; "Duplicate session" from a response footer.
- **Distinctive (verified):** sessions are **locked read-only (greyed) while their agent
  runs**. Queued messages are editable.
- **Attention (verified):** **one** native OS notification per session (finished or needs
  input) across all agent types, "rather than one per surface"; off by default.
- **Usage (verified):** Accounts → Usage and Quota pages (separate from the work surface).
- **Complaints:** unknown; brand transition itself is confusing (see windsurf.md).

---

## Synthesis

### Convergent patterns (table stakes by late 2026)

| Pattern | Cursor | Zed | VS Code | Antigravity | Air | Devin |
|---|---|---|---|---|---|---|
| Left sidebar of sessions grouped by project/workspace | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Local + cloud/remote sessions in one list | ✓ | – | ✓ | ✓ | ✓ | ✓ |
| Per-session isolation choice: worktree vs in-place | ✓ | ✓ | ✓ | ✓ | ✓ | ? |
| Diff panel with "agent edits / branch / uncommitted / last turn" scopes | ✓ | ✓ (multibuffer) | ✓ | ✓ | ✓ | ? |
| Line comments on diffs fed back to the agent | ? | – | ✓ | ✓ | ✓ | ? |
| Commit/PR from the agent surface | ✓ | – | ✓ | ✓ | ✓ | ? |
| Queued + steerable messages | ✓ | ✓ | ✓ | ✓ | ? | ✓ |
| Archive/Done distinct from Delete | ✓ | ✓ | ✓ | ? | ? | ? |
| Fork/duplicate/side-chat from a point in the thread | ? | New-from-summary | ✓ | `/fork`, `/btw` | ? | ✓ |
| OS/push notification on "done or needs you" | ✓ | ✓ | ✓ | ✓ | ? | ✓ |
| One customizations hub (rules, skills, MCP, hooks, plugins, marketplace) | ✓ | partial | ✓ | ✓ | ? | ✓ |
| Command palette that also searches sessions | ✓ | ✓ | ✓ | ✓ | ? | ✓ |
| Automations/schedules as a top-level nav item | ✓ | – | ✓ | ✓ | ✓ | – |
| Context/token meter in the composer | ? | ✓ | ✓ | CLI | ✓ | ? |

### Divergent bets

1. **Two windows vs one window with two layouts vs two products.** Cursor and VS Code ship
   a separate *Agents Window* beside the editor; Zed flips one window between *Agentic* and
   *Classic* layouts; Antigravity split into an *App* (manager) and an *IDE*; Devin adds a
   *Command Center* surface inside the editor; Air lives inside the IDE and on the web. The
   common idea is that **the manager view is primary for delegation and the editor is the
   drill-down**. No one has found a single view that does both well.
2. **Who decides when to stop.** Antigravity makes the **plan artifact** the checkpoint
   (Request review vs Always proceed). VS Code goes the other way: Autopilot, an
   LLM-judged "Assisted" permission, and *Agent merge* that keeps going until the PR is
   mergeable. Cursor's question tool lets the agent ask without blocking.
3. **Safety model: prompts vs sandbox.** Zed/VS Code-folder rely on fine-grained approval
   rules; Antigravity "Auto" and VS Code worktree sessions lean on sandbox/isolation and skip
   prompts. Isolation is becoming the default way to cut approval fatigue.
4. **Hierarchy depth.** Cursor *Projects* (coordinator → agents), VS Code nested sessions /
   side chats / subagent chats, Devin folders + child sessions, Zed flat threads. Deeper
   trees need undoable moves (VS Code) and clear "who owns this worktree" rules.
5. **Session concurrency.** Devin locks a running session read-only; Zed and Cursor queue
   and steer.
6. **Cost visibility.** Air puts credits on every reply and every automation; VS Code puts
   them behind a hover on the context meter; Cursor keeps them on a dashboard. Users ask for
   attribution per subagent (Cursor forum).

### 10 concrete lessons for our ADE

1. **Define one primary object and make every panel follow it.** VS Code's "active session"
   table (chat, files, changes, terminal, browser all follow the focused session) is the
   cure for a Frankenstein UI. Our object is the *thread*: thread = conversation + JJ
   workspace + jobs + questions + artifacts + cost. Every plugin panel should declare
   "follows active thread" or "global", and nothing in between.
2. **Ship a manager view and treat the editor/diff as drill-down.** Converge on: left =
   threads grouped by project (with host as a badge, since we have multi-host), centre =
   conversation, right = a tabbed detail pane (Changes, Files, Artifacts, Jobs, Terminal,
   Browser) opened with **+** as in Antigravity. One layout, not 80 plugin-specific panels.
3. **Give "needs attention" one precise definition and one counter.** Copy VS Code: count
   threads that are (a) finished and unread, (b) waiting on a question/approval, (c) failing
   checks; exclude running-and-unread. Show it on the tab title/favicon and as a sidebar
   filter, and send one notification per thread (Devin) via browser push, which also matters
   for phone use. Add a "jump to next waiting" shortcut (Antigravity `Alt+J`).
4. **Make questions and approvals inline cards with scoped "always".** Allow once / for this
   thread / always for *pattern*, as in Zed and VS Code, with a rules page that has a "test
   this rule" box. Keep the agent working while it waits where it can (Cursor's question
   tool). Approval waits must trigger the same notification as completion; Cursor users
   report that this gap hurts.
5. **Review by scope, comment into the composer.** The Changes tab needs a scope switch
   (this turn / thread revisions / uncommitted vs `main`), per-turn "N files changed" cards
   that open Review filtered to that turn, and diff line comments that queue as a chip on the
   next message (Antigravity). Map it to JJ revisions instead of git staging. That is our
   advantage, so don't hide it.
6. **Promote artifacts to a first-class tab, and distinguish them from references.** Plans,
   walkthrough summaries, screenshots, HTML renders, test receipts and linked backlog items
   go in one Artifacts list per thread, grouped by origin (agent, subagent, rule). Things the
   thread only consulted are references (VS Code). End each task with a **walkthrough**
   artifact (Antigravity), which gives reviewers an async entry point.
7. **Make Done a real lifecycle verb with resource cleanup.** "Mark as done" should
   snapshot/describe the JJ revision, release the workspace and stop jobs, and restore must
   re-create them (VS Code archive, Zed history restore). Add a cleanup screen that lists
   idle workspaces with sizes (we already have `jj_thread_cleanup`; give it a UI). Never
   delete in one click.
8. **Put cost and quota where decisions happen.** Show a context/token meter in the
   composer, cost + latency in each reply footer (Air), cost per automation/schedule, and
   per-subagent attribution. Account/fallback switching belongs in the composer's model
   picker as a normal action (Air: "switch subscriptions mid-session"), not only in Settings.
9. **One customizations hub that shows what loaded, from where, at what token cost.**
   Antigravity's project → Customizations list (Global/Workspace badges, "Included by"
   tooltip, token cost) answers the question our 80 plugins raise: what is active in this
   thread? Include MCP servers, skills, memory notes, AGENTS.md and agent presets. Cursor's
   forum complaint about silently injected foreign skill catalogs shows the trust cost of
   not doing this.
10. **One palette and a few verbs for everything.** Cmd+K must search threads (full text),
    files, backlog items and commands, and start a thread in another project (Antigravity,
    Zed). Name a small set of thread verbs the same way across UI, palette and agent tools:
    new, fork, side-question, move to workspace/host, hand off (local↔remote), mark done,
    restore. Make moves undoable (VS Code's 10-second Undo). Add timestamps and durations on
    steps from day one (Cursor's top open request for long runs).

### Open questions / unknowns

- JetBrains Junie and AI Assistant chat IA were not fetched; Air's IA comes from a marketing
  mock (best-effort).
- No first-party complaint data for Zed, VS Code, Antigravity, Air or Devin in this pass;
  only Cursor's forum was searched.
- Cursor's in-window usage display could not be confirmed.

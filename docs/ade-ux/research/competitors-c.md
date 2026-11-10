# Competitor UX research C — information architecture of parallel/multi-agent orchestration tools

**Snapshot:** 2026-11-04. **Scope:** how agent-orchestration products organise, show and close out many concurrent agents. Capability parity is covered in [harness-landscape](../../../docs/research/harness-landscape/README.md) ([orca.md](../../../docs/research/harness-landscape/orca.md), [opencode.md](../../../docs/research/harness-landscape/opencode.md)); this file is about IA and UX.

**Method and confidence.** Web search was unavailable in this session (no Brave key), so every claim comes from first-party pages I fetched directly: docs, changelogs and marketing pages. Labels:

- **verified**: stated on a first-party page fetched 2026-11-04 (URL given).
- **best-effort**: inferred from first-party text, such as a changelog fix list or a marketing mock-up, not stated as a feature.
- **unknown**: not checked. This includes nearly all user complaints, because Reddit, Discord, HN and GitHub issues were not searchable. The "complaints" rows below are inferred from vendors' own changelog fix lists. They show pain points that existed, not what users say.

All fetched content was treated as untrusted data.

**Coverage:** Conductor, Paradev (formerly Superset), Amp, Warp, Devin Desktop, Vibe Kanban, Kiro (IDE Agent Focus Mode and Crew), and OpenCode desktop/web. Not covered: Sculptor, Crystal/Nimbalyst, Factory, Jules. Orca is already in orca.md. Notable finding: Paradev is Superset's new name (paradev.com, "Superset is now Paradev", $11.5M seed). Also, Kiro Crew lists **DeepSeek Harness** as one of its agent backends ([kiro llms.txt](https://kiro.dev/llms.txt), Crew → Agent backends). DSH is already a peer in this market.

---

## 1. Conductor (conductor.build, Melty Labs) — Mac app, v0.92 (Oct 23 2026)

| Dimension | Findings |
|---|---|
| Primary metaphor | **Workspace list.** "The workspace is the unit of delegation. The branch and pull request are the unit of integration." **verified** [workflow](https://www.conductor.build/docs/concepts/workflow) |
| IA / layout | Left sidebar of workspaces. Pinned section, "My workspaces", optional status-grouped sections, History pane for archived workspaces. Each workspace has chat tabs (several chats per workspace), a Git panel (Changes, Checks, Artifacts tabs), terminal/Run pane, Diff Viewer (⌘⇧D) and PR view. ⌘K searches chats; ⌘1–9 jumps between workspaces. **verified** [changelog](https://www.conductor.build/changelog) |
| Parallel count & attention | No stated cap. Workspaces re-sort by activity unless "Arrange workspaces manually" is on (0.92). There is a "matrix-style workspace status indicator" in Home, the sidebar and tabs, plus animated status marks. Notifications show the chat title rather than the branch. A message sent mid-turn stays faded until the agent reads it. **verified** [changelog](https://www.conductor.build/changelog) |
| Worktree / isolation | Strict 1:1:1 chain: project → repo → workspace = git worktree = branch. Workspaces get city-name directories (`warsaw-v2`) plus an auto-renamed branch, a `CONDUCTOR_PORT` env var, and an uncommitted `.context/` folder for handoff notes. Docs say plainly that it is "development isolation, not a security boundary". **verified** [isolated workspaces](https://www.conductor.build/docs/concepts/workspaces-and-branches) |
| Review → merge | Diff Viewer with inline comments that **become composer attachments** sent back to the agent. A "Review" action runs an agent review. Checks tab covers git status, CI, deployments, comments and todos. ⌘⇧P creates the PR. The PR view is one card (branch, review, checks, merge) with activity underneath; the Review row adds unresolved comments to chat; the Checks row re-runs or fixes failed checks. Merge is blocked if GitHub moved past the workspace. Stacked PRs are supported. Then **Archive**, which can be restored from History along with its chat. **verified** [workflow](https://www.conductor.build/docs/concepts/workflow), [changelog 0.89](https://www.conductor.build/changelog) |
| Plans/specs ↔ sessions | Plan mode with an **Approve** button on the pending plan. Workspaces can be created from a GitHub/Linear issue, PR or branch. "Routines" are scheduled runs that create workspaces (hidden from Home by default, with a filter). **verified** [changelog](https://www.conductor.build/changelog) |
| Sharing / collab | Cloud orgs: multiplayer cloud chats (agents can tell who sent each message), shared workspaces, teammate profiles with a daily token-usage heatmap, "Pokes". Workspace numbers (`W-123`) and org-slug links. **verified** [changelog](https://www.conductor.build/changelog) |
| Settings / extensibility | Repository settings with "Actions" (formerly run scripts), MCP popover with tool counts per server, model "Loadout", customisable keyboard shortcuts, deep links (`conductor://`), Conductor API and CLI. Bundles Claude Code, Codex, Cursor Agent and OpenCode as *harnesses*. **verified** [docs](https://www.conductor.build/docs), [changelog](https://www.conductor.build/changelog) |
| Cost / usage | Context-usage indicator per chat (it also names the ChatGPT account in use), cost per cloud workspace in the workspaces list, token heatmap per teammate. **verified** [changelog](https://www.conductor.build/changelog) |
| Mobile / remote | iOS app (0.90): chat and merge PRs for cloud workspaces. 0.92 "Remote control" pairs an iPhone with the Mac by QR code to browse and create workspaces, read and send messages, pick models and stop agents in **local** workspaces, and keeps the Mac awake. Cloud workspaces sleep and wake. **verified** [changelog](https://www.conductor.build/changelog) |
| Distinctive ideas | (a) A docs page that teaches **when to split into workspaces and when to share one** (decision table). (b) Diff comments → composer attachments. (c) PR view as one status card. (d) `.context/` as an uncommitted handoff folder. (e) Run buttons on bash snippets in agent replies. (f) Chat outline on the right edge for long chats. (g) Updates wait for confirmation when a run script is active or a prompt is unsent. **verified** |
| Complaints | **best-effort**, from fix lists: chats stuck "working" or "Waiting for task", memory that grew with every turn, long chats slow or crash-looping, stale diffs, cloud sync stalls, sidebar jumps when archiving. Long-lived chats and status accuracy are recurring pain. [changelog](https://www.conductor.build/changelog) |

## 2. Paradev (formerly Superset) — desktop app, open source (15.9k★)

| Dimension | Findings |
|---|---|
| Primary metaphor | **Workspace list + terminals** ("Run an army of coding agents"). One model: "delegate in workspaces, integrate through branches and PRs". It has five concepts: Projects, Workspaces, Terminals, Agents, **Devices**. **verified** [model](https://docs.paradev.com/superset-model) |
| IA / layout | The marketing mock-up shows the sidebar grouped by **device/location** (`desktop 5`, `cloud 3`, `gpu-box 14`, `mobile 1`, `cli 4`), each row with diff stats (+46 −1) and a spinner. Tabs at the top (Workspaces, Automations), a Run/PR/Files/Changes/Review panel, and an agent picker (claude, codex, cursor, opencode). Docs list Multiple Windows, Pages, In-App Browser and Port Management. **best-effort** (mock-up) [paradev.com](https://paradev.com); nav **verified** [docs](https://docs.paradev.com) |
| Parallel count & attention | An "activity strip" on each workspace shows running agents and open ports inline. Agent chips appear **only when more than one agent runs** in that workspace. Live work is emphasised visually. Running and PR state survive restarts. "Clear Status" fixes a stale indicator. Notifications fire on finished and waiting-for-input; the macOS dock badge counts attention. Status comes from **lifecycle hooks injected into each agent CLI's config**, and support varies per agent. **verified** [agent-status](https://docs.paradev.com/agent-status) |
| Worktree / isolation | Worktree per workspace with persistent terminals that survive app restarts; only git-tracked files are copied, and setup scripts do the rest. Ports are shared but shown. **verified** [model](https://docs.paradev.com/superset-model) |
| Review → merge | Built-in diff viewer to stage, commit, push and open a PR; mock-up shows Approve/Comment. **verified** [docs home](https://docs.paradev.com) |
| Plans/specs ↔ sessions | "Tasks" page (not read). The recipes are the IA: **race agents** (N workspaces, same prompt, merge the best diff), parallel workstreams, fan-out refactor, nightly audit, PR-feedback clearing, Sentry or Slack triage. **verified** (titles) [docs](https://docs.paradev.com) |
| Sharing / collab | Org plugins; little else seen. **unknown** |
| Settings / extensibility | Plugin catalog (GitHub, Sentry, Linear, Slack, Notion…), CLI, TypeScript SDK, a **Paradev MCP server so agents can drive Paradev**, custom themes, lifecycle scripts in `.paradev/config.json`. **verified** [docs](https://docs.paradev.com) |
| Cost / usage | A "Usage" page exists; contents not read. Paradev "never touches model traffic", so you bring your own subscriptions. **verified** / **unknown** |
| Mobile / remote | Mobile app; remote access through a relay to workspaces on another device (a Mac mini, a GPU box); automations dispatch to a chosen device. **verified** [model](https://docs.paradev.com/superset-model) |
| Distinctive ideas | **Device as a first-class grouping axis.** Race mode as a named recipe. Agent chips only when they help. Docs organised as recipes (job-to-be-done) rather than features. |
| Complaints | **unknown** (not researched). |

## 3. Amp (Sourcegraph / ampcode.com) — web, CLI, macOS/iOS/Android

| Dimension | Findings |
|---|---|
| Primary metaphor | **Thread** (chat) as the unit of work, separate from where it runs: an **orb** (per-thread cloud machine), a runner, or a local CLI. "Same agent and the same threads everywhere." **verified** [threads](https://ampcode.com/docs/threads), [intro](https://ampcode.com/docs) |
| IA / layout | Sidebar: Pinned → **active threads grouped by project** → collapsed **"Inactive Last 72h"** (with an archive-all button) → Snoozed → Archived. **Activity** feed (`/feed`) shows every visible thread with time/status/author/project filters; **filters live in the URL** and you can right-click to "Use … as Default". Thread view has a title bar (title, More Actions, Share, project, mode) and right panes: Changes, Portals, Files, Terminal, Space (voice/video call). **verified** [threads](https://ampcode.com/docs/threads) |
| Parallel count & attention | Notifications when "a thread is ready for your next message". **Snooze Until I'm Needed** hides a thread until someone messages, the agent finishes a reply, or a scheduled run reports something new ("not when it only says nothing changed"). A snoozed thread **resurfaces while it waits for approval or an answer**, then re-snoozes. Thread colors and labels (`label:bug`). **Puck**, a personal meta-agent on Ctrl+/ over any page, starts, monitors, steers, finds and archives agents, uses "this thread/project" as context, and has its own window on macOS. **verified** [threads](https://ampcode.com/docs/threads), [puck](https://ampcode.com/docs/puck) |
| Worktree / isolation | Orb = one machine per thread (cloud sandbox), snapshotted. Sync pulls the orb branch locally. **verified** [threads](https://ampcode.com/docs/threads) |
| Review → merge | Changes pane with **intelligent file order** (explanatory files first, generated files muted; re-ordering is deferred and shown as a blue dot, then "Apply Updated File Order"). Commit picker (All / Uncommitted / per commit / Compare With Branch). **Ship** button (configurable ship behaviour), **Review**, Sync. Saved prompts can become **buttons in the Changes tab** (`ship`, `update-base`, `refactor-commits`, `review`). Commits carry an `Amp-Thread-ID` trailer. **verified** [threads](https://ampcode.com/docs/threads), [puck](https://ampcode.com/docs/puck) |
| Plans/specs ↔ sessions | Threads start from the web, CLI, Puck, another thread (agent-to-agent, waiting for a result), automations or webhooks. "Handoff and …" starts a fresh thread with the distilled context. `@T-…` references pull context from another thread. **Archive N Threads** archives a parent with its children; archiving a parent alone moves children to the top level. **verified** [threads](https://ampcode.com/docs/threads) |
| Sharing / collab | Thread URLs; visibility Private / Workspace / Group / Unlisted; **Contribute** turns on multiplayer; audited admin access; `.md` export by appending to the URL. **verified** [threads](https://ampcode.com/docs/threads) |
| Settings / extensibility | Plugins, skills, MCP, AGENTS.md, model routing, "Decision Models", personal and workspace prompts. Puck is exposed as an **MCP server** (`puck`, `new_puck_conversation`, `orbs`) usable from Claude or ChatGPT. **verified** [docs](https://ampcode.com/docs), [puck](https://ampcode.com/docs/puck) |
| Cost / usage | Cost and orb status appear in the thread's More Actions menu (screenshot caption); a Sizes & Costs page exists. **verified** (caption) |
| Mobile / remote | Native iOS/Android with dictation and share sheet; "Call Puck" by voice, including as a phone call. **verified** [puck](https://ampcode.com/docs/puck) |
| Distinctive ideas | **Meta-agent for fleet management** (Puck). **Snooze-until-needed.** Automatic 72h inactivity folding. URL-encoded feed filters. Prompt-as-button. Thread-ID commit trailers. "If we don't use and love a feature, we kill it" as product policy. |
| Complaints | **unknown**. The "no backward compatibility" policy implies churn (**best-effort**). |

## 4. Warp (agentic terminal + Oz/Automation Platform)

| Dimension | Findings |
|---|---|
| Primary metaphor | **Terminal with agent conversations**, plus a **run list**: "agent observability is run- and session-oriented". **verified** [managing](https://docs.warp.dev/platform/managing-cloud-agents.md) |
| IA / layout | **Agent Management Panel** in the app, and the **Runs** page in the Oz web app (works on mobile). Personal/All tabs; filters by source (Interactive, CLI, API, Slack/Linear, Scheduled), day, creator and status. One row per conversation or run; clicking opens the session. **verified** [managing](https://docs.warp.dev/platform/managing-cloud-agents.md) |
| Parallel count & attention | Five statuses: Working, **Blocked** 🟨, Canceled, Failed 🔺, Success ✅. Unattended third-party harness runs that need input **end as Blocked** instead of hanging. Orchestration **pill bar** above the agent view: parent pill plus one pill per child with a live status badge; click to swap the pane in place; a breadcrumb leads back. Notifications fire **only on the parent**. "A parent can finish successfully while a child is still running or has failed", and the docs tell users to check each child. **verified** [orchestration](https://docs.warp.dev/platform/orchestration.md) |
| Worktree / isolation | Cloud runs get "environments"; a "cloud → cloud-local" mode lets children share the parent's environment. Guide covers assigning worktrees. **verified** |
| Review → merge | Session link alongside PR link is the recommended review path. **verified** |
| Plans/specs ↔ sessions | `/plan` and `/orchestrate` produce a plan card with an inline **orchestration config block** (model, harness, environment, host, parallelism pickers), and **approval is required before children launch**. Named patterns: supervisor/worker, fan-out/fan-in, critic/verifier, review swarm, DAG, swarm. "Factories" provide standing teams with a foreman. Orchestration is one level deep. **verified** [orchestration](https://docs.warp.dev/platform/orchestration.md) |
| Agent-to-agent | Durable server-backed mailbox per agent ID; messages and state transitions share **one global sequence number**, so a parent never sees SUCCEEDED before the result message. Finished children stay addressable and wake on a new message. **verified** [orchestration](https://docs.warp.dev/platform/orchestration.md) |
| Sharing / collab | Shared session links for cloud runs; Agent Session Sharing for local runs. **verified** |
| Cost / usage | Usage per run, with credits and dollars; factory runs show token and cost detail. **verified** [managing](https://docs.warp.dev/platform/managing-cloud-agents.md) |
| Mobile / remote | Oz web Runs page on mobile; local↔cloud handoff with snapshots. **verified** |
| Distinctive ideas | **Source** as a list column (who or what started the run). Blocked as a terminal state for unattended work. Approving the orchestration config before fan-out. One sequence across messages and lifecycle. |
| Complaints | **unknown**. The docs openly name a UX hole: parent status hides child failures (**verified**). |

## 5. Devin Desktop (Cognition, ex-Windsurf) + Devin Cloud

| Dimension | Findings |
|---|---|
| Primary metaphor | **IDE with an "Agent Command Center"** that manages local (Devin Local / ACP agents) and cloud (Devin VM) sessions in one view. **verified** [ACC](https://docs.devin.ai/desktop/agent-command-center.md) |
| IA / layout | Agent sidebar lists every session in the workspace: filter, sort, **group per workspace**, rename, **folders**, start child sessions from the right-click menu. Switching between the editor and the agent window keeps last-mile manual edits possible. **verified** [ACC](https://docs.devin.ai/desktop/agent-command-center.md) |
| Parallel count & attention | **One native OS notification per session** on finished or needs-input, the same for every agent type, off by default. Sessions are **locked read-only while the agent runs**. Queued messages can be edited before they send. **verified** [ACC](https://docs.devin.ai/desktop/agent-command-center.md) |
| Worktree / isolation | Devin Local can run in a new or existing git worktree and merge back. Cloud sessions run on VMs; "Local Hands" lets a cloud session run commands on your machine, with approval for each tool call. **verified** [llms index](https://docs.devin.ai/_llms/en/desktop.txt) |
| Review → merge | Devin Review (PR review, auto-review), Stacked PRs that land bottom-up, Quick Review on local changes, video recordings as test proof. **verified** (index) [llms.txt](https://docs.devin.ai/llms.txt) |
| Plans/specs ↔ sessions | Ask Devin generates "high-context sessions". Playbooks (reusable prompts), Dynamic Workflows (Python scripts fan out sessions and resume runs), Automations, Session Insights (post-hoc analysis with improved prompts). **verified** (index) |
| Other | Duplicate session (branch a conversation from the response footer); memory + "Dreaming"; usage in ACUs with per-user caps; **Devin Coach** flags inefficient prompts before you send. **verified** (index) |
| Mobile / remote | Slack/Teams as remote surfaces; SSH into cloud sessions. **verified** (index) |
| Complaints | **unknown**. |

## 6. Vibe Kanban (BloopAI) — open source, local + cloud

| Dimension | Findings |
|---|---|
| Primary metaphor | **Kanban of issues** (cloud) above a **Workspaces UI** (four panels). Board columns are To do / In progress / In review / Done, plus hidden Backlog and Cancelled. **verified** [kanban](https://www.vibekanban.com/docs/cloud/kanban-board.md) |
| IA / layout | Workspace sidebar (left) · Conversation panel · Context panel that toggles Changes/Logs/Preview · Details sidebar (Git, Terminal, **Notes**). Floating draggable context bar; panel layout remembered **per workspace**; "Open in Old UI" escape hatch. **verified** [interface](https://www.vibekanban.com/docs/workspaces/interface.md) |
| Parallel count & attention | Sidebar toggles between a flat list and an **accordion grouped by Needs Attention / Idle / Running**. Indicators: Running, Idle, Needs Attention (raised-hand icon), Pinned, Dev Server (blue), PR status badge. **verified** [interface](https://www.vibekanban.com/docs/workspaces/interface.md) |
| Worktree / isolation | Workspace = worktree(s), possibly multi-repo with a target branch per repo; several **sessions** (agent conversations) per workspace through a dropdown. **verified** |
| Review → merge | Changes panel with inline comments for agent feedback; Git section shows ahead/behind and uncommitted counts; PR/merge/rebase operations. **verified** |
| Plans/specs ↔ sessions | Issues on the board open an issue panel; approval workflows for agent plans in chat. Board multi-select gives a bulk-action bar (status, priority, assignees). WIP-limit advice. **verified** [kanban](https://www.vibekanban.com/docs/cloud/kanban-board.md) |
| Sharing / collab | Cloud orgs, real-time board sync, last-write-wins. Vibe Kanban MCP server. **verified** |
| Settings / extensibility | Agent profiles per CLI agent (10+ supported, including Amp, OpenCode, Droid, CCR, Qwen), MCP, self-hosting via Docker Compose. **verified** [docs](https://www.vibekanban.com/docs) |
| Mobile / remote | "Remote Access" page exists. **unknown** detail. |
| Distinctive ideas | **Status-grouped accordion** as an alternative to a flat list. Per-workspace notes. The board is separate from workspaces: tickets are planning, workspaces are execution. |
| Complaints | **best-effort**: the existence of "Open in Old UI" points to a UI migration in progress. |

## 7. Kiro (AWS) — IDE Agent Focus Mode, Specs, Crew

| Dimension | Findings |
|---|---|
| Primary metaphor | **Spec** (requirements.md / design.md / tasks.md) driving sessions. One "unified agent harness" across IDE, CLI, Web, Mobile and Crew. **verified** [specs](https://kiro.dev/docs/specs.md) |
| IA / layout | **Agent Focus Mode** (experimental) flips the IDE: Sessions (left) · Chat (center) · Auxiliary panel for specs, diffs and artifacts that stays hidden until needed (right). An Agent Focus ↔ Editor View toggle carries sessions across. Back/forward history (⌘[ / ⌘]) over sessions, Settings and Workspace Configuration; Settings is a toggle. **verified** [focus-mode](https://kiro.dev/docs/ide/experimental/focus-mode.md) |
| Parallel count & attention | Sessions grouped by workspace with Spinning / Warning (needs input) / Paused. **Attention cards**: each blocking ask (approval, question) becomes a card naming the session, project, question and exact command or path, with the agent's options as buttons, **answerable without switching session**. A titlebar bell shows the count; the panel **never opens on its own**. Answered cards clear; timed-out asks are **marked rather than silently removed**. The collapsed rail shows monogram tiles with a kind badge (local/cloud/CLI) and status. **verified** [focus-mode](https://kiro.dev/docs/ide/experimental/focus-mode.md) |
| Plans/specs ↔ sessions | New session offers workflow pickers (Spec, Plan, Bug Fix, Quick Spec) or a freeform chat. "Chat-first specs": talk first, then **attach a spec** that formalises the discussion. tasks.md has live per-task status; "run all" builds a **dependency graph of tasks into waves** that run concurrently. Markdown Review: comment on spec passages and send all comments in one batch. **verified** [specs](https://kiro.dev/docs/specs.md) |
| Review → merge | Inline diffs in chat open full view in the auxiliary panel; the agent opens a PR when tasks complete. **verified** |
| Crew | Self-hosted multi-agent dashboard: sessions with "dormant folding", cron, workflows with a "conductor", multi-instance over SSH/SSM/Fargate, **System & storage screen showing per-session resource use, credits and estimated tokens**, App Store, 10+ chat interfaces (Slack, Telegram, WhatsApp…). **verified** [llms.txt](https://kiro.dev/llms.txt) |
| Cost / usage | Credits per plan; proactive usage notifications; per-session cost in Crew. **verified** (index) |
| Mobile / remote | iOS preview tied to cloud sessions; "Open in Kiro Web / Open with Kiro CLI" on any session. **verified** |
| Distinctive ideas | **Attention-card inbox that you answer in place.** Spec-to-waves parallelism. Workflow picker on new session. Honest "what's not in Agent Focus yet" list with paths back. |
| Complaints | **unknown**. |

## 8. OpenCode (Anomaly) — TUI, desktop, web, ACP

| Dimension | Findings |
|---|---|
| Primary metaphor | **Session (chat)**, served by one background server that the TUI, desktop app and web UI all attach to. **verified** [web](https://opencode.ai/v2/docs/cli/web/) |
| Remote / pairing | `opencode pair` prints a **one-time link plus QR code** (expires in 5 min) that signs a browser or the app in for 30 days. `--remote` uses an end-to-end-encrypted tunnel after an explicit "expose to the internet?" confirmation. SSH port-forward recipe included. **verified** [web](https://opencode.ai/v2/docs/cli/web/) |
| Desktop | macOS/Windows/Linux builds; IDE integration via ACP. **verified** [download](https://opencode.ai/download) |
| Parallel / IA detail | Not established from fetched pages; see [opencode.md](../../../docs/research/harness-landscape/opencode.md). Conductor bundles OpenCode as a harness, which suggests OpenCode competes more as an *engine* than as an orchestration UI. **best-effort** |
| Distinctive ideas | **Pairing UX**: QR plus one-shot link plus a consent prompt before internet exposure. Relevant to DSH's iPhone/Tailscale usage. |

---

## Synthesis

### Convergent patterns (5+ products agree)

1. **Isolated workspace = the unit of delegation; branch/PR = the unit of integration.** Conductor, Paradev, Vibe Kanban, Orca and Devin Local all say this almost word for word. The sidebar row *is* the worktree.
2. **A small fixed status vocabulary.** Running / needs-input / idle / done / failed, conveyed with a spinner, a warning or raised-hand mark, and a badge. Warp, Kiro, Vibe Kanban, Paradev and Conductor each use 3–5 states. "Needs input" is always visually distinct from "running".
3. **Notify once per session, on finished or needs-input**, through the OS, dock badge, phone push or Slack (Devin, Paradev, Amp, Conductor, Warp).
4. **Diff comments flow back to the agent as its next prompt** (Conductor, Vibe Kanban, Kiro Markdown Review, Amp prompt buttons).
5. **The PR view is a status card**: review, checks, merge, then archive. Archive is reversible and keeps the chat.
6. **Archive aggressively.** Amp folds after 72h, Conductor archives after merge with a History pane, Crew has dormant folding. Active lists stay short by design.
7. **Phone is a remote control for a machine you own** (Conductor 0.92, Paradev devices, OpenCode pair, Amp apps). Converging on QR pairing.
8. **Plan approval before execution** (Conductor plan Approve, Warp `/orchestrate` approval, Kiro spec gates, Vibe Kanban plan approval).

### Divergent bets

| Bet | Who | Trade-off |
|---|---|---|
| Workspace list (task = worktree) | Conductor, Paradev, Orca | Clear integration story; weak for non-code, conversational or long-lived agents |
| Thread-first, execution location secondary | Amp, OpenCode | Great sharing and continuity; isolation is implicit (an orb per thread) |
| Run list / observability console | Warp, Devin ACC | Scales to automations and triggers; feels like ops, not authoring |
| Kanban of tickets above sessions | Vibe Kanban | Good for planning N tasks; two places to look; drag-to-status can drift from real agent state |
| Spec-first (requirements → design → tasks → waves) | Kiro | Parallelism comes from the plan, not from the user; heavier ceremony (they added Quick Spec) |
| Meta-agent manages the fleet | Amp Puck, Kiro Crew conductor, Warp parent | Conversational control at scale; trust and visibility of what it did |
| Device as an IA axis | Paradev | Honest about where compute lives; another grouping dimension |
| Child visibility | Warp: one level, pill bar; Amp: parent/child archive; Devin: child sessions in the sidebar | Deep trees are hard to show; everyone limits depth or flattens |

### Where DSH sits

DSH already has most of the *capabilities* (jj workspaces per thread, subagents, agent questions, comms, schedules, goals, backlog, multi-host, usage, traces). The gap is IA. The competitors each pick **one primary object** (workspace, thread, run, spec or ticket) and hang every capability off it. DSH exposes ~80 plugins as peers. The research suggests: **make the thread (agent conversation + its jj workspace) the single primary object, and make everything else a facet, a filter or an inbox over it.**

### 10 concrete lessons for the DSH ADE (5–20 agents at once)

1. **Pick one primary object and say it in one sentence.** For example: "A thread is the unit of delegation; its jj workspace's landing on `main` is the unit of integration." (Conductor and Paradev wording.) Backlog items, goals, schedules, questions, diffs, usage and traces become *facets of a thread* or *filters over threads*, not top-level destinations.
2. **Adopt a 5-state status vocabulary everywhere**: Working · **Needs you** · Idle/ready for review · Done/landed · Failed/blocked. Map DSH signals onto it: a pending agent question, quota-blocked continuation or approval → *Needs you*; jj conflict or failed turn → *Failed*. Use the same glyph in the sidebar, mobile, notifications and the collapsed rail. Never let a parent look "done" while a child failed (Warp's documented trap): roll child state up to the parent.
3. **Build one attention inbox with answer-in-place cards** (Kiro). Each card names thread and project and shows the question, command or diff plus option buttons. Feed it from DSH agent questions, child `ask_parent_question`, quota continuations, failed jobs and jj conflicts. Show a bell count; it **never auto-opens**; a timed-out ask is marked, not silently dropped. At 15 agents this replaces scanning the sidebar.
4. **Offer a status-grouped sidebar** (Vibe Kanban accordion: Needs you / Working / Idle), with Pinned on top and **automatic folding of threads inactive for 72h** (Amp), with archive-all on that group. Add "Arrange manually" as an opt-out (Conductor), because activity-sorting makes rows jump.
5. **Snooze until needed** (Amp). Hide a thread until it finishes, asks, or a scheduled run reports something *new*. This is the right primitive for DSH's persistent agents with schedules and goals: they shouldn't occupy attention between meaningful events.
6. **Close the review loop inside the thread.** The diff view (jj revisions) lets you comment inline, and the comments become the next composer message (Conductor, Vibe Kanban). Then show one **landing card**: description, checks, conflicts, "behind main by N", Land/Rebase. Archive on land, restorable with the chat. Add saved prompts as buttons on the changes pane ("review", "update-base", "ship"), as Amp does.
7. **Make fan-out an approved plan, not an implicit side effect.** When an agent proposes subagents or a workflow, show an orchestration card (N children, model/route, host, workspace policy, parallelism) that the user approves or edits (Warp). Show children as a **pill bar** with live badges above the parent transcript, and click to swap in place.
8. **Teach and encode "split or share"** (Conductor's decision table): a new-thread composer choice between *own jj workspace* and *same workspace as thread X* (reviewer, test-fixer). Offer **Race** (same prompt × N routes/models, compare diffs, land one) as a first-class action. DSH's multi-account routing makes racing models unusually cheap to offer.
9. **Put cost, context and route on the thread row and header, not only in a Usage page.** Conductor shows cost per workspace and a context gauge; Kiro Crew shows per-session tokens and credits; Warp shows usage per run. For DSH: the serving account and route, quota remaining, context %, and session cost, with the full usage/traces views a click away, filtered to that thread.
10. **Phone = remote control of your Host, paired by QR.** Mirror OpenCode `pair` and Conductor Remote Control: a one-shot QR link from the desktop GUI, with an explicit consent step before any non-tailnet exposure. On the phone, show only the attention inbox, the status-grouped thread list, the composer, and Stop/Land. Size it for iPhone WebKit (memory n:2).

**Bonus ideas worth stealing:** a meta-agent ("Puck") bound to a global shortcut that can find, start, steer, archive and snooze threads, using the current page as context. DSH has the tools; it lacks the always-available surface. Thread-ID trailers in jj descriptions so a revision leads back to its conversation. Feed filters encoded in the URL. An honest "not available in this view yet → open full view" list during the UI unification (Kiro), so the new shell can ship before every plugin is ported.

### Open questions / unverified

- User complaints for every product (forums not searchable here). Re-run with web search for r/conductorbuild, Paradev GitHub issues, Amp Discord and Vibe Kanban issues.
- Paradev Tasks and Usage pages, Amp agent-to-agent and the Dial, Conductor Routines and Home dashboard: not read in detail.
- Sculptor, Crystal/Nimbalyst, Factory, Jules: not covered.

memory: n:2 (iPhone WebKit constraint informed lesson 10)

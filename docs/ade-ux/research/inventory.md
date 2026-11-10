# ADE feature inventory (pre-redesign research)

Snapshot: 2026-11-04, the repository root, profile seed `profiles/web/package.json`.
Read-only research; nothing else was modified.

Method:

- `dshx.features.json` of all 88 directories under `plugins/@dshfiles/*` (339 catalog features; 66 plugins list a
  `client` surface). Feature citations below are `plugin/dshx.features.json:<line of "id">`.
- Slot registrations extracted from every non-test, non-vendored `src/` file matching `slots.register(` /
  `ui.register(` (152 registrations), plus `defineSlot`, `api.composer.registerAction`, `PaletteActions` and the dshx
  `Command` registry. Vendored native forks (`src/native/**`) were excluded, so the native-fork plugins' own
  re-declared slots are not counted as "contributions".
- `profiles/web/package.json` `dsh.profile.bundles` decides "mounted".
- Docs: `plugins/@dshfiles/workbench/docs/slot-inventory.md`, `docs/native-forks.md`, `docs/native-plugin-overrides.md`,
  `profiles/web/cordis.patch.yml`.

Caveats: the `reach` paths are the e2e catalog journeys, so they name the accessible button labels a user clicks
(e.g. `"Backlog: Items"`) but sometimes start from a fixture state. Agent-tool counts are regex approximations.
`plugins/@dshfiles/workbench/docs/slot-inventory.md` is an M0 snapshot of 2026-10-26 and is partly historical (it still calls
`pulls-review` and `traces` "repository-only", but both are now in the seed, `profiles/web/package.json`).

---

## 0. What the profile actually mounts

`profiles/web/package.json` bundles (in order): native `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`; third-party
`dshmarket` (^1.66.14, dshmarket.com community catalog bundle), `dsh-our-free-model` (GitHub pin `e9695299`, adds the
free `kilo-auto/free` model route per `docs/observability.md:331`); then **77 `@dshfiles/*` bundles**.

Not mounted (11 directories): `credential-port`, `jev`, `jj-cli`, `optmem-core`, `plugin-ui`, `project-folder-picker`,
`session-source-port`, `sqlite-store`, `vcs-provider-port` (libraries/ports bundled into other plugins), plus two
dormant features: **`resource-packs`** (has a left-nav entry and a main panel, `resource-packs/src/client.tsx:38,45`,
but is not in the profile) and **`tool-search`** (opt-in progressive tool disclosure).

Native rows replaced by owned forks (`docs/native-forks.md:14-26`): `ui-conversation`→rich-composer, `ui-chat`→chat,
`ui-layout`→frame-layout, `ui-sidebar-right`→sidebar-right, `session-controller`, `ui-model-selection`,
`ui-agent-preset`, `ui-workspace`→workspace-nav, `subprocess`→subprocess-local, `tool-goal`→goal-tool,
`ui-user-questions`; plus input-trigger, hmr-gate (`client-hmr`) and attachment-gallery (`ui-attachment`) as
slot-level replacements. `profiles/web/cordis.patch.yml` disables further native rows (native `session-query-sqlite`,
DeepSeek LLM rows, feedback rows, `session-telemetry-otel`, `session-log-deepseek`, `ui-settings-session-log`) —
lines 10-237.

Native surfaces still present beside the owned ones: the **Plugins** manager and **Schedules** main entries
(`plugins/@dshfiles/workbench/docs/slot-inventory.md:113`), native right-sidebar resources (Files, document preview, diff, terminal),
native settings sections not overridden, and the native chat/composer slots the forks keep.

---

## 1. Plugin table

Kind: **UI** = user-facing UI; **Tool** = agent-tool-only (no own UI or only a transcript card); **Infra** = runtime,
fork plumbing, library. Surfaces abbreviations: **L** left sidebar nav entry (`sidebar.panellist`), **M** main
panel/tab (`main` entry or workbench panel), **R** right sidebar/dock pane tab, **C** composer (toolbar, dock,
overlay, model seat, hero), **H** conversation header, **T** chat transcript renderer (turn tail, tool view, node,
images), **S** settings section/page (`settings.section` or a `defineSettings` page), **P** command palette entry,
**D** dialog/overlay (`shell.overlay`), **Hm** home/new-thread screen, **B** status/badge/footer, **K** keyboard
shortcut, **A** agent tools (approx. count).

| Plugin | User job (one line) | Kind | Surfaces | How a user reaches it (catalog `reach` / label) |
| --- | --- | --- | --- | --- |
| activity-timeline | Chronological feed of agent, session, communication and jj events; attention filter | UI | L, M, A5 | `"Activity Timeline: Activity"` |
| agent-communication | Browse/post passive agent-to-agent topic and direct messages | UI | L, M, A3 | `"Agent Communication: Messages"` |
| agent-preset | Pick a preset (Standard mode, …) on a draft thread (native fork) | UI | C/Hm | New thread → `"Standard mode"` |
| agent-questions | Child agent asks parent a question; Markdown feedback; cross-thread question inbox | Tool (+card layout) | T, A | via Agent Toolkit page; question card in transcript |
| agent-telemetry | GenAI OTel spans for turns, tools, model calls, cost | Infra (feeds Traces) | — | Traces tab |
| agent-toolkit | Page listing tools, plugins, MCP servers, skills, memory available to the agent | UI | L, M, P | `"Agent Toolkit: Capabilities"`, palette |
| agents | Persistent @-mentionable agents (identity, instructions, model route) | UI | L, M, D (mention preview), C (@), A5 | `"Agents: Directory"` |
| ai-accounts | Provider accounts, model routing, quota, usage history, forecast, failure recovery | UI | L×3, M×3, S (section + models footer), B (sidebar footer usage strip ×2), C (composer dock), T (turn tail ×2, turn cost, turn-error action), D, A32 | `"AI Accounts: Accounts"`, `"AI accounts usage"`, `"AI Accounts: Quota forecast"`, `"Add AI account"` |
| annotations | Pick a UI element, resolve its source, add a note to the draft | UI | C (composer action), D, S, A7 | `"Annotate an element"` |
| apply-patch | Atomic file edit tool | Tool | A | — |
| attachment-gallery | Keyboard-navigable image gallery for attachments | UI | C (attachments), T (images ×4) | click an image |
| background-jobs | Every background job of every session on one board; batch stop | UI | L, M, A5 | `"Background Jobs: Jobs"` |
| backlog | Capture/triage tasks, board, inbox, views, start thread from item | UI | L, M, D (reference preview), T (@ chip), C (@), S, P, A20 | `"Backlog: Items"` → Items/Board/Projects/Inbox |
| btw | `/btw` side chat forked from current thread | UI | R, C (input.right chip), D, P, K, slash | composer chip, palette, `/btw` |
| chat | Windowed transcript; resume/retry stopped turns (native fork) | UI (Infra fork) | T | always |
| command-palette | App-wide palette: threads, files, commands, Ask DSH | UI | D, K (`Meta+Shift+P`), P host | `Meta+Shift+P`, `"Open command palette"` |
| context-compaction | Chunked compaction backend | Infra | — | — |
| credential-port | Secret service port (library) | Infra (not mounted) | — | — |
| dialogs | App confirm/alert/prompt/select dialogs and toasts | Infra (UI primitive) | D | — |
| diff-viewed | "Viewed" marks in the native change-review tab | UI | `deliverables.review.file.actions` | native review tab |
| editor | Monaco workspace editor and file tree | UI | M (workbench panel), R ×2, S | `"Editor: Files"` via New tab |
| fff-search | Resident index for agent grep/glob | Tool | A | — |
| frame-layout | Three-column frame, persisted widths (native fork) | Infra | frame | — |
| git-worktrees | Thread isolation in git worktrees; file snapshots | Infra (+A1) | S | none (opt-in setting) |
| goal-stall-guard | Pause no-progress goals; bounded continuation | Infra | — | — |
| goal-tool | Goal tools accepting continued-form answers (native fork) | Infra | — | — |
| hmr-gate | Hot reload only when Host half matches; list waiting updates | Infra (+UI row) | Plugins page item, A1 | `"Plugins"` → `"View HMR updates"` |
| home | New-thread branding, recent threads, work to rebase | UI | Hm (hero mark + input dock), S | `"New thread"` |
| html-render | Agent-published HTML page / workspace HTML as card | Tool (+card) | T (tool view) | in transcript |
| input-trigger | `/` and `@` autocomplete engine (native fork) | UI | C (overlay), slash commands | typing `/`, `@` |
| jev | TypeSafe Jev client (library) | Infra (not mounted) | — | — |
| jj-cli | jj CLI Effect service (library) | Infra (not mounted) | — | — |
| jj-integration | One jj workspace per thread; rebase/integrate; thread integration dashboard | UI | L, M, R, H ×2, Hm (hero workspace), T (turn tail "Integrate"), D, P, S, A2 | `"JJ Integration: Thread integration"`, header `"Current thread workspace: …"`, `"Integrate into main"` |
| jujutsu | Revision graph, Source Control, previewed mutations, workspace cleanup | UI | L ×2, M ×2, R, H, C (composer dock + input dock), D, S, A5 | `"Jujutsu: Revision graph"`, `"Jujutsu: Source Control"` |
| loopback-access | Keep localhost when LAN-bound; network settings | UI (settings) | S, A2 | Settings → `"Network access"` |
| main-tabs | Browser-like tabs above main view | UI | tab strip, D, S, K (`Ctrl/Meta+Alt+T`) | `"New tab"` |
| mcp-endpoint | DSH as an MCP server for Claude Code/Codex | UI (settings) | S, A3 | Settings → `"MCP endpoint"` |
| mcp-servers | Manage MCP server configs, registry, OAuth, @-mentions | UI | L, M, C (overlay), A9 | `"MCP Servers: Servers"` |
| memory | Cross-thread digests, start block, memory tools, Memory panel | UI | L, M, D (preview), S, A18 | `"Memory: Browser"` |
| mentions | Ranked `@` menu for files and threads | UI | C | typing `@` |
| model-effort-picker | Model/effort/Fast mode picker across accounts; fallbacks | UI | C (`conversation.input.model`), S | composer `", reasoning …"` button |
| model-selection | Draft model selection (native fork) | UI | C/Hm | New thread |
| multi-host | Run threads on other machines over SSH; hosts page | UI | L, M ×2, H, C/Hm ("Run on Local" chip), P, A33 | `"Multi-host: Hosts"`, `"Run on Local"` |
| optmem-core | Memory primitives (library) | Infra (not mounted) | — | — |
| plugin-marketplace | Install plugins from Framework Hub (Settings tab) | UI | S (tab), S | palette `"Settings: Built-in plugins"` → `"Framework Hub"` |
| plugin-ui | shadcn kit (library) | Infra (not mounted) | — | — |
| policies | Binary deny rules on tool calls | Infra (+A1) | S | none in UI (settings/tools only) |
| preview | Agent headless browser; thread dev servers | UI+Tool | H (`"Dev servers and previews"`), S, A11 | header button |
| privacy-controls | Feedback/session-data sharing controls | UI (settings) | S | Settings → `"Feedback & privacy"` |
| project-checks | Trusted project actions, receipts, hook results | UI | C (overlay), Activity projection, A8 | composer option `"Project checks"` |
| project-folder-picker | Project/folder picker (library) | Infra (not mounted) | — | — |
| prompt-stash | Prompt snippet library; recent prompts | UI | C (composer action `prompt-stash-action`), A1 | composer `"Prompts"` |
| pulls-review | One scrollable diff by review scope; AI scope summaries | UI | L, M | `"pulls.review: Reviews"` |
| queue-reorder | Reorder/edit/move queued messages | UI | C (input dock), S, A1 | queued messages above composer |
| references | Attach outside dirs/git repos as read-only references | Tool | A3 | none in UI |
| request-messages | Plumbing for request-message waterfall | Infra | — | — |
| resource-packs | Typed property packs on resources | UI (not mounted) | L, M, A8 | `"Resource Packs: Resources"` |
| rich-composer | Composer + conversation (native fork): paste mentions, rename, prompt recall | UI (fork) | C, H | always |
| secret-catalog | Secret aliases browser, reveal, add, repair references | UI | L, M, T (turn tail "Set up missing secrets"), D, S | `"Secret Catalog: Secrets"` |
| send-after-upload | Send once attachment upload finishes | UI (behaviour) | C | — |
| session-controller | Lean session follow, thread-local model (native fork) | Infra (+A4) | — | — |
| session-search | Worker-owned FTS5 session index | Infra (+A1) | — | — |
| session-source-port | Port (library) | Infra (not mounted) | — | — |
| session-undo | Undo/redo last turn (conversation + files) | UI | C (input.right `"Undo last turn"`) | composer button |
| session-warming | Prompt-cache keep-alive | Infra | S | settings only |
| settings-shell | VS Code-style Settings: dialog, tab, side panel, search, release notice | UI | sidebar settings trigger, S host, M, R, D, P, B (toggle badge) | Account menu → `"Settings"`, palette `"Settings: …"` |
| shared-runtime | Shared client module copy | Infra | — | — |
| shared-streams | One EventSource per URL across tabs | Infra | — | — |
| shortcuts | Capture-phase shortcuts; rebindable command keys | Infra/UI | K (`Mod+B`, `KeyN`, `Comma`) | keyboard |
| sidebar-right | Right sidebar resources as workbench panels (native fork) | Infra (fork) | R | — |
| sqlite-store | SQLite layer (library) | Infra (not mounted) | — | — |
| subprocess-local | Subprocess backoff (native fork) | Infra | — | — |
| test-runs | Vitest results card in transcript | UI | T (tool view) | in transcript |
| thread-sidebar | Thread list/board, views, notifications, archive, mute, unread, search, header actions | UI | left sidebar root, L (Board), M, R, H ×3, C (overlay + input dock ×2), T (tool view), S, P, B, K, A21 | always (left column), `"Thread Sidebar: Board"`, `"Sidebar settings"` |
| tool-meta | Start time/duration on tool calls | UI | T, S | transcript |
| tool-search | Progressive tool disclosure | Infra (not mounted) | — | — |
| traces | Local OTLP receiver; traces, logs, metrics, service map, alerts, boards | UI | L, M, T (conversation.view "Traces"/"Requests" tabs, assistant action "Open the trace of turn"), D, S, A18 | `"Traces: Explorer"` |
| turn-summary | One-line summary under each finished turn | UI | T, S | transcript |
| tweet-context | X post context tool | Tool | A | — |
| ui-styles | Shared Tailwind sheet | Infra | — | — |
| usage | Request log, cost/token/cache/latency charts, tool & Jev analytics | UI | L, M, A8 | `"Usage: Analytics"` |
| user-questions | Question form stays closed after answer (native fork) | UI (fork) | T/C | question form |
| vcs-provider-port | VCS provider port (library) | Infra (not mounted) | — | — |
| web-search-brave | Brave as `ctx.web` provider | Infra | S | settings |
| workbench | Dockview workbench: split, float, layouts, terminals, global dock, bottom panel | UI | frame (`shell.main/left/dock/bottom`), M, R, D ×3, S | `"Pane options"`, `"New tab"` |
| workspace-folder-picker | Add/clone/create/remove projects from folder browser | UI | Hm/C (workspace picker), A4 | `"Choose workspace"` → `"Add workspace…"` |
| workspace-nav | New thread opens composer before Host session (native fork) | Infra (fork) | Hm | `"New session"` |
| worktree-memory | Process RAM by workspace, Node origins | UI | L, M, A3 | `"Worktree Memory: RAM"` |

---

## 2. Features grouped by user job

### A. Start & steer work (threads, composer, models, agents, goals)

- **Start a thread**: home screen (`home/dshx.features.json:6`), workspace-nav fork, new-thread destination and project
  picker (`jj-integration/dshx.features.json:948`), project header chat (thread-sidebar), start from backlog item
  (`backlog/dshx.features.json:1462`), prompt links (thread-sidebar), multi-host "Run on Local" chip
  (`multi-host/dshx.features.json:202`), continue in another project (`thread-sidebar/dshx.features.json:2541`),
  `/btw` side chat (`btw/dshx.features.json:6`).
- **Compose**: rich-composer (paste mentions, image refs, large paste as file, ArrowUp recall), input-trigger `/` and
  `@`, mentions (files/threads), agent/backlog/MCP/skill/thread mentions, prompt-stash, annotations element picker,
  send-after-upload, project-checks overlay, queue-reorder (reorder/edit/move queued messages).
- **Choose model & route**: model-selection fork (draft), model-effort-picker (search, effort, Fast mode, fallbacks,
  account swap), ai-accounts thread account switch, agent-preset, agents (model route per agent), session-controller
  live model catalog.
- **Steer & recover**: chat resume-interrupted / retry-failed-turn, session-undo, ai-accounts failure recovery and
  quota auto-retry, credential recovery from failed turns, goal-tool / goal-stall-guard, context-compaction,
  session-warming.
- **Delegate to agents**: agents directory, agent-communication, agent-questions (parent/child), agent-toolkit page.

### B. Parallelism & isolation

- jj thread workspaces, rebase/integrate, thread integration dashboard (jj-integration).
- git worktrees provider (git-worktrees) behind the same VCS port (`vcs-provider-port`).
- Workspace-at-revision, workspace overflow, workspace cleanup and removal (jujutsu).
- Remote hosts (multi-host): host directory, SSH runtimes, remote thread inventory, host's own UI.
- Thread dev servers & preview browser (preview); background jobs board; worktree-memory RAM board.

### C. Review & landing

- Native change-review tab + diff-viewed "viewed" marks.
- pulls-review scoped diff, AI scope summaries, batch "reviewed" marks.
- jujutsu revision graph, revision detail/diff, Source Control (describe), previewed mutations, composer context
  ("Changes since branching from main").
- jj-integration rebase / turn-end "Integrate into main".
- project-checks trusted actions + receipts; test-runs card; turn-summary; tool-meta timings.
- session-undo/redo.

### D. Awareness & attention

- Thread sidebar status: finished-turn attention, manual unread, mute/snooze, notifications per category, usage-limit
  group, interrupted-turn threads, pending host restart, client reload banner.
- Activity timeline (all agents/sessions/communication/jj; condensation; verification receipts).
- Backlog Attention Inbox (items **and threads**).
- Questions: native question forms (user-questions fork), agent-questions cross-thread inbox, thread-level
  `list_thread_questions` tools.
- Background jobs board; traces alerts; hmr-gate plugin update row; settings-shell DSH release notice; dialogs toasts.

### E. Knowledge & context

- memory (digests, start block, notes, panel, analytics), session-search (index), command-palette thread/file search,
  thread-sidebar search history, mentions, references (outside dirs), backlog (capture, links, views),
  prompt-stash, agent-toolkit (what the agent can use), resource-packs (dormant), tweet-context, web-search-brave,
  fff-search.

### F. Configuration

- settings-shell (dialog/tab/side panel/expand, search, modified settings, open config elsewhere) hosting 7
  `settings.section` contributions plus `defineSettings` pages from 27 plugins.
- ai-accounts (accounts, models, routing), mcp-servers, mcp-endpoint, secret-catalog, policies, privacy-controls,
  loopback-access (network), plugin-marketplace (+ third-party dshmarket bundle), native Plugins page, hmr-gate,
  shortcuts (rebindable keys), thread-sidebar navigation layout, main-tabs persistence, workbench layouts.

### G. Cost, usage & telemetry

- usage (request log, charts, tool & skill analytics, Jev card, OTLP metric export).
- ai-accounts (quota dashboard, usage history & pricing, quota forecast, sidebar usage strip, per-turn cost).
- traces (+ agent-telemetry spans, span cost, boards "Slow tools", metrics, alerts).
- memory analytics tab (memory cost), worktree-memory (RAM), background-jobs.

### H. Presentation infrastructure (invisible but shapes UX)

frame-layout, workbench, main-tabs, sidebar-right, dialogs, ui-styles, shared-runtime, shared-streams, shortcuts,
chat/rich-composer forks, attachment-gallery, html-render.

---

## 3. Overlaps and seams

1. **Four+ telemetry/usage/cost views of the same model calls.**
   - Cost per model call appears in `agent-telemetry` span cost (`agent-telemetry/dshx.features.json:308`), `traces`
     span cost (`traces/dshx.features.json:914`), `usage` charts (`usage/dshx.features.json:149`), `ai-accounts` usage
     history & pricing (`ai-accounts/dshx.features.json:604`), ai-accounts per-turn cost in the transcript
     (`conversation.chat.turnUsageCost`, `ai-accounts/src/client.tsx:254`) and memory's own cost analytics
     (`memory/dshx.features.json:474`).
   - Metrics twice: `usage` exports OTLP metrics (`usage/dshx.features.json:346`) that `traces` charts
     (`traces/dshx.features.json:493`).
   - Tool analytics twice: usage "Tools & Jev" (`usage/dshx.features.json:279`) vs traces Boards "Slow tools"
     (`traces/dshx.features.json:707`).
   - Per-thread views twice: traces adds "Traces" and "Requests" conversation views (`traces/src/client.tsx:63,73`)
     while usage's request log is a separate global panel (`usage/src/client.tsx:58-61`).
   - Three left-nav entries for ai-accounts alone (`ai-accounts/src/client.tsx:281,292,303`) plus two sidebar-footer
     widgets (`:224,:236,:241`) and a quota popover; usage and quota live in different plugins.
2. **Three "what happened / needs attention" feeds.** Activity timeline feed and attention condensation
   (`activity-timeline/dshx.features.json:6,105`), Backlog Attention Inbox across items *and threads*
   (`backlog/dshx.features.json:1032`) which also writes into the timeline (`:1098`), and thread-sidebar finished-turn
   attention / notifications (`thread-sidebar/dshx.features.json:1178,1230`). Project-check receipts project into the
   timeline too (`project-checks/dshx.features.json:411`).
3. **Questions split across plugins.** `user-questions` (native form fork, `user-questions/dshx.features.json:6`),
   `agent-questions` (parent/child questions + its own question card layout + cross-thread inbox,
   `agent-questions/dshx.features.json:218,244`); no single "questions waiting for me" surface — agent-questions'
   features are reached via the Agent Toolkit page.
4. **Two VCS isolation providers and two jj UIs.** `git-worktrees` (`git-worktrees/dshx.features.json:6`) vs
   `jj-integration` thread workspaces; within jj, `jj-integration` (thread integration panel `:688`, header menu
   `:415`, rebase `:462`) and `jujutsu` (graph, Source Control `:698`, workspace cleanup `:585`, removal `:641`) both
   manage workspaces, each with its own left-nav entry (`jj-integration/src/client.tsx:128`,
   `jujutsu/src/client-entry.tsx:132,135`), right pane tab (`jj-integration/src/client.tsx:167`,
   `jujutsu/src/client-entry.tsx:273`) and conversation-header utility (`jj-integration/src/client.tsx:1125,1146`,
   `jujutsu/src/client-entry.tsx:210`). Home also lists "work to rebase" (`home/dshx.features.json:6`).
5. **Two "reviewed" mechanisms.** diff-viewed marks files in the native review tab (`diff-viewed/dshx.features.json:5`,
   `diff-viewed/src/client.tsx:22`) while pulls-review keeps its own reviewed marks in a separate page
   (`pulls-review/dshx.features.json:189`); plus jujutsu revision diff — three diff viewers.
6. **Many project/workspace pickers.** New-thread picker (`jj-integration/dshx.features.json:948`), folder add flow
   (`workspace-folder-picker/dshx.features.json:6`), multi-host host chip (`multi-host/dshx.features.json:202`),
   Jujutsu "Choose repository", pulls-review "Choose project or workspace", secret-catalog "Choose a project folder…",
   backlog "Project of the new item" combobox, agents "Thread workspace" combobox — each a different control
   (some from `project-folder-picker`, others local `Command` comboboxes: `jj-integration/src/destination-bar.tsx`,
   `jj-integration/src/remote-destination.tsx`, `jujutsu/src/graph-navigation-controls.tsx`,
   `multi-host/src/destination/host-chip.tsx`, `backlog/src/project-picker.tsx`).
7. **Several model/route pickers.** model-selection fork (`model-selection/dshx.features.json:6`), model-effort-picker
   which shadows the same `conversation.input.model` slot at priority 0 (`model-effort-picker/src/client.tsx:19-20`),
   account swap (`model-effort-picker/dshx.features.json:96`) vs ai-accounts "Use this account for this thread"
   (`ai-accounts/dshx.features.json:57`), agent-preset, per-agent route in agents.
8. **Settings in many places and styles.** settings-shell alone offers a dialog, an expanded dialog, a main tab and a
   right side panel (`settings-shell/dshx.features.json:44,130,185,229`; `settings-shell/src/client.tsx:734,765`).
   Seven plugins add `settings.section`s (ai-accounts `:218`, home `:185`, loopback-access `:13`, mcp-endpoint `:11`,
   privacy-controls `:237`, settings-shell `:947`, thread-sidebar `:510`), 27 plugins add `defineSettings` pages, and
   in-panel settings live elsewhere: "Backlog settings" (`backlog/dshx.features.json:74`), "Jujutsu view settings",
   "Sidebar settings"/"Thread list settings", ai-accounts' own Settings tab, the native Plugins page
   (`"View @dshfiles/backlog"`), plugin-marketplace as a Settings tab (`plugin-marketplace/dshx.features.json:5`).
9. **Jev key setup in four places.** `backlog/dshx.features.json:74,1599`, `secret-catalog/dshx.features.json:540,598`.
10. **Search and @-reference duplication.** Palette search (`command-palette/dshx.features.json:5`) vs thread-sidebar
    search with history (`thread-sidebar/dshx.features.json:1582`); `@` sources from input-trigger
    (`input-trigger/dshx.features.json:6`), mentions (`mentions/dshx.features.json:6`), thread references
    (`thread-sidebar/dshx.features.json:2064`), skills (`:2157`), backlog (`backlog/dshx.features.json:841`), MCP
    (`mcp-servers/dshx.features.json:121`), agents (`agents/dshx.features.json:124`). Reference previews are three
    separate overlays: agents, backlog, memory (`agents/src/client-entry.tsx:132`, `backlog/src/client-entry.tsx:324`,
    `memory/src/client-entry.tsx:56`).
11. **Tabs vs dock.** main-tabs and workbench both own tab semantics (`main-tabs/dshx.features.json:6` "one tab
    semantics provider for Workbench and standalone fallback"; `workbench/dshx.features.json:365` "main tab parity").
    Right column: native sidebar-right resources, sidebar-right fork (`sidebar-right/dshx.features.json:6`),
    workbench global dock (`workbench/src/client.tsx:1106`) and bottom panel (`:1151`), plus 8 right pane tabs.
12. **Thread rename twice, thread in side panel vs btw side chat.** `rich-composer/dshx.features.json:211` and
    `thread-sidebar/dshx.features.json:2501`; open thread in side panel (`thread-sidebar/dshx.features.json:2263`) vs
    `/btw` side chat in the right panel (`btw/src/client-entry.tsx:383`).
13. **Restart/reload notices from three plugins.** hmr-gate row on Plugins page (`hmr-gate/dshx.features.json:6`),
    thread-sidebar pending host restart and client reload banner (`thread-sidebar/dshx.features.json:1915,1549`),
    settings-shell DSH release notice (`settings-shell/dshx.features.json:80`).
14. **Interrupted work surfaced twice.** thread-sidebar interrupted-turn threads
    (`thread-sidebar/dshx.features.json:2001`) vs chat resume/retry (`chat/dshx.features.json:6,35`); quota blocks in
    sidebar "Usage limit" group (`:2206`) vs ai-accounts continuations.
15. **Queue editing in two plugins.** queue-reorder (`queue-reorder/dshx.features.json:5`) vs thread-sidebar's agent
    queued-message tools (`thread-sidebar/dshx.features.json:2594`).
16. **Processes in three boards.** background-jobs (`background-jobs/dshx.features.json:6`), worktree-memory
    (`worktree-memory/dshx.features.json:6`), preview dev servers (`preview/dshx.features.json:93`).
17. **HTML previews in three places.** html-render card (`html-render/dshx.features.json:70`), annotations on preview
    (`annotations/dshx.features.json:223`), native document preview in the right sidebar.
18. **Naming collisions and inconsistent labels.** "Memory" means agent knowledge (memory) and process RAM
    (worktree-memory). Left-nav labels mix patterns: `"Backlog: Items"`, `"pulls.review: Reviews"`,
    `"Thread Sidebar: Board"`, `"JJ Integration: Thread integration"` — plugin names leak into labels.
19. **thread-sidebar is a mega-plugin** (31 catalog features, ~21 agent tools): navigation, classification,
    notifications, search, header actions, tool view, palette bridge, settings — it competes with home, palette,
    activity, backlog inbox and main-tabs for the same "where is my work" job.

---

## 4. Counts per surface (mounted profile)

| Surface | Count | Contributors |
| --- | --- | --- |
| Left sidebar nav entries (`sidebar.panellist`) | **21** owned (22 in source; resource-packs unmounted) + native Plugins, Schedules | activity-timeline, agent-communication, agent-toolkit, agents, ai-accounts ×3, background-jobs, backlog, jj-integration, jujutsu ×2, mcp-servers, memory, multi-host, pulls-review, secret-catalog, thread-sidebar Board, traces, usage, worktree-memory |
| Main panels (`main` entries) | **24** owned (+ conversation, plugins, schedules native) + workbench panels (editor, jujutsu dock, backlog) | see `plugins/@dshfiles/workbench/docs/slot-inventory.md:114` plus `pulls-review/src/client.tsx:45`, `traces/src/client.tsx:105` |
| Right sidebar pane tabs (`sidebar.right.pane.tab`) | **8** (+5 tab menu items) + native Files/doc preview/diff/terminal | btw, editor ×2, jj-integration, jujutsu, settings-shell, thread-sidebar, workbench |
| Overlays/dialogs (`shell.overlay`) | **16** from 14 plugins | agents, ai-accounts, annotations, backlog, btw, command-palette, jj-integration, jujutsu, main-tabs, memory, secret-catalog, settings-shell, traces, workbench ×3 |
| Settings sections (`settings.section`) | **7** + 3 general items + 1 models footer; **27** plugins with `defineSettings` pages | listed in §3.8 |
| Conversation header (utilities/actions/lineage) | **5 + 2 + 1** | jj-integration ×2, jujutsu, multi-host, thread-sidebar ×3, preview |
| Composer (dock 5, overlay 4, right 2, composer.dock 2, model 1, permission 1, attachments 1, composer actions 2, hero 2) | **~20** | home, jujutsu ×2, queue-reorder, thread-sidebar ×3, input-trigger, mcp-servers, project-checks, btw, session-undo, ai-accounts, model-effort-picker, rich-composer, attachment-gallery, prompt-stash, annotations, jj-integration |
| Transcript renderers (turn tail 5, turn cost 1, turn error 1, assistant actions 1, tool views 3, images 5, user text node 1, conversation views 2) | **19** | ai-accounts ×4, jj-integration, secret-catalog, turn-summary, traces ×3, html-render, test-runs, thread-sidebar, attachment-gallery ×5, backlog, tool-meta |
| Sidebar footer / badges | **4** | ai-accounts ×3 (footer actions, usage strip), settings-shell toggle badge |
| Palette contributors | command-palette (new thread, themes) + `PaletteActions` from agent-toolkit, btw, jj-integration, settings-shell (one per section), thread-sidebar + dshx `Command` registry (shortcuts `toggle-sidebar`) — dynamic, not statically enumerable | `command-palette/src/client.tsx:422,478`, `settings-shell/src/client.tsx:779`, `thread-sidebar/src/palette-bridge.ts:35` |
| Keyboard shortcuts (static) | `Mod+B`, `Mod+N`, `Mod+,` (shortcuts), `Meta+Shift+P` (palette), `Ctrl/Meta+Alt+T` (new tab), tab jumps (main-tabs), btw shortcut, ArrowUp recall; 13 plugins add their own `keydown` listeners | `shortcuts/src/client.tsx:47-77` |
| Agent tools (approx.) | ~260 across 31 plugins; largest: multi-host 33, ai-accounts 32, thread-sidebar 21, backlog 20, memory 18, traces 18 | regex over `src/` |
| Catalog features | 339 total; top: thread-sidebar 31, backlog 23, workbench 16, ai-accounts 15, jujutsu 12, traces 12, jj-integration 11, settings-shell 11 | |

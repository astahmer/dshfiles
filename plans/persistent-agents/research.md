# Persistent agents — research notes

Source: backlog item `b:119` and its handoff comment, plus the DSH/dshfiles architecture read below.
Research date: 2026-10-21.

## What the reference products do

| Feature         | Grok Bot                       | OpenAI Dots                           |
| --------------- | ------------------------------ | ------------------------------------- |
| Identity        | Name, avatar, description      | Name, avatar/character                |
| Instructions    | Role + persistent context      | Goals + ongoing instructions          |
| Memory          | Per-bot context                | Per-dot memory                        |
| Integrations    | Skills, plugins, connectors    | Plugins, connected apps               |
| Autonomy        | Routines, approval boundaries  | Scheduled tasks, action rules         |
| Collaboration   | Bot DMs, group chats           | Primarily personal agent              |
| Computer access | Shared computer                | Cloud / optional local computer       |
| Model selection | Not documented as configurable | Not exposed as a general model picker |
| Reusability     | Duplicate bot configuration    | Persistent dot configuration          |

Read as behavior, not a spec: the parts worth copying are the **persistent identity** (a
bot/dot you keep mentioning, not a prompt preset you retype), the **handle** as the entry
point, and **per-agent context** that survives threads. The parts to leave alone are the
second runtime: DSH already executes work as an ordinary Session with tools, presets, jj
isolation and memory.

## What DSH already provides (verified 2026-10-21)

| Need                     | Existing capability                                                                                                           | Where                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Run an agent             | An ordinary Session; one Agent per Session                                                                                    | `sessions.create`, `sessionController`            |
| Tool/permission profile  | Agent **presets**: `standard`, `ptc`, `minimal`, `cordis` — each a Cordis composition of tools, skills, plan mode, delegation | `dshx presets list/show`, `agentPresets` service  |
| Pick the model/account   | Model catalog grouped by provider route (one route per AI account), per-model reasoning efforts; `selectModel({sessionId,…})` | `remote.session.modelCatalog`, `dshx models list` |
| Per-thread workspace     | `@dshfiles/jj-integration` gives a new thread its own jj workspace when its scope is `all`; `Rebase` lands it                 | `plugins/@dshfiles/jj-integration`                |
| Memory                   | `memory_search`/`memory_read`/`memory_note` with project scope, a frozen start block per thread, digests per project          | `plugins/@dshfiles/memory`                        |
| Agent collaboration      | Durable inboxes and workspace topics: `dshx_comm_send`, `dshx_comm_publish`, `dshx_comm_inbox`                                | `plugins/@dshfiles/agent-communication`           |
| Scheduling               | `schedule_create` reminders (session-scoped)                                                                                  | native `tool-schedule`                            |
| Dispatch already working | Backlog “Start thread…” creates a Session with a preset, selects a model, renames it, sends the first message, links the item | `plugins/@dshfiles/backlog/src/client-entry.tsx`  |
| `@` menu                 | Any plugin registers an `@` source with scopes; backlog, skills, MCP already do                                               | `plugins/@dshfiles/input-trigger`, `mentions`     |

Verified spot-checks:

- `sessions.create({ workspaceId?, cwd?, sessionId?, agentPreset? })` — the client contract
  accepts a preset (`dsh-api-session-controller/lib/types/client/contract/sessions.d.ts`).
- `presets show standard|ptc|minimal|cordis` returns each composition; `minimal` disables
  file reads, so the preset axis really changes capabilities, not just cosmetics.
- `dshx models list` on the live Host reports provider routes such as `codex-alex2`,
  `opencode-go_mathias`, `claude_work`, each with its models and efforts.
- The backlog start-thread path already performs the whole dispatch sequence client-side.

## Gaps found (recorded in `plans/dsh-host-gaps.md`)

1. **A preset is chosen only at `sessions.create`.** No client or Host verb re-composes a live
   Session's preset, so an agent's tool profile applies to threads it starts, not to a live one.
2. **No send-time hook for plugin routing.** The `@` codec's `serialize(ref, signal)` runs at
   send but carries no Session identity, and the composer exposes no pre-send interceptor. A
   mention inside an existing thread therefore stays reference text; dispatch belongs to the
   surfaces that create a thread.
3. **No mid-thread system-prompt injection.** An agent's instructions ride the opening message
   of the thread it starts; there is no supported way to swap the system prompt of a thread
   that already ran.

## Consequences for the design

- An **agent is configuration, not a runtime**: identity + instructions + model route + preset,
  stored once on the Host, dispatched into an ordinary Session.
- One handle namespace (`@handle`) covers what the backlog note asked for: an agent pinned to an
  account/model, or the built-in `@dsh` agent that leaves the harness defaults alone. There is
  no second, raw `@model` mention type; a model is a property of an agent.
- Dispatch is reused from the existing backlog path rather than reimplemented per surface.

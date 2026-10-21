# Persistent agents — research and boundaries

Why an agent is saved configuration rather than a new kind of runtime, and which
Host limits the shape obeys. Ledger rows are in
[`plans/dsh-host-gaps.md`](../../../../plans/dsh-host-gaps.md).

## What the reference products do

| Feature         | Grok Bot                       | OpenAI Dots                     |
| --------------- | ------------------------------ | ------------------------------- |
| Identity        | Name, avatar, description      | Name, avatar/character          |
| Instructions    | Role + persistent context      | Goals + ongoing instructions    |
| Memory          | Per-bot context                | Per-dot memory                  |
| Integrations    | Skills, plugins, connectors    | Plugins, connected apps         |
| Autonomy        | Routines, approval boundaries  | Scheduled tasks, action rules   |
| Collaboration   | Bot DMs, group chats           | Primarily personal agent        |
| Computer access | Shared computer                | Cloud / optional local computer |
| Model selection | Not documented as configurable | Not exposed as a general picker |
| Reusability     | Duplicate bot configuration    | Persistent dot configuration    |

Read as behavior, not a spec. Worth copying: the persistent identity (a bot you keep
mentioning, not a prompt preset you retype), the handle as the entry point, and
per-agent context that survives threads. Worth leaving alone: the second runtime —
DSH already executes work as an ordinary Session with tools, presets, jj isolation
and memory.

## What DSH already provides (verified against 0.2.1-rc.2, 2026-10-21)

| Need                    | Existing capability                                                                                                       | Where                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Run an agent            | An ordinary Session; one Agent per Session                                                                                | `sessions.create`               |
| Tool/permission profile | Agent presets (`standard`, `ptc`, `minimal`, `cordis`), each a Cordis composition of tools, skills, plan mode, delegation | `agentPresets` service          |
| Pick the model/account  | Model catalog grouped by provider route, per-model reasoning efforts                                                      | `remote.session.modelCatalog`   |
| Per-thread workspace    | `@dshfiles/jj-integration` gives a new thread its own jj workspace when its scope is `all`; Rebase lands it               | `jj-integration`                |
| Memory                  | `memory_search`/`memory_read`/`memory_note`, project scope, a frozen start block per thread                               | `@dshfiles/memory`              |
| Agent collaboration     | Durable inboxes and workspace topics                                                                                      | `@dshfiles/agent-communication` |
| Scheduling              | `schedule_*` reminders, session-scoped and durable                                                                        | native `tool-schedule`          |
| `@` menu                | Any plugin registers an `@` source with scopes                                                                            | `@dshfiles/input-trigger`       |

## Boundaries this plugin obeys

1. **A preset is chosen only at `sessions.create`.** Nothing re-composes a live Session's preset, so an agent's tool
   profile applies to the threads it starts. Ledger row 72.
2. **No send-time hook for plugin routing.** The `@` codec's `serialize(ref, signal)` carries no Session identity and
   the composer exposes no pre-send interceptor, so a mention inside a running thread stays reference text. Dispatch
   belongs to the surfaces that create a thread. Ledger row 73.
3. **No mid-thread system-prompt injection.** Instructions and routines ride the opening message of the thread the
   agent started. Ledger row 74.
4. **Delegation has a creation gate, not a target filter.** `ctx.tools.guard` can deny `subagent`, `subagent_fork` and
   `workflow` for an agent whose `delegation.subagents` is off, but the native tools take a task and no agent target,
   so which agent a child runs as cannot be constrained. Ledger row 71.
5. **No second agent loop, tool registry or conversation store.** Dispatch is session creation plus naming plus the
   opening prompt; storage holds configuration, thread references and usage, never conversation state.

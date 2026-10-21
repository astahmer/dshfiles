# @dshfiles/agents

![Manage persistent agents](docs/screenshots/agent-registry.png)

Persistent, mentionable agents. An agent is saved configuration — identity, instructions, model
route and Agent preset — that dispatches an **ordinary DSH thread** when you mention its handle
where a thread starts.

- **One handle namespace.** `@dsh` ships built in and pins nothing, so it means “the harness
  itself”. A custom agent (`@reviewer`, `@frontend`) can pin a provider route and reasoning effort.
- **Dispatch, not a second runtime.** Starting a thread is DSH's own create → select model →
  rename → prompt sequence, with `agentPreset` from the agent; `@dshfiles/jj-integration` still
  gives the thread its workspace.
- **Instructions ride the opening message.** With no mid-thread system-prompt injection on stock
  DSH, the agent's instructions are the first part of the dispatch prompt, bounded to 4,000
  characters.
- **Where mentions mean something.** A backlog item comment whose first token is `@handle` starts
  that agent's thread for the item (the comment is recorded and the thread linked). The backlog's
  Start thread dialog also picks an agent, which replaces its account/model fields with the agent's
  preset, route and instructions. Inside a running thread the same text is a mention the Agent
  reads, because a preset and system prompt are fixed when the thread is created.
- **The `@` menu.** `@agent:` (or `@a:`) lists agents right away; a partial handle such as `@rev`
  lists matching agents beside files and threads. A plain `@` stays with files and threads.
- **A memory scope of its own.** An agent may name a memory scope (`agent:<handle>` by default). `@dshfiles/memory`
  reads it through this plugin's contract for every thread the agent started, so those threads carry the project block
  plus that scope's notes; memory keeps one store and one scope column.
- **Routines ride DSH's schedules.** An agent may carry a routine line (“Every weekday at 09:00, summarise open
  reviews.”). It is part of the opening message, which tells the thread to keep it with its own `schedule_*` tools, so
  the reminder lives in DSH's session-scoped schedule store. The panel lists the schedules that belong to the agent's
  threads and opens one. There is no scheduler, timer or delivery path in this plugin.
- **Delegation targets are enforced where a message is sent.** An agent declares whether its threads may message any
  peer, only listed handles, or nobody. `@dshfiles/agent-communication` resolves both sides through this plugin's
  contract before it stores a `dshx_comm_send`, and refuses an unlisted peer with a reason naming both handles. A
  broadcast has no single peer, so `listed` allows it and `none` refuses it. Subagent tools have no Host allowlist (see
  `plans/dsh-host-gaps.md`), so that half stays advisory.
- **Thread history is durable.** A dispatch records its Session in the agent's `threads` table, so
  the panel lists the threads an agent started (and opens one) after a Host restart, and the usage
  counters are read back from storage rather than recomputed per page load.
- **One Host contract.** `@dshfiles/agents/contract` exports the schemas, mention parsing and
  dispatch composition so the backlog links a thread with the same rules instead of restating them.

## Surfaces

| Surface              | Behavior                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agents sidebar panel | List, create, edit, enable/disable and remove agents (the built-in `@dsh` is not removable), start a thread, and open a thread the agent started. |
| `@` menu             | An `Agents` group in every composer; `@agent:` / `@a:` scopes the menu to agents. Picking inserts `@handle `.                                     |
| Agent tools          | `agents_list`, `agents_get`, `agents_threads`, `agents_save`, `agents_remove` (destructive, explicit opt-in).                                     |

## Limits

- 100 agents, 8 KB of instructions each, 32-character handles (`^[a-z][a-z0-9-]{0,31}$`).
- A handle is the identity: it cannot be renamed after creation.
- 50 threads are kept per agent, newest first; an older row is pruned on dispatch.
- Memory, routines and delegation targets are per agent (see above). Subagent delegation cannot be restricted on
  stock DSH (no per-Session policy hook); only the messaging path is enforced.
- A routine is text, not a parsed rule: the thread decides the timing with the schedule tool, so the schedule record
  stays the single source of truth and the panel reads it back from the Host's catalog.

## Development

```sh
pnpm test
pnpm typecheck
pnpm build
```

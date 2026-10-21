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
- Memory is scoped per agent (see above); routines and delegation rules are the remaining Phase 3 slices — see
  `plans/persistent-agents/README.md`.

## Development

```sh
pnpm test
pnpm typecheck
pnpm build
```

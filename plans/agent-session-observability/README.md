# Agent session observability: remaining work

Read-only visibility across authorized DSH Sessions and their workspace
context. Observation must never wake, message, or modify an inspected Session.

Shipped in `@dshfiles/agent-communication` (see its
[README](../../plugins/@dshfiles/agent-communication/README.md)):
`dshx_comm_agents` lists the caller's runtime-owned descendants,
`dshx_comm_workspace` resolves one of them to its DSH Workspace id and title,
and `dshx_comm_history` searches one live descendant's visible messages. All
three check ownership through `AgentRegistry.isOwnedBy` and return the same
generic answer for unowned ids.

## Remaining

- [ ] **History beyond live descendants.** Today only live, runtime-owned
      descendants are searchable. Anything wider follows the decision in
      [agent-session-history](../agent-session-history.md). Do not call Remote
      Session Controller methods from plugin code: they bypass transport
      authorization, and Session event reads expose transcript content, so a
      wider read needs an explicit, bounded authorization path.
- [ ] **JJ change associations.** `workspaceChanges` is a recorder summary, not
      proof of a jj workspace or revision; the opaque `workspace_topic` hash is
      neither. Find a verifiable source before associating a Session with a
      change.
- [ ] **Orchestration writes** (prompt, queue, cancel, resume, acknowledge) need
      their own authorization design; none exist.
- [ ] **Scratch verification of `dshx_comm_workspace`** on an isolated Host;
      it has unit tests only.

# Agent session observability: remaining work

Read-only visibility across authorized DSH Sessions and their workspace
context. Observation must never wake, message, or modify an inspected Session.

`@dshfiles/agent-communication` (see its
[README](../../plugins/@dshfiles/agent-communication/README.md)) keeps four
Agent tools: `dshx_comm_agents`, `dshx_comm_send`, `dshx_comm_inbox` and
`dshx_comm_ack`. `dshx_comm_agents` lists live Agents with their title, parent
Session id and relation to the caller. The earlier `dshx_comm_workspace`
(descendant → DSH Workspace id and title) and `dshx_comm_history` (bounded
visible-message search of one live descendant) were removed on purpose in
`jj:pvvuwntlzqxx` (2026-11-04): inside one parent/child tree, native
`send_message` was faster and cheaper, so the peer tools now serve only
separate top-level threads. Their models (`session-history.ts`,
`LiveAgentDirectoryModel.findOwnedLiveAgent`, `SessionCorpus.workspaceAt`)
remain in the source with their unit tests but no surface calls them.

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
- [x] ~~**Scratch verification of `dshx_comm_workspace`**~~ — superseded
      (2026-11-05): the tool no longer exists on `jj:main` (removed in
      `jj:pvvuwntlzqxx`), so there is nothing to verify. The live DSH still
      lists it only because it runs an older build. Re-adding a
      descendant-workspace lookup is a new decision for
      [agent-session-history](../agent-session-history.md), not this item.
      The agent-communication catalog entry was trimmed to the shipped tools.

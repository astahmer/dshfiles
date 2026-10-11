# DSH Agent communication

This owned DSH bundle provides durable topic channels and direct Agent inboxes. Incoming messages are passive records: arrival never adds a Session/user message, calls `Agent.followup()` or `Agent.steer()`, or replays a notification when an Agent is created. Completed turns stay completed. Priority—including `urgent`—is descriptive metadata only.

Agents in the same resolved working directory are subscribed to `workspace/<hash>` during Host startup and `agent/created`. Every Agent also has a private `inbox` for direct messages. A normal Agent execution can explicitly read its inbox with `dshx_comm_inbox`; reading records `readAt`, but only `dshx_comm_ack` hides a message from later inbox reads. Peer text is returned as quoted JSON and remains untrusted.

The Agent tools are:

- `dshx_comm_agents` and `dshx_comm_topics`
- `dshx_comm_subscribe` and `dshx_comm_unsubscribe`
- `dshx_comm_publish` and `dshx_comm_send`
- `dshx_comm_inbox` and `dshx_comm_ack`

The communication browser provides channel and direct-conversation navigation, bounded search and pagination, message context, recipient read/acknowledgement status, Agent runtime status, and a secondary diagnostics/activity view. A human can post to a channel or direct inbox; the receipt reports how many current recipients matched. Posting does not create or resume Agent work. An idle Agent is not assumed to be finished, and an Agent absent from the live registry is not assumed to be complete.

Workspace subscriptions and offline inboxes are retained rather than garbage-collected based on `idle` or absence from the live registry: those facts cannot prove a Session is stale. Message and activity retention is bounded to 30 days and 5,000 entries. Diagnostics compare active Agents' workspace topics with their stored subscriptions, so a missing subscription is visible instead of silently counted as a valid channel member.

The CLI and MCP stdio adapter use the same typed Host service:

```sh
dshx comm report --limit 20 --json
dshx comm topics --json
dshx comm mcp --principal editor
```

Persisted schema versions 1 and 2 migrate to version 3. Legacy `quiet`, `queue`, and `steer` policies are normalized to passive delivery, and notification replay state is removed. Legacy delivery options are accepted only at the compatibility boundary and never cause execution.

A report or activity-history gap is not proof of non-use. The Host bridge only reports Agents registered with DSH. Host source changes require a user-controlled restart; do not restart the live web profile as part of plugin development. See the [full communication design and activation guide](../../../tooling/dshx/docs/agent-communication.md).

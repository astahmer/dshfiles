# DSH Agent communication

This owned DSH bundle gives independent Agents durable topics and direct
inboxes. Messages default to a private inbox plus a content-free queued notice;
peer text never enters another Agent's current request automatically.

Agents in the same resolved working directory join a topic named
`workspace/<hash>`. Each Agent can opt out with `dshx_comm_unsubscribe` and can
subscribe again explicitly. Agent tools include:

- `dshx_comm_agents` and `dshx_comm_topics`
- `dshx_comm_subscribe` and `dshx_comm_unsubscribe`
- `dshx_comm_publish` and `dshx_comm_send`
- `dshx_comm_inbox` and `dshx_comm_ack`

Only a receiver can configure its delivery mode. `steer` requires an explicit
sender Session-id allowlist; only urgent messages from an allowlisted DSH Agent
use DSH's native steer API. All other active-agent notices use a queued
follow-up; quiet subscriptions get no notice. To mute direct-message notices,
subscribe to `inbox` with `delivery: quiet`; the private inbox remains available.

The CLI and MCP stdio adapter use the same typed Host service:

```sh
dshx comm topics --json
dshx comm mcp --principal editor
```

Add this package to a DSH profile as a local `link:` dependency and list it in
`dsh.profile.bundles`, then build the package and restart that DSH Host. See
the [full communication design and activation guide](../../../tooling/dshx/docs/agent-communication.md).

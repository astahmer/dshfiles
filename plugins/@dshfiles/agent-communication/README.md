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

The CLI and MCP stdio adapter use the same typed Host service. The report shows bounded activity and delivery metadata without message bodies; activity history begins when Agent tool-call recording first runs:

```sh
dshx comm report --limit 20 --json
dshx comm topics --json
dshx comm mcp --principal editor
```

The sidebar inspector shows live Agents, topics, subscriptions, bounded tool
activity, and message-recipient status. Message bodies are excluded from the
report and list; reveal is an explicit per-message action. Subscription changes,
workspace rejoin, and per-recipient acknowledgement require confirmation.
Enabling `steer` requires selecting currently live sender Agents; existing sender
IDs are intentionally not returned, so edit requires selecting the desired set
again. The inspector does not publish, send, or bulk-delete messages.

An unavailable report or empty activity history is not proof of non-use. The
Host bridge starts only after DSH supplies live Agents to the plugin.

Add this package to a DSH profile as a local `link:` dependency and list it in
`dsh.profile.bundles`, then build the package and restart that DSH Host. See
the [full communication design and activation guide](../../../tooling/dshx/docs/agent-communication.md).

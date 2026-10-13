# DSH Host gaps — features waiting on a DSH patch or upstream

BB behaviours our DSH plugins cannot reproduce because the Host (or dshx) lacks a capability. Each is a
candidate for an upstream DSH request (this repo runs stock DSH and carries no core patches) or a dshx change. The product behavior
and current workarounds are documented in each owning plugin's README.

| Feature | Plugin | Missing capability | Possible route |
|---|---|---|---|
| Link an existing thread as a child; BB auto-handoff to the parent | thread-sidebar | No API to set or change a session's parent; no first-turn event hook | Patch the session controller to expose `setParent` + a turn-lifecycle event |
| Undo a cascade archive (preserve-child-threads) | thread-sidebar | No archive event hook | Archive event on the session controller |
| Jump from a settings-search result to its section | settings-search | Settings panel's active section is private state | Expose `settings.open({ section, key })` from the settings UI |
| Highlight matching nav rows / matches on the open settings page | settings-search | Plugins cannot decorate the Settings panel DOM | Settings nav decoration slot |
| Collapse viewed files, "only unviewed" filter, auto-mark on scroll | diff-viewed | Review tab shows one file; plugins only add toolbar buttons | File-list slot / filter hook in the review tab |
| Live MCP connection health ("Connected") | mcp-servers | DSH MCP client reports no connection status | Status events from `dsh-mcp-client` |
| Legacy SSE MCP servers | mcp-servers | DSH MCP client supports stdio + Streamable HTTP only | Add SSE transport to `dsh-mcp-client` |
| "Unify branches" prefilled thread | jujutsu | No API to start a session with a prefilled prompt | Session create option `initialPrompt` |
| Edit a queued message that has attachments | queue-reorder | `QueueAction.edit` is text-only and `updateQueue` replaces the whole content | Host edit that keeps existing attachment refs and replaces only text blocks |
| ⌘, / ⌘N shortcuts | shortcuts | No service to open Settings / start a session from a plugin | Expose those actions as commands |

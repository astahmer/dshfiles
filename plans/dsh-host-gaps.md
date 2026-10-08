# DSH Host gaps — features waiting on a DSH patch or upstream

BB behaviours our DSH plugins cannot reproduce because the Host (or dshx) lacks a capability. Each is a
candidate for a local DSH patch (`tooling/dsh-core`, dshx fork) or an upstream request. Found during the
2026-10-08 plugin UI rebuild ([plugin-ui-handoff.md](plugin-ui-handoff.md)).

| Feature | Plugin | Missing capability | Possible route |
|---|---|---|---|
| Link an existing thread as a child; BB auto-handoff to the parent | thread-sidebar | No API to set or change a session's parent; no first-turn event hook | Patch the session controller to expose `setParent` + a turn-lifecycle event |
| Undo a cascade archive (preserve-child-threads) | thread-sidebar | No archive event hook | Archive event on the session controller |
| Jump from a settings-search result to its section | settings-search | Settings panel's active section is private state | Expose `settings.open({ section, key })` from the settings UI |
| Highlight matching nav rows / matches on the open settings page | settings-search | Plugins cannot decorate the Settings panel DOM | Settings nav decoration slot |
| Collapse viewed files, "only unviewed" filter, auto-mark on scroll | diff-viewed | Review tab shows one file; plugins only add toolbar buttons | File-list slot / filter hook in the review tab |
| Live MCP connection health ("Connected") | mcp-servers | DSH MCP client reports no connection status | Status events from `dsh-mcp-client` |
| Legacy SSE MCP servers | mcp-servers | DSH MCP client supports stdio + Streamable HTTP only | Add SSE transport to `dsh-mcp-client` |
| MCP preferences in DSH Settings (connect on startup, tool timeout, Registry search, OAuth client name) | mcp-servers | dshx refuses a Host with both native `Config` (server list) and a Settings namespace | Split the Host into two loader entries, or move the server list into the Settings namespace |
| Machine selector for secrets / per-machine paths | secret-catalog, ai-accounts | One Host per DSH; no remote machine registry | multi-host could provide one later |
| "Unify branches" prefilled thread | jujutsu | No API to start a session with a prefilled prompt | Session create option `initialPrompt` |
| Global "All models" composer picker | ai-accounts | No composer action slot for model choice | Composer model-picker slot |
| ⌘, / ⌘N shortcuts | shortcuts | No service to open Settings / start a session from a plugin | Expose those actions as commands |

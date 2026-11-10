# Fleet DX: t3code parity for remote machines

What shipped is documented in the
[multi-host README](../../plugins/@dshfiles/multi-host/README.md): the Hosts
page fix, Diagnose with per-hop recovery, **Update hosts** and
`multi_host_update` (sync and rebuild, restart left to the user), the core
version drift line on Hosts rows and remote thread headers, **Reconnecting…**
grace and **Hide this host**, **Open on remote host** on the exact thread, Auto
weights, same-origin project grouping, fetch-before-new-threads and
`multi_host_delegate`; the comparison with t3code is its
[table](../../plugins/@dshfiles/multi-host/README.md#compared-with-bb-and-t3code).
Remote-thread rendering (questions, approvals, terminals) belongs to
[Remote threads as real threads](../remote-thread-composer/README.md).

Backlog: b:462 (fleet update), b:482 (one thread across machines), b:184 (keep
jj in sync across hosts).

## Open

1. **Remote subagents in core tools** (b:482): the core `subagent` tool and
   `backlog_start_thread` cannot take a host, and a parent thread does not list a
   `multi_host_delegate` child among its subagents. Both are core-owned; record
   the gap in [dsh-host-gaps](../dsh-host-gaps.md) if no plugin route appears.
2. **Real SSH proof**: same-origin project grouping (`projectOrigins` over SSH)
   and **Fetch jj before new threads** are unit-tested only; run each once
   against a real SSH host.
3. **Browser proof of the version drift line** in a mirrored thread header (needs
   a second runtime on another core version).
4. **Per-hop failure on the Run on picker**: the picker still shows the
   runtime's last error, not the failed hop that Diagnose shows on the Hosts
   page.

Deliberately not done: restarting a host or updating its DSH core from here
(the user's call on that machine), rebasing a host checkout before a thread
starts, SSH password prompts, pairing codes, Tailscale routes, a cloud relay and
a mobile app.

# Multi-host design

Why multi-host federates whole DSH runtimes instead of proxying files and
processes, what that costs, and the rules the code keeps. Behavior and setup
are in the [README](../README.md); runtime evidence is in
[validation.md](validation.md).

Researched 2026-10-05 against DSH 0.2.0-rc.2 on Node 22.23.3. Candidate
projects were read as source archives at exact commits, listed in
[source-snapshots.json](source-snapshots.json); reading source is evidence of
architecture, not a boot or connectivity test.

## Decision: federate stock runtimes

Each machine runs its own stock DSH runtime with its own workspaces, Sessions,
models, plugins and credentials. This machine keeps a directory of hosts and
runtimes and reaches each one through a connector (OpenSSH, or loopback for a
second DSH here). No DSH fork, and no remote plugin adopted as the foundation.

The deciding facts about DSH:

- Filesystem and subprocess are replaceable services, but one implementation is
  mounted per context and both must describe the same execution world.
- Web workspaces resolve paths with Node `realpath`/`stat`, and Session
  membership depends on canonical cwd equality. Replacing `ctx.fs` does not
  change that.
- Owned plugins call Node `fs` directly in places (`jujutsu` mixes it with
  `ctx.subprocess`), and MCP stdio servers spawn through the MCP SDK, not the
  subprocess service. A primitive proxy leaves those running locally.
- Session create takes `workspaceId`, `cwd` and `agentPreset`; there is no
  host or runtime routing argument. Session logs live in the serving runtime.
- The native gateway already exposes named RPC and stream generations, and its
  launch-token → HttpOnly cookie handshake works through a tunnel.

So the lowest boundary that keeps every plugin, MCP server and path coherent is
the whole runtime's public gateway. Proxying is still a valid future mode (a
local agent with remote tools), but it must be a named, separate mode and is
deferred until something needs local model ownership.

| Concern                | Proxy execution world                              | Full remote runtime (chosen)                      |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------- |
| Agent and model calls  | Local                                              | Remote                                            |
| Host plugins           | Local; direct Node `fs` bypasses the proxy         | Remote, including direct Node calls               |
| Files, shell, PTY, LSP | Remote only where the provider contract is honored | Native on the selected machine                    |
| MCP stdio              | Stays local unless integrated separately           | Runs with the remote runtime's config             |
| Credentials            | Local, with explicit env forwarding                | The remote runtime's own; nothing replicated      |
| Session state          | Local, with path assumptions broken                | On the remote runtime; this side keeps references |

## Options considered

| Option                                                   | Verdict                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Adopt a remote plugin unchanged                          | Rejected. Old-generation candidates pin DSH 0.1; newer ones proxy primitives or switch one global target.                  |
| Layer over or fork a plugin                              | Rejected. It inherits private routing, custom auth and a daemon protocol to maintain.                                      |
| Extract pieces                                           | Partly: connector/daemon separation and install locking from Yan-Zero's `dsh-host` informed the design; no code was taken. |
| Fork DSH                                                 | Rejected. Only needed for one central agent dispatching tools across machines, which is a different product.               |
| Owned plugin + narrow DSHX extension over stock runtimes | **Chosen.**                                                                                                                |

Security findings in candidates that the design refuses: no host-key verifier
(aijunjiang `SshRuntime.connect()`), `StrictHostKeyChecking=no` and
`sshpass -p` in argv (ZhangFengshun), and a global API target switch shared by
concurrent clients (`ds-harness-remote`). Official DSH SSH providers exist on
upstream master but not in the installed bundle tree; installing the old
`@deepseek-ai/dsh-ssh` 0.1 package is not a way to get them.

From bb we borrowed explicit host identity, an execution association that the
UI never infers from a path, offline semantics, separate connection and runtime
lifetimes, protocol pinning, and one API shared by UI and CLI. We did not
borrow its central control plane, enrollment, provisioning or self-update.

## Rules the code keeps

- **Identity, not address.** Machine and runtime are distinct ids: one machine
  can run several profiles or DSH homes, and two runtimes may hold identical
  workspace paths and native ids. Every new connection re-checks the pinned
  runtime id, profile, home and protocol version; a different runtime behind the
  same address is refused. Never fall back to local.
- **No mutation replay.** A read that fails on a dropped connection may retry
  once on a fresh one. A mutation admitted before the reply was lost reports
  `unknown-mutation-outcome` and is never resent; only native idempotency plus
  reconciliation could make that safe.
- **Generations.** A reconnect is a new connection generation; streams, caches
  and late completions from the old one are discarded.
- **Strict SSH.** BatchMode, agent or key auth, preconfigured `known_hosts`;
  unknown or changed keys block the host. No passwords, no secrets in argv,
  settings or logs.
- **Tokens stay in memory.** The launch URL is read over SSH at connect time and
  exchanged for a cookie; it is never stored in the directory or printed.
- **Remote output is untrusted.** Paths, capability claims and transcript text
  from a host are validated and bounded. Remote plugin JS is never loaded into
  this page's origin; the host UI opens on its own loopback origin.
- **Forwarded ports bind loopback only**, and DSH's own token and
  trusted-authority checks stay in force.
- **Attaching never installs; provisioning is explicit.** Adding a host, reading
  it or starting a thread never installs or updates the remote runtime.
  Provisioning is its own verb with its own opt-in (`dryRun` plan, then one step
  per `confirm: 'next'` call or all named steps with `confirm: 'all'`), and it
  refuses what belongs to the machine's owner: fnm, Home Manager and service
  supervision come back as blocked steps, never as installs. A persistent host
  stays a service-manager concern (systemd user unit with linger, launchd or
  Nix), not a side effect of the tunnel.

The remote OS and user are trusted infrastructure: SSH encryption does not
protect secrets from that host's administrator.

## DSHX wire fix

The first proof of concept failed with `gateway/internal` ("Remote payload must
contain exactly one plain-object args field"): DSHX's platform transport sent
positional arrays, while the installed gateway takes named arguments (session
create `request`, session list `_request`, settings `ns/ops/expectedRevision`).
The transport and its WebSocket follow now send named objects shaped by the
generated `TYPERT_REMOTE` descriptors, which were read, never edited. Custom
transport adapters must follow the same wire contract.

## Reproduce the proof of concept

```sh
fnm exec --using 22.23.3 node --experimental-strip-types tooling/dshx/scripts/smoke-multi-host.mjs
fnm exec --using 22.23.3 pnpm --dir tooling/dshx --filter @dshfiles/dshx exec vitest run tests/platform-cli.spec.ts --maxWorkers=1
```

The smoke boots two stock runtimes in isolated `DSH_HOME`s on OS-assigned
loopback ports, without provider keys, and proves: no activation failures,
identical cwds keep separate Session namespaces, HTTP mutation and WebSocket
history through a real byte forwarder, a token from one runtime fails on the
other, a dropped tunnel leaves the other runtime usable without replay, and
history survives a restart on the same home. The real-SSH suite is
`scripts/smoke-multi-host-ssh.mjs` plus the package's live tests (see the
README's Checks).

## Open questions

- Does a live agent turn keep running after every browser and tunnel consumer
  disconnects, in this exact composition? Terminal retention is a separate,
  bounded policy.
- Which owned bundles belong on which machine? `secret-catalog`, account tooling
  and desktop integrations have real placement constraints.
- Rendering a remote Session natively needs isolated client contexts (uploads,
  approvals, media, terminal routing); stock DSH binds one runtime per browser
  client, hence the polled remote thread view.
- LSP waits on protocol-matching official SSH/LSP artifacts; do not build
  upstream master to get them.

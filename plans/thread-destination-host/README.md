# Thread destination bar — Host chip

Scope: the **Host** chip of the new-thread destination bar
(`[Host ▾] [Folder ▾] [Bookmark ▾] [☐ isolate] [+ folder]`). Folder, bookmark and
isolation are owned by `@dshfiles/jj-integration`; this plan only defines how they
become host-aware. Must run on **stock DSH 0.2.0-rc.2** (no core patches).

## Goal

- Blank thread shows `Local ✓ / <ssh machines> / <remote DSH instances> / Manage hosts…`.
- Picking a host retargets the Folder/Bookmark pickers to that machine's filesystem and repos.
- Submitting creates the session **on that host's DSH runtime**; the thread is reachable from the
  local UI with a host badge; never silently falls back to Local.

## Current state — `plugins/@dshfiles/multi-host` (~3.2k LOC)

- Model = **runtime federation** (plan `plans/multi-host/README.md`, option H): each host runs a full
  stock DSH runtime; local plugin attaches to it over its native gateway. No proxy fs/exec.
- `records.ts`/`store.ts`/`identity.ts`: durable host + runtime directory, pinned runtime identity
  (protocol v1, DSH 0.2.x, capabilities `workspace/session/agent`), per-profile.
- Connectors: `local.ts` (loopback forward of a tokenized launch URL), `ssh.ts` (OpenSSH, BatchMode,
  StrictHostKeyChecking=yes, `-L` tunnel), `ssh-journal.ts` (scrapes launch URL+token from remote
  **systemd journal**), `gateway.ts` (native RPC + streams, size-bounded), `loopback.ts`.
- `api.ts`: `identity, list, hostUpsert/Remove, runtimeList/Upsert/Status/Remove, workspaceOpen,
  runtimeCall (allowlisted native session RPC), sessionCursor, runtimeOpenView/CloseView`.
- `client.tsx` (765 lines): standalone "Hosts" sidebar panel in `main` slot — forms for hosts,
  runtimes, workspace path, session create, "Open native runtime view" (popup to a forwarded origin).
- Depends only on `@dshfiles/dshx` (`platform/host-api`, `platform/native-rpc`) + stock packages;
  untouched by the core-fork removal; `pnpm typecheck` passes today. **No fork-only API.**
- Validated (docs/validation.md, plans/multi-host/implementation.md): P1–P3 complete (VPS + Pi over
  SSH: sessions, PTY, MCP, agent survives tunnel loss, no mutation replay, host-key rejection).
  P4 UI partial, P5 rollout partial. LSP unsupported remotely.
- Why the UX was bad:
  1. Separate admin panel, not part of thread creation; user types raw paths/ids.
  2. Each `runtimeCall` opens a **fresh SSH tunnel** and disposes it → seconds per click.
  3. Remote thread lives in a **popup of the remote runtime's own UI** (other origin); not in local
     sidebar, no deep link to the session.
  4. Runtime discovery = journalctl scrape → Linux/systemd-only, breaks on log rotation.
  5. Remote runtime must be hand-provisioned (Node tarball + npm dsh + plugins).

## Native DSH capabilities (stock rc.2)

- No SSH/remote-machine package installed (official `ssh`, `fs-ssh`, `subprocess-ssh`,
  `sandbox-ssh` exist only on upstream master `0.2.1-alpha`). `dsh-api-remotes` = client↔host BFF
  RPC, **not** machines. `dsh-sandbox`/`dsh-subprocess`/`dsh-fs` are single-world seams (one provider
  per context) → no per-session host routing.
- `SessionCreateRequest = { workspaceId?, cwd?, sessionId?, agentPreset? }` — no host field.
- Workspace controller exposes `browse.list(path)` / `createDirectory` (DirectoryListing) → a remote
  runtime can serve its own folder picker over the gateway.
- Webserver binds `127.0.0.1` or `0.0.0.0` with no TLS/auth of its own → remote access only via SSH
  tunnel / tailnet + launch token.
- Slots: `conversation.hero.workspace`, `conversation.composer.bar|dock`, `conversation.input.left`.
- Browser client is bound to **one** runtime connection; native session/workspace caches cannot mix
  runtimes in one view. ⇒ rendering a remote thread inline needs either the remote UI (iframe/popup)
  or a local mirror. This is the hard gap.

## References

- **t3code** (`~/.references/t3code`): composer context strip = `BranchToolbar.tsx` with
  `BranchToolbarEnvironmentSelector.tsx` ("Run on", machine icon, optional "Auto balance", locked once
  thread exists), `BranchToolbarEnvModeSelector.tsx` (`local | worktree`), `BranchToolbarBranchSelector.tsx`.
  Web client holds **many environment connections at once** (`client-runtime/src/environment/
  knownEnvironment.ts`, `scoped.ts` → `ScopedThreadRef{environmentId,threadId}`, route
  `_chat.$environmentId.$threadId.tsx`). SSH = `packages/ssh/src/tunnel.ts`: desktop installs a pinned
  release archive on the remote (mkdir lock), `nohup t3 serve --host 127.0.0.1`, state in
  `~/.t3/ssh-launch/<key>`, tunnel + pairing token → bearer → WS ticket. Settings → Connections.
- **bb** (source @72279d01, see `plans/multi-host/README.md#bb-reference-architecture`): Host record
  (id, name, connected, lastSeen, protocol), enrolled daemon per machine, Environment = projectId +
  hostId + path (+ worktree); server dispatches by hostId. App.asar not inspected further.
- Lesson: both own a multi-connection client. DSH stock does not → we stay per-runtime and route.

## Design

### What a host is

`HostTarget = { kind: 'local' } | { kind: 'runtime', runtimeId }` where a runtime record (existing
multi-host directory) is reached via connector `local-url` (another DSH on this Mac, e.g. a profile),
`ssh` (machine alias → tunnel to its DSH), or `url` (tailnet/loopback DSH instance + token).
Host chip lists **runtimes**, grouped by machine; one runtime per machine is the common case.
Cloud/Remote Control entries: not offered.

### Ownership

- `multi-host` owns: directory, connections, the **Host chip** component, and a client-side
  `destination` API (`get/subscribe/set host`) exposed via dshx client→client API
  (`feat(dshx): let one plugin's Client call another plugin's API`).
- `jj-integration` owns the bar layout and Folder/Bookmark/isolation; it renders the Host chip slot
  first and reads `destination.host` to pick its data source.
- Remote side runs the **same Nix-managed profile** (multi-host + jj-integration installed) so the
  same plugin APIs exist there.

### Data flow for pickers

- Local: unchanged (direct jj-integration host API).
- Remote: jj-integration client → multi-host host API `runtimePluginCall({runtimeId, plugin:
  'jj-integration', method, input})` → pooled gateway → remote jj-integration host API.
  Folder browse → `runtimeCall` native `workspace.browse.list`. Allowlist plugin ids + methods.
- **Connection pool**: one live gateway per selected runtime (idle TTL ~5 min, generation id),
  replacing tunnel-per-call. Stale-generation results are dropped.

### Session creation & viewing

1. Submit with host≠local → `runtimeCall session.create({cwd | workspaceId})` on remote (jj
   isolation applied remotely by remote jj-integration) → `session.prompt` with composer text.
2. Local record: `ThreadRef{runtimeId, sessionId}` stored by multi-host; shown in thread-sidebar with
   host badge (thread-sidebar reads multi-host list API).
3. View: phase A open remote native UI (existing lease) in a new window/tab; phase B embed it in the
   `main` slot (iframe of forwarded origin) if the remote UI can be deep-linked to a session; phase C
   (optional) local read-only mirror via `session.page`/`sessionCursor` + composer → `session.prompt`.

### Discovery fix

Replace journal scraping with a runtime-written launch file (multi-host on the remote writes
`$DSH_HOME/plugins/multi-host/launch.json`, 0600, `{port, token, identity}`) read via
`ssh host cat`. Works on macOS/Linux, no systemd dependency. Provisioning stays in nixfiles.

## Phases (each gated)

1. **Trim + pool** — remove admin panel forms, add gateway pool, launch-file discovery.
   ✅ `pnpm test` in multi-host; two consecutive `runtimeStatus` on SSH host reuse one tunnel
   (<300 ms 2nd call); launch-file read on macOS + Linux host.
2. **Host chip (local only wired)** — chip in destination bar, menu: Local ✓, runtimes w/ status dot,
   "Manage hosts…" (settings sheet). Locked after thread created (t3code `envLocked`).
   ✅ browser: blank thread shows chip; selecting offline host shows stale state, no crash.
3. **Host-aware pickers** — `runtimePluginCall` + browse.list; jj-integration reads destination.
   ✅ selecting Pi lists Pi folders + Pi bookmarks; wrong-identity host rejected; switching host
   cancels in-flight picker queries.
4. **Remote create + open** — submit creates remote session (isolated workspace when toggled), first
   prompt delivered once, view opens remote UI. ✅ e2e on Pi: thread appears in local sidebar with
   badge; no local session created; dropped reply → "unknown outcome", no replay.
5. **Inline view** (B or C, decided after spike on deep-link/iframe).

## Delete / keep in multi-host

- Keep: `records.ts`, `store.ts`, `identity.ts`, `connectors/{gateway,local,loopback,ssh}.ts`,
  `native-rpc.ts`, `runtime-view-machine.ts`, API core (`list`, host/runtime upsert/remove/status,
  `runtimeCall`, `runtimeOpenView/CloseView`, `sessionCursor`), tests.
- Replace: `connectors/ssh-journal.ts` (+ test) → launch file.
- Delete/shrink: `client.tsx` main-slot Hosts panel + its sidebar panellist entry → small
  "Manage hosts" settings sheet; `workspaceOpen` + panel session/workspace forms (superseded by
  destination bar); `dshx.features.json` entries for removed UI.
- Plans: archive `plans/multi-host/README.md` research as-is; update `implementation.md` P4 to point
  here; drop "Machine selector" row from `plans/dsh-host-gaps.md` once phase 3 lands.

## Open questions

1. Can stock composer submit be intercepted when host≠local (slot/command hook), or does the bar need
   its own "Start on <host>" send button?
2. Does stock DSH web UI support a session deep link (URL → open session)? Decides iframe vs popup.
3. Iframe of forwarded loopback origin: cookie/launch-token + framing policy acceptable?
4. Remote plugin parity: require identical plugin set, or capability-probe per plugin and grey out
   Folder/Bookmark when remote lacks jj-integration?
5. Remote thread listing in thread-sidebar: poll remote `session.list` or only track threads created
   from here?
6. Is "Local DSH profile on same Mac" a real host case, or only SSH machines?
7. Revisit proxy mode when official `@deepseek-ai/dsh-ssh` providers ship in a 0.2.x release?

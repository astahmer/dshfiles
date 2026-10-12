# Thread workspace isolation — implementation status

Every new coding thread should receive its own Jujutsu workspace **before its
first tool runs**, or be refused rather than silently handed the shared
checkout. This page is the durable resume point; it holds status and evidence,
not design.

## Landed on the spine

| revision | contents |
|---|---|
| `68e4d85d` | `@dshfiles/jj-integration`: provisioning core, isolation resolver, `workspaceIsolation` / `integration` config, activity events |
| `28203960` | web profile seed loads `@dshfiles/jj-integration` |
| `d5a33e7a` | this page |
| `a6850401` | `Config.prefault({})` — see "Loader config" below |
| `3ef5eecb` | `plugins/pnpm-workspace.yaml`: classic virtual store, so plugin typechecks resolve one peer set |
| `d52d2c32` | exclusive writer leases, `tools/pre-execute` gate, integration guardrails |

## Exclusive ownership (part 2)

One writer per workspace, enforced where work happens:

- The workspace record carries `writerEpoch`, `writerLease` and `observers`.
  `acquireWriter` / `releaseWriter` / `transferWriter` / `heartbeatWriter` /
  `addObserver` / `removeObserver` all serialize through the existing state
  path, so there is no second registry.
- A live foreign lease is refused (`writer-held`); a lease quiet for
  `ownership.staleAfterSeconds` is reclaimed by the next caller and its holder
  **fenced** — the new epoch is ahead of the one that session remembers, and its
  writes are denied (`writer-fenced`) while it keeps read-only access as an
  observer.
- Transfers refuse a live holder unless the caller states it has stopped. The
  previous writer is fenced and kept as an observer.
- `createToolGate` runs on the core `tools/pre-execute` waterfall with the
  agent's Session id and cwd: the first caller of a free workspace takes the
  lease, the holder is admitted (heartbeat throttled to 15 s), a foreign writer
  is refused **before the tool body runs**, and a check that cannot complete
  denies. `session/disposed` releases the leases a session holds.
- Enforcement applies **only** to workspaces this plugin provisioned for a
  thread (`isolated: true`). Discovered workspaces keep today's behaviour, so no
  existing session is migrated. A workspace the guard quarantines is read-only.

## Integration (part 2)

- `integration.mode: off` refuses `submitCandidate`, `runCandidate` and
  `retryCandidate` in the service itself, not only at the tool.
- A quarantined source workspace is refused at submit (`unsafe-workspace`) and
  blocks at run without advancing the spine.
- Service events now reach `onEvent` exactly once, after the durable write.
- `integration.mode: auto` reacts to `workspace.ready` only — the explicit
  eligibility signal — and drains one `queued` candidate at a time through the
  existing store lock. A completed turn never queues or runs anything.

Canonical DSH checkout (`~/dev/dsh-core-ade-hook`, store `~/dev/dsh-core-activity-rc2`,
origin `deepseek-ai/deepseek-harness`), local revision `5d2c5a5c` on the
`0.2.0-rc.2` release merge `639ed015`:

- `packages/api/session-controller/src/workspace-resolution.ts` — the awaited
  `sessionWorkspaceResolver` contract plus `resolveSessionWorkspaceCwd`.
- `SessionCommandController.create` and `.fork` resolve the child directory
  through it, so a fork never inherits its source's writable directory.
- `Config.requireWorkspaceResolver` makes a missing resolver a refusal
  (`session/workspace-resolver-missing`) instead of a passthrough; a refusal is
  `session/workspace-refused` and never falls back to the requested directory.
- 7 host specs in `tests/commands-workspace-resolution.host.spec.ts`.

Patch artifacts: `/private/tmp/dsh-core-workspace-resolution.patch`,
`/private/tmp/dshfiles-thread-isolation.patch`.

## Configuration

```yaml
# @dshfiles/jj-integration
workspaceIsolation:
  mode: auto        # auto | manual | off   (default auto)
  directory: ~      # optional; defaults to a sibling <repo>-threads/
integration:
  mode: manual      # auto | manual | off   (default manual; off refuses coordinator runs)
ownership:
  staleAfterSeconds: 900   # a lease this quiet is reclaimable
  readOnlyTools: [...]     # what an observer may run in a workspace it does not own
requireWorkspaceResolver: false   # session-controller: true refuses a Session when no resolver is registered
```

Automation and safety are independent: turning `integration.mode` to `off`
leaves ownership enforcement and the jj guard exactly as they were.

`off` never provisions and never calls jj. `auto` provisions or refuses — a
provisioning failure never behaves like `off`.

## Loader config

The Loader hands a row with no stored config `undefined`, and a bare
`z.object` rejects that: the first scratch-profile boot failed with
`ValidationError: invalid config: Invalid input: expected object, received
undefined`. A row only receives a `config:` block once settings exist. The
plugin therefore exports `ConfigSchema = Config.prefault({})`, which applies
every inner default to `undefined`. Any owned plugin with native zod `Config`
and no seeded config needs the same treatment.

## Verified

- `@dshfiles/jj-integration`: **49/49** vitest — 8 pure ownership decisions,
  7 tool-gate cases (owner, acquire, foreign writer, transfer fencing, observer
  read-only, fail-closed, pass-through), 11 real-jj ownership/integration cases
  (contention, release authorization, stale reclaim, transfer, restart recovery,
  discovered-workspace passthrough, quarantine, `off`, spine unchanged), plus the
  part-1 cases: 20 concurrent threads,
  idempotent retry, live-`@` base refusal, unsafe-marker refusal, non-jj
  passthrough, both partial-registration refusals, and the four resolver modes),
  `tsc --noEmit` clean, `dshx build` exit 0, host bundle imports.
- Core: **7/7** new host specs; the session-controller host specs
  (`commands-create-fork`, `transport`) pass; `tsc -b tsconfig.host.json`
  exit 0.
- Guard: `node --test scripts/jj-isolation/*.test.mjs` **34/34** from the live
  tree; live `jj-isolation check` decisions refuse a foreign `@` rewrite
  (`foreign-working-copy-rewrite`), a `main` rewind, and `op restore`, and
  allow reads.
- Installed web profile composes offline: `dsh --profile web --dump-config`
  exits 0 and lists `- id: jj-integration`.
- **Second instance, scratch home (`~/.dsh-ade-verify`, port 3199)**, published
  core + this plugin: boots with **zero** entries that failed to activate.

## Not verified / blocked

1. **The running host is not guarded.** `~/.local/bin/dsh-web` (Nix store,
   applied 12:47) already prepends `~/.dsh/jj-isolation/bin` to `PATH`, but the
   live host (pid 1955) was started as `node .../dsh/lib/bin.js web` directly
   from a shell, so its `PATH` has no shim. Starting the host through
   `dsh-web` is the whole activation step.
2. **The core hook is not installed, and a package-level build is not a
   drop-in.** The global `@deepseek-ai/dsh` is the published registry build.
   A full host build of the canonical checkout was produced
   (`tsc -b tsconfig.host.json` then the root `tsdown --env.DSH_BUILD_FACE host`,
   both exit 0) and its `@deepseek-ai/dsh-api-session-controller` overlaid onto
   the published package. The overlay imports cleanly and exposes the same
   symbols, but the scratch instance then booted with
   `ui-deliverables` and `ai-accounts` pending on `sessionController`, where the
   published core boots with zero such entries. The built package also lacks the
   `lib/types/client` tree the published artifact ships. **Do not deploy the
   overlay.** A drop-in replacement needs the repo's full release build, or the
   hook has to be released upstream and the global `@deepseek-ai/dsh` upgraded.
3. **No live end-to-end run.** No thread has yet been created against the
   running host with the resolver active. That needs items 1 and 2 plus a
   restart.

## Activation (one window)

```sh
# 1. core: complete host build, then swap the package in the global store
cd ~/dev/dsh-core-ade-hook
pnpm run build:lib:host
PKG=~/.local/share/pnpm/global/v11/*/node_modules/.pnpm/@deepseek-ai+dsh-api-session-controller@0.2.0-rc.2_*/node_modules/@deepseek-ai/dsh-api-session-controller
cp -R "$PKG/lib" /private/tmp/dsh-core-lib-backup        # rollback
cp packages/api/session-controller/lib/index.js "$PKG/lib/index.js"
cp -R packages/api/session-controller/lib/types/. "$PKG/lib/types/"
cp -R packages/api/session-controller/lib/typert.host.js "$PKG/lib/"

# 2. plugin bundle + profile (already synced once; re-run after any plugin edit)
cd ~/dev/dshfiles
pnpm --dir plugins/@dshfiles/jj-integration build
pnpm profile:sync --profile web --bundle @dshfiles/jj-integration
dsh --profile web --dump-config | grep -A1 jj-integration

# 3. restart through the launcher that carries the shim
~/.local/bin/dsh-web
```

Then verify, in this order: `ps eww <pid> | grep PATH` shows the shim first;
`command -v jj` in an agent shell is the shim; a new coding thread's session
`cwd` is `<repo>-threads/<slug>-<digest>` from its first tool call; a
`jj-isolation check describe -r <foreign @>` from that shell is refused.

## Known limits

- The plugin-side resolver contract is declared structurally in
  `thread-isolation.ts` because the vendored
  `tooling/dsh-core/api-session-controller` predates the hook. After the hook
  lands, sync the vendored copy and import the real types instead.
- `manual` and `off` never provision; an existing binding still resolves, so
  turning the mode down does not move a thread back to the shared checkout.
- `integration.mode: auto` is accepted and persists, but nothing triggers
  automatic integration yet; `off` refuses coordinator-driven runs. Ownership,
  preflight and validation have to be reliable first.
- Workspace directory collision is refused rather than reused; retiring a
  workspace is still a manual `jj workspace forget`.

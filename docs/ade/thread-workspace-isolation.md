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
requireWorkspaceResolver: false   # session-controller: true refuses a Session when no resolver is registered
```

`off` never provisions and never calls jj. `auto` provisions or refuses — a
provisioning failure never behaves like `off`.

## Verified

- `@dshfiles/jj-integration`: **30/30** vitest (9 new: 20 concurrent threads,
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

## Not verified / blocked

1. **The running host is not guarded.** `~/.local/bin/dsh-web` (Nix store,
   applied 12:47) already prepends `~/.dsh/jj-isolation/bin` to `PATH`, but the
   live host (pid 1955) was started as `node .../dsh/lib/bin.js web` directly
   from a shell, so its `PATH` has no shim. Starting the host through
   `dsh-web` is the whole activation step.
2. **The core hook is not installed.** The global `@deepseek-ai/dsh` is the
   published registry build. A drop-in `@deepseek-ai/dsh-api-session-controller`
   needs the repo's full host build (Typert artifacts `lib/typert.host.js` and
   `lib/typert.remote-client.js` are produced by the root `tsdown` workspace
   pass, not by the package-local build), then the package in the global
   `.pnpm` store is replaced — or the hook is released upstream.
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

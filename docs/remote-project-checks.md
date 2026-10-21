# Remote project checks

Project Checks can run a trusted action on another machine (a **peer**) while the thread, the
working copy and every edit stay on the laptop. The peer is a cache-warm worker, not a second
checkout you have to keep in sync: each run publishes one revision, materializes it in the peer's
checker workspace, runs the action there, and proves the peer stayed on that exact revision.

The feature exists because checks, not agents, dominate the laptop's memory. Measured on
2026-10-21: a 24 GB laptop ran the GUI and every thread, while a single turbo test tree reached
2.3 GB RSS. An idle 16 GB/10-core peer ran `check:diff` in ~9 s cold and ~5 s warm.

## Configure

Remotes and execution policy live in the profile patch, next to the actions:

```yaml
- id: dshfiles-project-checks
  config:
    load:
      localMemoryFloorMb: 4096 # local joins `auto` only with this much free RAM
      remoteCooldownMs: 60000 # skip a peer that just failed for this long
    remotes:
      - id: m1
        sshTarget: m1-perso # an ssh alias from ~/.ssh/config
        gitRemote: m1 # local jj remote pointing at the peer snapshot repo
        peerRemote: origin # remote name inside the peer checker repo
        workspace: /Users/me/dev/project-check # absolute peer checker workspace
        toolchain: [mise, exec, node@22.23.3, --] # optional prefix for run/install commands
        install:
          command: [pnpm, install, --frozen-lockfile]
          whenPaths: [pnpm-lock.yaml, pnpm-workspace.yaml]
          timeoutMs: 900000
        priority: 1
        enabled: true
    actions:
      - id: checks
        label: Checks
        command: node
        args: [--run, check:green]
        root: /absolute/path/to/project
        timeoutMs: 300000
        verifyBeforeComplete: true
        execution:
          target: auto # local | remote | auto
          remote: m1 # optional pin; defaults to the highest-priority peer
          onRemoteFailure: local # local (default) or fail
```

`target`:

| Value | Behaviour |
|---|---|
| `local` | Today's behaviour; nothing leaves the machine. Default. |
| `remote` | The pinned peer, else the highest-priority enabled peer. |
| `auto` | Least busy eligible endpoint: the peer(s) while the laptop is short on free memory, the laptop too once it has headroom. Ties prefer a peer. |

`onRemoteFailure`:

- `local` (default): a peer that cannot serve the run never blocks the work. The action runs on
  the laptop, and the receipt + Activity Timeline record why (`remoteFailure` with a failure code
  and a bounded message). This is the "prints a warning, keeps working" contract.
- `fail`: the run fails with `failure: remote-failed` (or `remote-unavailable`) instead of
  falling back.

Cancellation is never converted into a local run.

## Set up a peer (once)

On the laptop, a bare repository holds snapshots and the peer checks them out from it. Neither
side is your project checkout, and nothing is pushed to `origin`.

```sh
# on the peer
git init --bare ~/.dsh/peer/project.git
jj git init ~/dev/project-check
jj -R ~/dev/project-check git remote add origin ~/.dsh/peer/project.git

# on the laptop, inside the jj repository that runs the threads
jj git remote add m1 ssh://m1-perso/Users/me/.dsh/peer/project.git
```

The peer workspace keeps its `node_modules` and build caches across revisions; the first run
installs dependencies through the configured `install.command`, and later runs install again only
when a `whenPaths` file (lockfile, workspace manifest) changed between the peer's previous
checkout and the new revision.

A toolchain prefix is how the peer gets the repository's pinned runtime, e.g. `mise exec
node@22.23.3 --` on a machine that does not use `fnm`. Without one, the peer's default `PATH`
decides the version, and checks may drift from the laptop.

## How a run works

```
laptop                                                              peer
  read @ ............................ revision R
  jj bookmark set dsh-check/<change> -r @
  jj bookmark track dsh-check/<change>@<gitRemote>
  jj git push --bookmark ... --remote <gitRemote>
                                          ssh: read @ (previous revision)
                                          ssh: jj git fetch --remote <peerRemote>
                                          ssh: jj bookmark forget <bookmark>
                                          ssh: jj edit R (immutable override)
                                          ssh: read @ == R
                                          ssh: install when tracked paths changed
                                          ssh: run action (toolchain prefix)
                                          ssh: read @ == R
  receipt { sourceRevision: R, executor: remote }
```

Details that matter:

- The snapshot ref is named per jj change id (`dsh-check/<change_id>`), so every snapshot of one
  thread overwrites the same peer ref instead of accumulating refs.
- The peer's checker repository holds no user work, so the protocol passes
  `revset-aliases."immutable_heads()"="none()"` for its own jj calls. It never touches the
  project's checkouts or bookmarks.
- The peer revision must equal the laptop revision before and after the action. A mismatch is
  reported as `peer-revision-mismatch` / `peer-source-changed`, never trusted.
- jj needs a tracked remote bookmark before it creates one (`jj bookmark track <name>@<remote>`),
  and `jj git fetch` takes `--remote` in jj 0.46. Both are encoded in the protocol rather than
  left to the operator's dotfiles.
- Install detection reads the peer revision *before* fetching: a fetch rebases the peer working
  copy onto the new snapshot, which would hide which files the check is about to change. It then
  diffs with `--from/--to`, because a rewritten change makes `-r A..B` report additions rather
  than modifications.

## Receipts and visibility

Receipts gain two additive fields:

```
executor:      { kind: 'local' } | { kind: 'remote', remoteId, sshTarget, workspace }
remoteFailure: { remoteId, code, message } | null
```

The Project Checks panel shows `Remote · m1` / `Local` and, after a fallback, `Ran locally after
m1 failed (<code>): <message>`. The Activity Timeline event carries the same summary, so an
automatic pre-completion run that fell back is visible without asking the agent.

Failure codes: `peer-snapshot-unavailable`, `peer-push-failed`, `peer-unreachable`,
`peer-timeout`, `peer-fetch-failed`, `peer-edit-failed`, `peer-revision-mismatch`,
`peer-install-failed`, `peer-source-changed`, `peer-cancelled`.

## Prove a peer works

`project-checks` ships an opt-in spike that drives the real protocol against a live peer:

```sh
cd plugins/@dshfiles/project-checks
DSH_PEER_SPIKE=1 DSH_PEER_SSH=m1-perso DSH_PEER_WORKSPACE=~/dev/checkout-check DSH_PEER_GIT_REMOTE=m1 \
  pnpm exec vitest run src/peer.m1.spike.test.ts
```

It runs a real repository check, a deliberately failing action, and an unreachable host, and prints
each duration. The offline suite (`src/peer.integration.test.ts`) drives the same protocol against
temporary local git and jj repositories, so CI needs no second machine.

## Why this shape

- **Snapshot push, not a checkout to keep in sync.** `jj git push` of one named ref preserves the
  exact commit id, so the receipt that gates turn completion still binds to the local `@`. A
  peer's own `@` never becomes truth, and nothing is pushed to `origin`.
- **Not rsync.** Copying files would need a second identity (a tree digest) because the peer would
  snapshot its own commit; jj exposes no tree-hash template, and the ignore-set would have to
  match exactly. The commit id is already that identity.
- **Not a remote thread.** A remote DSH thread runs its own profile, settings and receipts, so
  its check results cannot authorize this thread's completion.
- **Not sshfs.** Mounting the peer's disk still runs the command on the laptop, so no CPU or RAM
  moves.
- **Not CI.** CI cannot verify the working-copy revision a turn is about to complete.

## Verify

```sh
# protocol and policy (no network)
pnpm --dir plugins/@dshfiles/project-checks test

# the full protocol against real jj repos and a real bare remote, on this machine
pnpm --dir plugins/@dshfiles/project-checks exec vitest run src/peer.integration.test.ts

# the real peer, after the setup above (needs ssh access to the configured host)
DSH_PEER_SPIKE=1 pnpm --dir plugins/@dshfiles/project-checks exec vitest run src/peer.m1.spike.test.ts

# the UI journeys
pnpm run check:e2e @dshfiles/project-checks
```

Measured on 2026-10-21 with `m1-perso` (16 GB, 10 cores, jj 0.45.1, `mise node@22.23.3`):
`check:diff` 8.9 s cold (peer dependency install check included), 5.1 s warm on the same
revision, a failing action 3.7 s, an unreachable peer 1.9 s before the local fallback.

## Limits

- One action is never split across machines; distribute independent actions instead.
- No peer bootstrap from the plugin: the bare repository and checker workspace must exist.
- No bidirectional sync; a peer run publishes one snapshot and leaves the peer on it. Keeping two
  checkouts in step is a different feature (backlog `b:184`).
- The peer is trusted to run the same profile-configured command; it is not sandboxed beyond ssh
  and the action's own timeout.
- A peer running a different toolchain version can produce different results. Pin the toolchain.
- The peer's checker repository is disposable, but nothing prunes unreachable commits there yet;
  `jj util gc` on the peer reclaims them after a long run of snapshots.
- Whether a `package.json` change should also trigger the peer install is open: `whenPaths`
  starts at the lockfile and the workspace manifest.

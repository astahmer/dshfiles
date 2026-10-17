# Last Known Good (LKG) recovery

One command that always opens a working DSH, even after an agent breaks the main
installation: `dsh-recover`.

## Why

The live install has three moving parts that a bad update can break together:
the global `@deepseek-ai/dsh` package tree (patched by hand more than once), the
web profile's plugin bundles (linked straight into `~/dev/dshfiles`), and the
launcher. A profile YAML backup restores none of them. A snapshot here is a
complete runtime — core, plugin bundles, profile, launcher and recorded versions
— that resolves only inside itself.

## Store layout

```
~/.dsh-lkg/
  bin/dsh-recover          stable launcher, never inside a version
  current -> versions/<id> atomic pointer; moves only after a health check
  versions/<id>/
    manifest.json          versions, source paths, health receipts
    runtime/               the exact core tree dsh resolves, node path recorded
    roots/<n>/             each distinct plugin source layout, deps included
    profile/               web profile with every link rewritten into the snapshot
  state/recover/           writable DSH_HOME for the recovery instance
```

Copies use APFS `clonefile` (`cp -c`), so a version costs metadata only:
snapshotting the 4.1 GB live runtime took ~21 s and a few MB of disk.

## Commands

```sh
node ~/dev/dshfiles/scripts/dsh-lkg/cli.mjs snapshot [--label <text>] [--if-changed]
node ~/dev/dshfiles/scripts/dsh-lkg/cli.mjs list
node ~/dev/dshfiles/scripts/dsh-lkg/cli.mjs verify [<id>|current]
node ~/dev/dshfiles/scripts/dsh-lkg/cli.mjs reap [--keep 3]
node ~/dev/dshfiles/scripts/dsh-lkg/cli.mjs remove <id>
node ~/dev/dshfiles/scripts/dsh-lkg/cli.mjs unlock <id>
```

`snapshot` is the only way a version appears. It builds a candidate, **boots it
on its own port with its own state**, and requires three checks before `current`
moves:

| check                 | refuses when                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `node`                | the recorded interpreter is gone                                  |
| `activation`          | any entry fails to activate, **or any profile bundle is skipped** |
| `authenticated-index` | the tokenized URL never appears, or does not answer 200/303       |
| `client-boot`         | headless Chromium never sees DSH's `__DSH_BOOT_READY__` resolve, or the page shows "Failed to load plugins" |

`session-api` and `thread-load` exist because a launch URL that answers proves
the shell boots, not that the Host works: they call the same authenticated RPC
the client does, and `thread-load` creates a thread in the throwaway verify
state and loads it back, so a snapshot that serves a page but cannot answer its
own sessions API is refused rather than promoted.

`client-boot` exists because the Host can boot cleanly while every client entry
waits on a service nobody provides: that is the "Failed to load plugins" card,
and only a real browser sees it.

A bundle DSH skips (an `engines.dsh` mismatch) refuses the snapshot unless it is
named in `DSH_LKG_ALLOW_SKIPPED` (comma-separated); the launcher sets the ones
the live install already runs without.

`--if-changed` compares a fingerprint of the core version, the profile's
manifest and patch, and every linked plugin's `dist/` with the current
snapshot's, and does nothing when they match. The `dsh web` supervisor runs it
ten minutes into every run that is still up, so `current` follows the newest
installation that actually booted.

Plugins are captured with their pnpm workspace layout: every `node_modules`
from the workspace root down to `plugins/`, plus any workspace package those
link to (dshx under `tooling/`), so bare imports hoisted to the root resolve.

A failed candidate is deleted (kept as `versions/.<id>.failed` with
`DSH_LKG_KEEP_FAILED=1`) and its Host output is written to
`logs/health-<id>.log`; the previous known-good snapshot stays current. `reap` keeps the newest three plus whatever `current` points at.

## Recovery

```sh
dsh-recover              # http://127.0.0.1:3099
```

It runs only what the store holds: the recorded node, the snapshot's own core,
the snapshot's profile. It never runs code from `~/.dsh`, the repository, or the
pnpm global install — which is what makes it work when those are broken.

Every start rebuilds `~/.dsh-lkg/state/recover` from an APFS clone of the live
`~/.dsh` (accounts, credentials, plugin storage, threads; not `profiles`, `logs`,
`cache`, `runtime` or `jj-isolation`) plus the snapshot's profile, so your AI
accounts and history are there. The live home is only read; what you do during
a recovery stays in the recovery state, and the previous one is kept once as
`state/recover.prev`. `DSH_LKG_CLEAN=1` starts without live data,
`DSH_LKG_LIVE_HOME` picks another source, `DSH_LKG_HOME` another state
directory, `DSH_LKG_PORT` another port.

## Immutability

Two independent layers, because instructions are not enforcement:

1. **macOS immutable flags.** Every promoted version's payload is `chflags -R
uchg`. Writes fail with `Operation not permitted` — verified — and clearing
   the flag is an explicit operator action (`unlock`). The clones are independent
   files, so freezing a snapshot never freezes the live install.
2. **The DSH tool gate.** `jj-integration` refuses any tool call whose arguments
   name the store path, the `~/` form, or the `dsh-recover` / `dsh-lkg` commands
   — in every Session, including one whose cwd is not a registered workspace. The
   list is `ownership.protectedPaths` in settings (default `['~/.dsh-lkg']`).

`snapshot`, `reap`, `remove` and `unlock` additionally refuse to run when a DSH
Session environment is detected, unless `DSH_LKG_ADMIN=1` is set.

## Limits, stated plainly

- The tool gate matches text in tool arguments. A DSH agent cannot reach the
  store through its tools, but a process outside DSH — or a determined agent
  that sets `DSH_LKG_ADMIN=1` — is only stopped by the immutable flags.
- The verify and recovery states are thawed after cloning: the snapshot payload
  is immutable, but a state the Host runs from must not be, or the Host cannot
  maintain its own profile and the state cannot be removed.
- A snapshot captures the runtime, not your data; recovery clones the live data
  at start instead. Data written by a newer runtime is read by an older one in
  that clone, never in place.
- `clonefile` is APFS-only. On another filesystem the copy is real, and a
  snapshot then costs its full logical size (~4 GB here).

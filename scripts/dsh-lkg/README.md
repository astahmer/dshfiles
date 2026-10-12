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
node ~/dev/dshfiles/scripts/dsh-lkg/cli.mjs snapshot [--label <text>]
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

A failed candidate is deleted and the previous known-good snapshot stays
current. `reap` keeps the newest three plus whatever `current` points at.

## Recovery

```sh
dsh-recover              # http://127.0.0.1:3099
```

It reads only the store: the recorded node, the snapshot's own core, the
snapshot's profile. It never touches `~/.dsh`, the repository, or the pnpm
global install — which is what makes it work when those are broken.

The recovery instance uses `~/.dsh-lkg/state/recover` as its `DSH_HOME`. That
keeps the live OptMem database, sessions and plugin state untouched, and it means
**the recovery instance starts with no threads of its own**: it is a working DSH,
not a copy of your history. Point `DSH_LKG_HOME` elsewhere for a different state
directory, or `DSH_LKG_PORT` for a different port.

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
- A snapshot captures the runtime, not your data. Sessions and OptMem memory are
  deliberately excluded.
- `clonefile` is APFS-only. On another filesystem the copy is real, and a
  snapshot then costs its full logical size (~4 GB here).

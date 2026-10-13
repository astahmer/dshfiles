# Deployment runbook — ADE release `543db674`

Everything below is verified in disposable runtimes. **Nothing has been applied to
production.** The live controller, sessions, LKG store and OptMem database are
untouched.

## What is being deployed

| Item                 | Value                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revision             | `543db674` (`integration-spine` = `main`)                                                                                                                       |
| Runtime              | the existing global install `~/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0`                                                                            |
| Node                 | `~/.local/share/fnm/node-versions/v22.23.3/installation/bin/node`                                                                                               |
| Controller package   | `@deepseek-ai/dsh-api-session-controller@0.2.0-rc.2`                                                                                                            |
| Live controller path | `…/.pnpm/@deepseek-ai+dsh-api-session-controller@0.2.0-rc.2_17d7a38790346cf58761755423db9cf6/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js` |
| Staging area         | `~/.dsh-staging/rc-543db674/`                                                                                                                                   |
| Rollback artefact    | `~/.dsh-staging/rc-543db674/session-controller.rollback.js` — sha256 `2032cbfc5b3a3eae…`, byte-identical to the live file                                       |
| Patched artefact     | `~/.dsh-staging/rc-543db674/session-controller.patched.js` — sha256 `463e7bb927f5cda0…`                                                                         |

The launch path is `dsh` on `PATH` → `~/.local/share/pnpm/bin/dsh` → the global
install above, so patching that one file is what the next Host start selects.
Verified: `command -v dsh` resolves there.

## Why only one file

In-box bundles resolve from the **dsh installation before the profile**, so a
profile-level override cannot carry the fix. The change is confined to
`session.create` / `session.fork` in that controller: attach the workspace that
owns the **resolved** directory instead of the workspace the caller named.

## Pre-flight

```sh
STAGE=~/.dsh-staging/rc-543db674
CTRL=~/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/@deepseek-ai+dsh-api-session-controller@0.2.0-rc.2_17d7a38790346cf58761755423db9cf6/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js

shasum -a 256 "$CTRL"            # expect 2032cbfc… while unpatched
ls "$STAGE"                      # both artefacts present
dsh-lkg list                     # LKG store healthy before you start
```

## STOP

Stop the live Host **yourself** (this runbook never does it). Confirm it is down:

```sh
lsof -nP -iTCP:3080 -sTCP:LISTEN     # expect no output
```

## ACTIVATE

```sh
STAGE=~/.dsh-staging/rc-543db674
CTRL=~/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/@deepseek-ai+dsh-api-session-controller@0.2.0-rc.2_17d7a38790346cf58761755423db9cf6/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js

cp "$CTRL" "$STAGE/session-controller.pre-upgrade.js"   # fresh backup of what is live
cp "$STAGE/session-controller.patched.js" "$CTRL"
shasum -a 256 "$CTRL"                                   # expect 463e7bb9…
```

## START

Start the Host the way you normally do (`dsh-web`, or the desktop launcher).

## HEALTH CHECK

```sh
# 1. It booted and every bundle activated.
dsh --profile web --dump-config >/tmp/post-upgrade-dump.txt 2>&1
grep -c "skipping profile bundle" /tmp/post-upgrade-dump.txt    # expect 0
grep -c "did not activate" /tmp/post-upgrade-dump.txt           # expect 0

# 2. The fix is live: create a thread from the UI, then
node -e "…"   # or simply: open the app, create a thread in dshfiles
```

Acceptance in the UI: create a thread from `dshfiles`; it must appear under the
project, and `jj workspace list` must show a new `dshfiles-<hash>` workspace.

Verified behaviour with the patch (browser, isolated runtime):
`session/create` with a `workspaceId` returns `ok: true`, a distinct jj
workspace is provisioned, the Session attaches to it, and the thread appears in
the existing sidebar. A real agent turn answered `pong`.

## ROLLBACK

```sh
STAGE=~/.dsh-staging/rc-543db674
CTRL=~/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/@deepseek-ai+dsh-api-session-controller@0.2.0-rc.2_17d7a38790346cf58761755423db9cf6/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js

cp "$STAGE/session-controller.rollback.js" "$CTRL"
shasum -a 256 "$CTRL"      # expect 2032cbfc…
```

Then stop and start the Host again. This was **tested in a disposable runtime**:
restoring the artefact reproduced the original failure exactly
(`session/workspace-attach-failed`), which is the pre-upgrade state.

If the whole install is unusable, `dsh-recover` starts the last known good
snapshot independently on port 3099 with its own state, without touching
production sessions or the OptMem database.

## Known limitations at this revision

- **`@dshfiles/queue-reorder` is disabled** in the staged profile. It reads the
  `inbox` Session projection, which only the **fork** agent loop declares
  (`tooling/dsh-core/agent-loop/src/inbox.ts`); the deployed loop is the
  published one, so the plugin cannot build or run. Re-enable it only when the
  fork loop ships.
- **OptMem full mode stays disabled** — the fork agent is blocked at
  `Agent preset binding requires a scoped context`.
- The pnpm consolidation is **not** part of this release; `thread-sidebar` and
  `queue-reorder` build failures under it are separate work.
- `default` is synchronized: a clean empty child of `543db674`.

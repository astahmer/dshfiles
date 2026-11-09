# @dshfiles/subprocess-local

Owned fork of DSH's local subprocess service (`@deepseek-ai/dsh-subprocess-local`, Loader row `subprocess`). Every
shell command, terminal and background job an agent runs goes through it.

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), `packages/subprocess/subprocess-local`
- Pinned revision: tag `dsh-v0.2.1-rc.2`
- License: MIT, see [LICENSE](LICENSE)

## Why

`waitForExit` watches a managed process group until it is empty by probing `kill(-pgid, 0)` every 15 ms. On macOS
that probe walks the process table (about 2 ms), and a job an agent detaches (`nohup … &`) keeps its group alive for
hours. One such group cost the live Host 9.6 s of CPU per 70 s, slowing every request, thread creation included.

`inspectForeground` backs the terminal readiness probe, which `@deepseek-ai/dsh-terminal-bash` runs every 50 ms while a send
is active, and it refreshed teardown evidence with a whole-table `/bin/ps` fork whose result it discarded (about 40 ms of
blocked event loop on a loaded host).

## Local delta

Every other vendored file is byte-identical to the pinned revision. The whole delta is:

| File                     | Change                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `src/native/spawn.ts`    | the group-exit poll backs off from 15 ms to 500 ms; a short-lived tree is still seen at once              |
| `src/native/terminal.ts` | the readiness probe refreshes its descendant evidence at most once per second; teardown still scans fresh |
| `src/host.ts`            | new: Loader entry that mounts the native Service unchanged                                                |

The runner process the service launches is still the stock package's `@deepseek-ai/dsh-subprocess-local/runner`.

## Updating from DSH

```sh
node scripts/native-fork-diff.mjs subprocess-local --to <new-tag>
```

Copy the files it lists under `copy`, re-apply the delta to the ones under `reapplyDelta`, update the pin here and in
`native-fork.json`, then build, type-check and boot-check.

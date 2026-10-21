# DSH desktop shell: remaining work

The shell runs: it spawns the Host, loads the tokenized URL, and stops the Host
on quit, and `nix build .#desktop` produces an unsigned wrapper. How it works
and why is in [apps/desktop/README.md](../../apps/desktop/README.md).

## Remaining

| Phase | Work                                                                                                                                   | Done when                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Proof | Repeat the no-orphan check on the pinned Electron 43.6.0 (last run on 43.7.7)                                                          | No `dsh` process left after quitting the app  |
| Tests | Lifecycle test for `apps/desktop/src/host.ts` with a fake `dsh` executable: URL parsing, silent or early-exiting Host, SIGTERM→SIGKILL | Runs in `check:desktop`                       |
| 2     | Lifecycle edges: Host exits while the window is open, port taken, second window                                                        | A relaunch prompt replaces the dead window    |
| 3     | Signed macOS `.app`/`.dmg`, then a Linux `.deb`                                                                                        | A signed app launches from Finder             |
| 4     | Auto-update, only once a release channel exists                                                                                        | A published release updates a running install |

Phase 3 needs a signing identity; phase 4 is optional.

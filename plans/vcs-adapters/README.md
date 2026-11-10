# VCS adapters: jj plugins that also work with git (b:12)

Goal: every jj plugin keeps its jj naming and prefers jj wherever `.jj` exists, but runs its Host logic through a VCS
port with a jj adapter and a git adapter, so a git-only repository works too.

The landed part is documented where it lives: thread workspaces, automatic fetch and the git backend's limits in the
[jj-integration README › Git repositories](../../plugins/@dshfiles/jj-integration/README.md#git-repositories), review
scopes, saved ranges and the git browser journey in the
[pulls-review README › Git-only repositories](../../plugins/@dshfiles/pulls-review/README.md#git-only-repositories),
the shared git runner in [`@dshfiles/git-cli`](../../plugins/@dshfiles/git-cli/README.md), and `VcsDetector` in
[vcs-provider-port](../../plugins/@dshfiles/vcs-provider-port/README.md).

**Resume here:** decide whether the graph panel is worth a git adapter; add the session-undo git journey once the jj one
is green again.

## Open

| Item                         | Where          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Revision graph panel for git | `jujutsu`      | Deferred: about 13.5k lines of jj-native UI and Host (revsets, operations, workspaces, describe/split/squash/rebase actions). A git adapter needs `log --graph` parsing and a reduced action set; design before building.                                                                                                                                                                                                                                                                                    |
| Session undo journey in git  | `session-undo` | Already VCS-neutral through `vcs-provider-port`; jj-integration answers git snapshots, so only a journey is missing. A git copy of `session-undo.undo-redo-files` (a `git init` + commit project) was tried on 2026-11-10 and dropped: the jj original fails in the same scratch DSH, so a git copy could not be proven, and `startThreadWithModel` did not find the just-registered git project in the Choose a project list (check whether the picker lists a plain git checkout before writing it again). |

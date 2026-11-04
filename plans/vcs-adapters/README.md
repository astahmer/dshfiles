# VCS adapters: jj plugins that also work with git (b:12)

Goal: every jj plugin keeps its jj naming and prefers jj wherever `.jj` exists, but runs its Host logic through a VCS
port with a jj adapter and a git adapter, so a git-only repository works too.

**Resume here:** phases 1 and 2 are landed except the jujutsu graph panel, which is deferred (see below). Next: a git
browser journey for pulls-review, then decide whether the graph panel is worth a git adapter.

## Done (documented where it lives)

- Thread workspaces through a `ThreadWorkspacesBackend` port with `JjThreadWorkspaces` and `GitThreadWorkspaces`
  adapters: [jj-integration README › Git repositories](../../plugins/@dshfiles/jj-integration/README.md#git-repositories).
- Automatic fetch for git: [jj-integration README › Automatic fetch](../../plugins/@dshfiles/jj-integration/README.md#automatic-fetch).
- Review scopes and saved ranges through a `ReviewBackend` port with jj and git adapters:
  [pulls-review README › Git-only repositories](../../plugins/@dshfiles/pulls-review/README.md#git-only-repositories).
- One git runner, [`@dshfiles/git-cli`](../../plugins/@dshfiles/git-cli/README.md), used by jj-integration,
  git-worktrees and pulls-review; one path-to-VCS detector, `VcsDetector` in
  [vcs-provider-port](../../plugins/@dshfiles/vcs-provider-port/README.md).
- The priority-50 behaviour change (jj-integration claims git repositories over git-worktrees) is documented in the
  jj-integration and git-worktrees READMEs.

## Open

| Item                                 | Where                       | Notes                                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revision graph panel for git         | `jujutsu`                   | Deferred: about 13.5k lines of jj-native UI and Host (revsets, operations, workspaces, describe/split/squash/rebase actions). A git adapter needs `log --graph` parsing and a reduced action set; design before building. |
| Git browser journey for pulls-review | `tooling/dshx/e2e/features` | Covered by real-git unit tests (`tests/git-output.spec.ts`) only; a journey would open the review panel on a git-only thread workspace.                                                                                   |
| Session undo journey in git          | `session-undo`              | Already VCS-neutral through `vcs-provider-port`; jj-integration answers git snapshots, so only a journey is missing.                                                                                                      |

## Known limits of the git backends

- No spare-workspace prewarm (git worktrees check out fast enough so far; measure before adding one).
- Landing refuses uncommitted edits instead of snapshotting them (git has no working-copy commit).
- A conflict is aborted, not left in the tree; the agent resolves it by rebasing in its worktree.
- No dangling-empty-revision cleanup (git has none).
- A git review diffs from the merge base; a jj review is a two-tree diff from the bookmark.
- pulls-review failure reasons keep their jj names (`jj-missing`, `jj-failed`); the messages name git.

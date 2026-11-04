# @dshfiles/git-worktrees

Plain git repositories as a [VCS provider](../vcs-provider-port/README.md), the git counterpart of
`@dshfiles/jj-integration`. Host only; it has no screen of its own.

- **Thread isolation, opt-in.** With `isolate` on, a caller that isolates a thread (a backlog item's thread) gets a
  git worktree `<repository>-threads/thread-xxxxxx` on a new `dsh/thread-xxxxxx` branch from `HEAD`, registered as a
  DSH project. Off (the default) answers every provision with the project checkout, as before this plugin.
- **File snapshots.** `snapshot` records every tracked and untracked, non-ignored file as a commit kept under
  `refs/dsh/snapshots/`, built in a throwaway index so neither the index nor `HEAD` moves. `restore` writes those
  files back and deletes files added since; ignored files are never touched.
- A jj repository colocated with git is jj-integration's (priority 100 over 10) while that plugin is loaded.
- **Git-only repositories are jj-integration's too while it is loaded.** jj-integration's git backend claims them at
  priority 50, above this plugin's 10, because its thread worktrees can integrate (rebase onto `main` and move the
  branch). With both plugins in a profile, a backlog item's thread and session-undo snapshots in a plain git
  repository therefore go through jj-integration: isolation follows jj-integration's `isolateByDefault`, not this
  plugin's `isolate`, and threads land on `<repository>-threads/thread-xxxxxx` on a `dsh/thread-xxxxxx` branch from
  the configured bookmark rather than `HEAD`. Snapshots are the same `refs/dsh/snapshots/` commits either way. This
  plugin answers only when jj-integration is not loaded; to keep the old behaviour, remove jj-integration from the
  profile.

git runs through [`@dshfiles/git-cli`](../git-cli/README.md), the runner jj-integration shares, so every call is one
bounded, non-interactive `git <verb>` span with redacted stderr.

Agent tools: `git_thread_worktrees` (read-only list) and `git_thread_worktree_remove` (`git worktree remove`, plus the
DSH project registration; the branch stays, and `force` is needed for a worktree with uncommitted changes).

## Settings (`dshfiles-git-worktrees`)

| Key                | Default | Meaning                                                         |
| ------------------ | ------- | --------------------------------------------------------------- |
| `isolate`          | `false` | Start isolated threads in their own git worktree.               |
| `threadsDirectory` | empty   | Parent for thread worktrees; empty uses `<repository>-threads`. |

## Verify

```sh
pnpm --dir plugins/@dshfiles/git-worktrees test   # real temporary git repositories
```

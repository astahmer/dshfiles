# Thread workspaces (jj-integration)

Lets many agents work on one jj repository at once: a thread can run in its own
jj workspace beside the repository, and **Land** puts its finished work on
`main`. Works on stock DSH 0.2.0-rc.2; no core patch.

## Starting a thread

A blank thread shows a destination bar above its composer:

- **Host**: `Local`, or a machine registered with
  [`@dshfiles/multi-host`](../multi-host/README.md) (status dot, **Add host…**,
  **Manage hosts…**). With a remote host chosen, the folder, bookmark and
  workspace chips describe that host (through its own jj-integration), and the
  composer starts the thread there; see the multi-host README.
- **Folder**: a registered project, **No folder** (a scratch directory,
  `~/.dsh/no-folder`), or **Open folder…**.
- **Bookmark** (jj repositories): the bookmark the thread starts from. Picking
  one starts the thread in its own workspace at that bookmark.
- **workspace** toggle: run the thread in its own jj workspace,
  `<repository>-threads/thread-<id>`, created with `jj workspace add -r <bookmark>`.

A Session's directory is fixed once created, so each change opens a blank
thread at the new destination; the blank thread left behind is discarded with
its empty workspace. The thread sidebar's **New thread** asks this plugin first,
so `isolateByDefault` decides whether a new thread starts isolated. The thread
sidebar shows a thread workspace's sessions under its project.

## Landing

**Land** (thread header, the panel, or the `jj_thread_land` tool) runs in the
thread's own workspace, serialized per repository:

1. Abandon empty leftovers between `main` and `@`.
2. Refuse revisions described as nothing or `wip`.
3. `jj rebase -b @ -d main`; on conflict, report the files and leave `main`
   where it was.
4. `jj bookmark set main -r <tip>` (forward only; retried after a rebase if
   another writer moved `main`), then `jj new main` when `@` held work.

When Land stops on conflicts or descriptions, it queues a message asking the
thread's agent to fix them and call `jj_thread_land` again
(`askAgentToFixLanding`). Nothing is pushed.

## Cleanup

Every 10 minutes, a thread workspace whose threads are all archived and that
holds no unlanded work is removed: `jj workspace forget`, its own empty
revisions abandoned (no stray heads), its directory deleted, its registry entry
dropped. A workspace with unlanded work is never removed automatically; the
panel's **Discard with work** deletes it on request.

## Agent tools

- `jj_thread_status`: this thread's unlanded revisions and whether `main` moved.
- `jj_thread_land`: land this thread's work.

## Settings (`jj-integration`)

| Key | Default | Meaning |
|---|---|---|
| `isolateByDefault` | `false` | Initial state of the workspace toggle for new threads. |
| `bookmark` | `main` | Bookmark threads start from and Land advances. |
| `threadsDirectory` | empty | Parent for thread workspaces; empty uses `<repository>-threads`. |
| `setupCommand` | empty | Shell command run in a new thread workspace, e.g. `pnpm install --frozen-lockfile`. |
| `askAgentToFixLanding` | `true` | Hand Land problems back to the thread's agent. |
| `removeFinishedThreads` | `true` | Remove finished thread workspaces without unlanded work. |

## Limits

- jj repositories only; git worktrees are not handled yet.
- A thread workspace starts without `node_modules`; use `setupCommand`.
- Isolation is a working directory, not a sandbox: a shell command can still
  write anywhere.
- With a custom `threadsDirectory`, the thread sidebar cannot group thread
  sessions under their project.

## Verify

```sh
pnpm --dir plugins --filter @dshfiles/jj-integration test
```

The tests drive real `jj` in temporary repositories.

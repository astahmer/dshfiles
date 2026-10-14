# Thread workspaces (jj-integration)

Lets many agents work on one jj repository at once: a thread can run in its own
jj workspace beside the repository, and **Rebase** moves its finished work onto
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
thread at the new destination. Leaving an unused thread workspace keeps it as
the project's spare for that bookmark, so toggling back reuses it and its blank
Session.

**New thread never waits on jj.** The sidebar button, the palette and the
project picker open the composer at once in the project (or current) checkout,
and the destination bar then moves the blank thread to where new threads start
by default: with `isolateByDefault` on, its own workspace (the spare when there
is one, else a new one named by the client and created in the background);
with it off, the project checkout when the thread started in another thread's
workspace. The chip shows the workspace name with a spinner and Send waits
until it is ready; typing does not. Each new thread is moved at most once, so a
manual toggle sticks. The thread sidebar shows a thread workspace's sessions
under its project.

## Finding a thread workspace

The **Thread workspaces** page is available from the left panel and as a tab in
the conversation's right side panel, beside Jujutsu and other tools. Its rows
show the linked conversation titles. Choose a title to open that conversation;
**Preview** loads the latest three user/assistant text messages on demand.

## Rebasing

**Rebase** (thread header, the panel, `/rebase` in the thread composer, or the
`jj_thread_rebase` tool) runs in the thread's own workspace, serialized per
repository. The command accepts no arguments and refuses from any workspace
that is not a managed thread workspace (including a shared checkout), where
there is no safe per-thread target to rebase. Rebase is available only
after every Session in the thread has stopped running and no question is waiting
for an answer:

1. Abandon empty leftovers between `main` and `@`.
2. Refuse revisions described as nothing or `wip`.
3. `jj rebase -b @ -d main`; on conflict, report the files and leave `main`
   where it was.
4. `jj bookmark set main -r <tip>` (forward only; retried after a rebase if
   another writer moved `main`), then `jj new main` when `@` held work.

5. When `syncWorkspaceAfterLand` names a workspace (`default`, the checkout
   `dsh web` usually runs from), run `dshx checkout sync` for it in the
   background: its working copy follows the bookmark with its local edits, and
   dshx and the changed plugins are rebuilt. The panel shows the outcome, e.g.
   `default updated · 3 plugins rebuilt · restart to apply`, with **Restart**
   (the thread sidebar's restart) when a Host bundle changed; client-only
   changes arrive over HMR. Conflicts or described work the bookmark lacks
   leave that checkout untouched and are reported there instead.

When Rebase stops on conflicts or descriptions, it queues a message asking the
thread's agent to fix them and rebase again with `/rebase` or the
`jj_thread_rebase` tool (`askAgentToFixLanding`). Nothing is pushed.

## Cleanup

Every 10 minutes, a thread workspace whose threads are all archived and that
holds no revisions to rebase is removed: `jj workspace forget`, its own empty
revisions abandoned (no stray heads), its directory deleted, its registry entry
dropped. The conversation sessions stay in DSH and remain archived. A workspace
with revisions to rebase is never removed automatically; its row's More menu
offers **Remove workspace and work to rebase…** behind a confirmation that names
how many revisions will be abandoned.

Manual removal forgets the jj workspace, removes its DSH workspace registration,
and permanently deletes its folder. It does **not** archive or delete the
conversation sessions; they remain in DSH with their original archive state.
The confirmation dialog explains these effects before removal.

## Agent tools

- `jj_thread_status`: this thread's revisions not yet on the target bookmark and whether it moved.
- `jj_thread_rebase`: rebase this thread's work onto the target bookmark.

## Settings (`jj-integration`)

| Key                      | Default   | Meaning                                                                                     |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------- |
| `isolateByDefault`       | `false`   | Initial state of the workspace toggle for new threads.                                      |
| `bookmark`               | `main`    | Bookmark threads start from and Rebase advances.                                            |
| `threadsDirectory`       | empty     | Parent for thread workspaces; empty uses `<repository>-threads`.                            |
| `setupCommand`           | empty     | Shell command run in a new thread workspace, e.g. `pnpm install --frozen-lockfile`.         |
| `askAgentToFixLanding`   | `true`    | Hand Rebase problems back to the thread's agent.                                            |
| `syncWorkspaceAfterLand` | `default` | Workspace brought onto the bookmark after Rebase (`dshx checkout sync`); empty disables it. |
| `removeFinishedThreads`  | `true`    | Remove finished thread workspaces without revisions to rebase.                              |

The settings keys `askAgentToFixLanding` and `syncWorkspaceAfterLand` retain
their names for saved-settings compatibility; their descriptions and UI copy
use **Rebase**.

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

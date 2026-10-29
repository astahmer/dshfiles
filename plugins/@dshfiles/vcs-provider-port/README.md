# @dshfiles/vcs-provider-port

The Host port through which version-control plugins give DSH thread isolation and file snapshots, so a caller
never names jj or git. It lives in its own package because providers and callers both import it.

A provider is a dshx API with the shared id `vcs-provider` and the provider's own package as `owner`:

| Method      | What                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `detect`    | Whether it manages the repository holding a path; `vcs`, `priority`, repository and workspace roots.     |
| `provision` | Where a new thread starts: an isolated workspace of a DSH workspace's repository, or the checkout as is. |
| `snapshot`  | An opaque token for the files of the workspace at a path. Changes nothing.                               |
| `restore`   | Put those files back; returns a snapshot of what they were, so the restore can be reversed.              |

```ts
// provider
apis: [VcsProviders.contract('@dshfiles/git-worktrees').host({ detect, provision, snapshot, restore })]

// caller
const provider = await VcsProviders.resolve(ctx, { path, callerPackageId: '@dshfiles/backlog' })
if (provider !== undefined) await provider.client.provision({ workspaceId, isolate: true })
```

`resolve` asks every served provider and keeps the highest `priority` that claims the path; a provider whose
`detect` fails is skipped, and a path nobody claims resolves to `undefined` (keep the project checkout).

| Provider                                                  | VCS | Priority | Isolation                                    |
| --------------------------------------------------------- | --- | -------- | -------------------------------------------- |
| [`@dshfiles/jj-integration`](../jj-integration/README.md) | jj  | 100      | `thread-xxxxxx` jj workspace beside the repo |
| [`@dshfiles/git-worktrees`](../git-worktrees/README.md)   | git | 10       | git worktree, opt-in (`isolate`)             |

Callers: `@dshfiles/backlog` (an item's thread starts isolated) and `@dshfiles/session-undo` (turn snapshots).
Bundle the port in the Host entry (`host.bundleDependencies`).

# @dshfiles/vcs-provider-port

The Host port through which version-control plugins give DSH thread isolation and file snapshots, so a caller
never names jj or git. It lives in its own package because providers and callers both import it.

## Runtime distribution

`build` emits ESM and declarations into `dist/`. The root Promise API and opt-in Effect service export built JavaScript
at runtime while TypeScript consumers use source declarations. `test` builds first, runs the port tests, and checks
both public exports with ordinary Node.

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

Effect callers can import `VcsProviderService` from `@dshfiles/vcs-provider-port/effect` and use
`VcsProviderService.layer(ctx)`. Its `owners` and `resolve` operations are typed Effects; failures are represented
by `VcsProviderOwnersError` and `VcsProviderResolveError`. Keeping this API on its own subpath lets Promise-only
Host bundles avoid a runtime Effect dependency. A Host that imports this subpath must make `effect` available to its
runtime bundle. The root `VcsProviders` Promise API remains unchanged.

| Provider                                                  | VCS | Priority | Isolation                                    |
| --------------------------------------------------------- | --- | -------- | -------------------------------------------- |
| [`@dshfiles/jj-integration`](../jj-integration/README.md) | jj  | 100      | `thread-xxxxxx` jj workspace beside the repo |
| [`@dshfiles/jj-integration`](../jj-integration/README.md) | git | 50       | `thread-xxxxxx` git worktree, integrable     |
| [`@dshfiles/git-worktrees`](../git-worktrees/README.md)   | git | 10       | git worktree, opt-in (`isolate`)             |

jj-integration claims a git-only repository through its git backend, so with both loaded a git repository's threads
are jj-integration's (they can integrate); git-worktrees answers when jj-integration is not loaded.

`VcsDetector` from `@dshfiles/vcs-provider-port/detect` answers which VCS owns a path (`jj`, `git` or none) from the
nearest `.jj` or `.git`, jj first when both exist, without starting a process. It resolves symlinks before walking,
and a linked `git worktree` (a `.git` file) whose common git directory sits beside a `.jj` reads as jj: a plain
worktree of a colocated repository is never handed to a git adapter. jj-integration and pulls-review use it to pick
their jj or git adapter.

Callers: `@dshfiles/backlog` (an item's thread starts isolated) and `@dshfiles/session-undo` (turn snapshots).
Bundle the port in the Host entry (`host.bundleDependencies`).

```sh
pnpm --dir plugins/@dshfiles/vcs-provider-port build
pnpm --dir plugins/@dshfiles/vcs-provider-port test
pnpm --dir plugins/@dshfiles/vcs-provider-port typecheck
```

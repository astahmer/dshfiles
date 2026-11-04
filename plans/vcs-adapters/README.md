# VCS adapters: jj plugins that also work with git (b:12)

Goal: every jj plugin keeps its jj naming and prefers jj wherever `.jj` exists, but runs its Host logic through a VCS
port with a jj adapter and a git adapter, so a git-only repository works too.

**Resume here:** phase 1 is landed in jj-integration; start phase 2 with `pulls-review` (smallest jj surface, a pure
diff read).

## Phase 1: thread workspaces (done)

Documented in the [jj-integration README](../../plugins/@dshfiles/jj-integration/README.md#git-repositories).

- `ThreadWorkspacesBackend` port (`thread-workspace-types.ts`), Effect services `JjThreadWorkspaces` and
  `GitThreadWorkspaces`, routed per path by `ThreadWorkspaces.layer` with `VcsDetector` (nearest `.jj`/`.git`, jj
  first). Shared `ThreadMetadata` (threads directory, land records) and `GitCli` (bounded, non-interactive, `git <verb>`
  spans).
- Isolate/provision, status, list, land, verified land (Project Checks, `git cherry` guard), discard, cleanup
  (thread/secondary/untracked), restore of a deleted folder, snapshots, review history, bookmarks, revision graph text.
- Destination `vcs: 'git'` in the API and client (destination bar, remote destination); vcs-provider detect claims git
  repositories at priority 50; `dshx checkout sync` skipped for git.
- Tests: `git-thread-workspaces.integration.test.ts`, `host-git.integration.test.ts`, `vcs-detector.test.ts`,
  `git-cli.test.ts`; browser journey `jj-integration.git-destination-browser-journey`.

## Phase 2: other jj Host logic

| Item                                | Where                                        | Notes                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review scopes from git              | `pulls-review/src/jj.ts`, `review-source.ts` | `pulls_review` with `fromChangeId`/`toChangeId` requires JJ change ids; a git adapter would diff `base...HEAD` per commit. Land records already hold commit ids. |
| Automatic fetch                     | `jj-integration/src/auto-fetch.ts`           | `git fetch origin` plus fast-forward of the bookmark branch when no worktree holds it dirty.                                                                     |
| Working diff / revision graph panel | `jujutsu`                                    | The graph UI is jj-native (revsets, operations); a git adapter needs `log --graph` parsing and a reduced action set. Largest item; design before building.       |
| Session undo through the port       | `session-undo`                               | Already VCS-neutral via `vcs-provider-port`; jj-integration now answers git snapshots, so only a git journey is missing.                                         |
| Extract `GitCli`                    | `jj-integration/src/git-cli.ts`              | Move to a `@dshfiles/git-cli` library (like `jj-cli`) once a second plugin needs it; `git-worktrees` could then drop its own runner.                             |

## Known limits of the git backend

- No spare-workspace prewarm (git worktrees check out fast enough so far; measure before adding one).
- Landing refuses uncommitted edits instead of snapshotting them (git has no working-copy commit).
- A conflict is aborted, not left in the tree; the agent resolves it by rebasing in its worktree.
- No dangling-empty-revision cleanup (git has none).

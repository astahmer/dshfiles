# Project onboarding

Adding a folder, cloning a repository and starting a thread in an existing checkout all go
through one onboarding step: the Host says what the folder is, offers the action that makes the
composer's workspace controls appear, and never initializes a repository, imports a command or
moves a checkout without a click. This document records the shipped behavior, the trust
boundary and the checks that prove it.

The work was planned against [pingdotgg/t3code](https://github.com/pingdotgg/t3code) at
`v0.1.8-nightly.20261104.4179`; the t3code paths below are relative to that tag.

## Adding an existing folder

`project_inspect` (`@dshfiles/workspace-folder-picker` Host API, also an agent tool) resolves the
folder's real path and reports `kind: 'none' | 'git' | 'jujutsu'`, the repository root, origin
URL, default branch, whether the folder sits inside a checkout above it, whether `.jj` metadata
looks broken, and whether Jujutsu can be enabled. It reuses the jj repository detection the graph
uses and reads Git through the existing `ProjectCommands` subprocess service; it never writes.

The Add-workspace flow and the New-thread picker both show that step before registering:

- a Git checkout offers **Enable Jujutsu and add**, which runs the same guarded
  `jj git init --colocate` the graph uses and then adds the folder. A Git checkout also offers
  **Publish privately** / **Publish publicly** when it has no origin.
- a plain folder offers **Initialize repository** (colocated jj in place, keeping the files that
  are already there) or **Add without a repository**.
- a colocated jj repository is added directly.
- a folder with broken `.jj` metadata is reported as broken and is never repaired or replaced.

`project_register` inspects before it registers and returns that inspection; its tool description
says it never clones and never enables Jujutsu. The New-thread picker's typed path, **Register
project** button and native folder dialog open the same setup step instead of registering blind.

The composer's destination bar (`@dshfiles/jj-integration`) renders the same state for a project
that is not a jj repository: **Not a Jujutsu repository** with Enable (via the
`@dshfiles/workspace-folder-picker/repository-setup-contract` provided by `@dshfiles/jujutsu`) or
in-place init. The segment becomes the real workspace/bookmark controls without a reload.

## A checked-in project file

A repository may declare `dsh.project.json` at its root. The schema and loader live in
`@dshfiles/workspace-folder-picker/project-config`; a missing or invalid file is reported and
changes nothing, and no thread fails because of it.

| Key                      | Meaning                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `iconPath`               | Icon to show for the project                                              |
| `defaultThreadWorkspace` | `'isolated'` or `'shared'`, resolved ahead of the profile setting         |
| `bookmark`               | Bookmark a new thread workspace starts from                               |
| `checks`                 | Ids of **profile-trusted** `project-checks` actions to offer in this repo |
| `scripts`                | `{ name, command, hint }` suggestions, never executed from the file       |

Settings › Projects lists registered projects, shows the declared values with the tier that wins
for each key (project → profile → file → built-in), and offers **Copy entry** per suggested
script. The button copies the exact profile-trusted `project-checks` YAML; nothing is imported
automatically, because writing shell-running profile configuration from a repository file is the
trust boundary this feature keeps. `project_config_read` is the read-only agent tool.
`project_config_import` is deliberately not built for the same reason.

## Clone

`project_clone` clones an https, ssh, `git@` or `file:///` URL into a background job with Git's
own stages (connecting, counting, receiving, resolving, checkout), a percent, and Cancel. It
colocates jj when jj resolves, registers the folder as a project and selects it.

- A failed job shows the error and Retry; retry reuses the same destination and admission lock.
- A failure **before** Git checks files out removes the folder it created and registers nothing.
- A failure **during or after** checkout keeps the partial tree, says that retrying clears it,
  and retry removes only that incomplete checkout before starting again.
- A jj colocation failure keeps the clone and names `jj git init --colocate` as the finish.
- Closing the dialog does not hide the clone: a `shell.overlay` notice reads the same
  `project_clone_jobs` query and keeps the running or failed job's phase, Cancel and Retry on
  screen. `project_clone_jobs`, `project_clone_cancel` and `project_clone_retry` are the agent
  tools over the same Host jobs.

## Preparing a checkout before the first turn

A `project-checks` action can carry `runOnWorkspaceCreate` and `onSettle`; configuration stays
profile-trusted, so nothing from `dsh.project.json` executes. `jj-integration` asks the Host for
the setup actions that apply to a new thread workspace, dispatches them through the existing
durable task queue (one task per workspace and action, idempotent by key), publishes the run as
thread-warmup phases so the composer can show "Setting up · pnpm install" with Cancel, and can
hold the first turn until setup finishes (`awaitBeforeFirstTurn`, bounded to five minutes).
Cancellation reports `cancelled` only after the process group exits; effects before cancellation
are not undone.

## Project identity

- **Icons.** The Host resolves `iconPath` from `dsh.project.json`, then a short candidate list
  (`assets/icon.svg`, `public/favicon.svg`, `favicon.svg`, …), then a stable monogram from the
  title. The read is cached Host-side (15 minutes for an image, 1 minute for a miss) and rendered
  in the sidebar project row and the New-thread destination bar; the picker keeps its folder glyph.
- **Grouping.** The Host resolves a repository identity per folder (origin, else repository root,
  else the folder) and the sidebar groups checkouts of one repository as one row marked with its
  checkout count.
- **`No folder` promotion.** A No folder thread gets its own dated scratch folder under
  `.dsh/no-folder`. Its row menu offers **Turn into project**, which registers that folder and
  gives it a title no other project holds (`Name 2` on collision); the thread moves under its own
  project group without moving its files.
- **Cleanup.** The automatic workspace cleanup accepts `empty`, `integrated`, `untracked`,
  `secondary` and `merged` kinds; `merged` is offered only by a manual run, only when the pull
  request merged and every revision is on the target line. Settings state the protection tiers,
  and every kept workspace says why it was kept (unlanded revisions, live session, queued
  integration, recent use). A `merged` check reads pull-request links through the
  `@dshfiles/jj-integration/merged-pull-requests` contract that `@dshfiles/pull-requests`
  provides, so the integration plugin depends on no PR owner.

## Deliberately not copied

- **Multi-forge provider matrix** (GitLab, Forgejo, Bitbucket, Azure DevOps, GitCafe). Single-host
  `gh` coverage plus `project_publish` closes the onboarding loop; a forge port belongs to the
  pull-requests plan.
- **Project-controlled auto-run commands.** t3code executes `t3.json` commands on worktree
  creation; our `project-checks` only runs profile-trusted configuration, and suggestions must be
  copied into it by an operator.
- **Worktree submodules and Git dirty-file tiers.** No jj analogue; `git-worktrees` handles the
  Git-only case it can reason about.
- **Creating a project without Git identity.** Our New-project path requires jj and refuses before
  writing, naming the fix, instead of keeping a project with a `commitError`.
- **Project-first clone.** Registration still happens at the end of a clone. Gating sends while a
  clone runs would mean forking the native composer and session-controller; the retry, progress
  and outside-dialog surface cover the recoverable part without that fork.

## Verification

```sh
pnpm --dir plugins/@dshfiles/workspace-folder-picker test
pnpm --dir plugins/@dshfiles/thread-sidebar test
pnpm --dir plugins/@dshfiles/jj-integration test
pnpm --dir plugins/@dshfiles/project-checks test
node tooling/dshx/scripts/feature-coverage.mjs --check
pnpm run check:e2e workspace-folder-picker
pnpm run check:e2e jj-integration
pnpm run check:e2e thread-sidebar
pnpm run check:cycles
```

The Gherkin journeys that cover this behavior are
`workspace-folder-picker.folder-setup`, `.publish-entry`, `.clone-repository`,
`jj-integration.not-a-repository-browser-journey`, `.workspace-setup-browser-journey`,
`.project-icon-browser-journey`, and `thread-sidebar.turn-into-project`.

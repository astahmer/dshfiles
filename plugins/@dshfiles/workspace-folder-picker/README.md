# Workspace Folder Picker

![Add workspaces from the folder browser](docs/screenshots/workspace-folder-add-flow.png)

Replaces the Add workspace directory flow in the header workspace menu and the
sidebar browser with the shared `ProjectFolderPicker` opened directly in
directory-browsing mode. It also exports the same Host API for the New-thread
project chooser, whose Host may only expose the native OS picker through DSH's
global `directoryPicker` service. The API uses DSH's official browse backend in
a private Cordis context, so these flows can list and create folders without
replacing the global service or removing the native chooser from other
consumers. Absolute paths can still be submitted directly to the workspace
owner's existing registration callback.

The chooser intentionally does not show registered projects or the
"Register project" action: this entry point adds a workspace rather than
choosing one that already exists. The existing workspace-selection UI remains
unchanged.

## Clone a repository

![Clone a repository as a project](docs/screenshots/project-clone.png)

**New → Clone repository…** in the same dialog clones a Git repository
(`https://`, `ssh://`, `git@host:path` or a local `file:///` URL) into a new
folder `<parent>/<name>` on this machine. The clone runs as a background Host
job: `git clone --progress` feeds the progress bar, **Cancel clone** stops it
and deletes the partial folder, then `jj git init --colocate` runs when jj is
installed and the clone is registered as a project and selected. Closing the
dialog leaves the job running; it still registers the project when it ends.

The same jobs are agent tools: `project_clone` (URL, parent folder, folder
name), `project_clone_jobs` (read-only trail, newest first) and
`project_clone_cancel` (requires `confirm: true`). An existing destination is
refused, a second start for the same folder returns the running job, and each
clone leaves one `project clone` span with its final state and phase. Jobs live
in Host memory, so a Host restart drops the trail. `multi_host_clone_project`
stays the remote counterpart; it runs `git clone` over SSH and shares no code
with this local job beyond the idea.

## Create a new project

![Create a new project](docs/screenshots/project-create.png)

**New → New project…** creates `<parent>/<name>`, runs `jj git init
--colocate`, writes a `README.md`, commits it as `chore: initialize <name>`,
creates the `main` bookmark on that commit and registers the folder as a
project. When the GitHub CLI is installed, **Create a private GitHub
repository** also runs `gh repo create <name> --private --source . --remote
origin` and pushes `main`; the option is hidden without `gh`. An existing
folder, a missing parent or a missing jj is refused before anything is
written; a failure before registration removes the folder again, and a GitHub
failure after it keeps the project and shows the command that finishes the
job. The `project_create` agent tool takes the same inputs, with
`createGitHubRepository` required so an agent never creates a GitHub repository
by default, and `project_tools_status` reports which of git, jj and gh are
installed. Each run leaves one `project create` span.

## Runtime support

The plugin builds against the published
`@deepseek-ai/dsh-host-directory-picker-browse@0.2.0-rc.2` backend, provided by
the DSH Host through peer dependencies, and exposes it through its own
authenticated Host API. It does not depend on the unshipped `hybrid` mode or
require a DSH Core patch.

## Boundaries

- The header and sidebar workspace owners retain open/busy state and workspace
  creation.
- Add Workspace calls the official browse backend through this plugin's Host
  API. An isolated Cordis context keeps that browse capability from replacing
  the global `directoryPicker` service, so other consumers retain native picking.
- The shared picker defaults to project mode for its other consumers. This
  bundle opts into directory-only mode without duplicating the explorer UI.
- Host browsing follows the DSH process user's filesystem access; it is not
  confined to the current workspace or home directory, and symlinked directories
  remain navigable. This broader capability is enabled here only for Add Workspace.
- The Host API lists directory names only, caps each level at 1,000 directories,
  and creates a single child directory only after an explicit user action. It
  does not read file contents or restrict paths to the current workspace.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:boot
pnpm test:e2e
```

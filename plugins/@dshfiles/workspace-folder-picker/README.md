# Workspace Folder Picker

Replaces the Add workspace directory flow in the header workspace menu and the
sidebar browser with the shared `ProjectFolderPicker` opened directly in
directory-browsing mode. Its bundle configures the adaptive Host picker to use
the hybrid backend, so Add Workspace can list the Host home directory
immediately, let the operator navigate folders, and submit the selected path
to the workspace owner's existing registration callback while other flows
keep native picking available.

The chooser intentionally does not show registered projects or the
"Register project" action: this entry point adds a workspace rather than
choosing one that already exists. The existing workspace-selection UI remains
unchanged.

## Boundaries

- The header and sidebar workspace owners retain open/busy state and workspace
  creation.
- The bundle's profile patch selects the `hybrid` mode on the adaptive Host
  picker; Add Workspace uses the installed `directoryPicker` browse Remote,
  while other directory flows keep native picking and workspace registration
  remains the workspace owner's responsibility.
- The shared picker defaults to project mode for its other consumers. This
  bundle opts into directory-only mode without duplicating the explorer UI.
- Host browsing follows the DSH process user's filesystem access; it is not
  confined to the current workspace or home directory, and symlinked directories
  remain navigable. This broader capability is enabled here only for Add Workspace.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

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
- The bundle's profile patch selects the `browse` mode on the adaptive Host
  directory picker; listing and folder creation use the installed
  `directoryPicker` Remote, while creating a workspace remains the owner's
  responsibility.
- The shared picker defaults to project mode for its other consumers. This
  bundle opts into directory-only mode without duplicating the explorer UI.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

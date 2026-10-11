# Workspace Folder Picker

Replaces the Add workspace directory flow in the header workspace menu and the
sidebar browser with the shared `ProjectFolderPicker` opened directly in
directory-browsing mode. The flow starts listing the Host home directory
immediately, lets the operator navigate folders or use the Host's native
chooser, and submits the selected path to the workspace owner's existing
registration callback.

The chooser intentionally does not show registered projects or the
"Register project" action: this entry point adds a workspace rather than
choosing one that already exists. The existing workspace-selection UI remains
unchanged.

## Boundaries

- The header and sidebar workspace owners retain open/busy state and workspace
  creation.
- Host-backed directory listing, native picking, and folder creation use the
  installed `directoryPicker` Remote; creating a workspace remains the owner's
  responsibility.
- The shared picker defaults to project mode for its other consumers. This
  bundle opts into directory-only mode without duplicating the explorer UI.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

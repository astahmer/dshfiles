# Workspace Folder Picker

Replaces the Add workspace directory flow in the header workspace menu and the
sidebar browser with the shared `ProjectFolderPicker` opened directly in
directory-browsing mode. Its bundle configures the adaptive Host picker to use
the hybrid backend when available, so Add Workspace can list the Host home
directory and navigate folders. If the running Host cannot list folders, an
absolute path can still be submitted directly to the workspace owner's existing
registration callback; other flows keep native picking available.

The chooser intentionally does not show registered projects or the
"Register project" action: this entry point adds a workspace rather than
choosing one that already exists. The existing workspace-selection UI remains
unchanged.

## Runtime support

The `hybrid` picker backend is a DSH core change that stock 0.2.0-rc.2 does not
ship. Folder browsing and folder creation therefore require a Host release with
that backend. On older Hosts, operators can still enter an absolute path and
submit it directly; the workspace owner validates and canonicalizes it during
registration.

## Boundaries

- The header and sidebar workspace owners retain open/busy state and workspace
  creation.
- The bundle's profile patch selects the `hybrid` mode on the adaptive Host
  picker; Add Workspace uses the installed `directoryPicker` browse Remote when
  available, while direct path submission and workspace registration remain the
  workspace owner's responsibility.
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

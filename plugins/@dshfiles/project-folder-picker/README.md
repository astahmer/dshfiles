# Project Folder Picker

Reusable React picker for DSH clients. The package has no Host wiring of its
own; callers pass the registered workspace snapshot, the Host directory picker
port, and a workspace registration callback.

## Public component contract

```tsx
<ProjectFolderPicker
  projects={projects}
  directoryPicker={{ pick, list, createDirectory }}
  onRegisterWorkspace={registerWorkspace}
  onSelect={selection => setFolder(selection)}
  onClose={closePicker}
/>
```

Optional props: `title`, `machineName`, `placeholder`, `recentFolders`,
`disabled`, `mode`, `showNativePicker`, and `onUseAbsolutePath`. The default
`projects` mode shows registered projects and switches to browsing when the
query starts with `/` or `~/`. Home-relative paths resolve against the Host's
reported home directory. While an absolute query is not the current listing,
its direct-path action uses the workspace-registration callback, which returns
the Host-canonical path.

`directories` starts in folder browsing and hides project choices and project
registration. It offers direct path submission only when `onUseAbsolutePath` is
provided, so the caller can validate the uncanonicalized path. Set
`showNativePicker` to `false` when the injected Host backend has no native
chooser. Recent folders (previously chosen paths listed after the projects)
yield a `directory` selection.

`RegisteredProject` requires `workspaceId`, `title`, and the Host-canonical
`canonicalPath`. Selection is a discriminated union:

- `{ kind: 'workspace', workspaceId, canonicalPath, title }`
- `{ kind: 'directory', canonicalPath, title }`

The component filters registered projects by title/path, enters path browsing
when the query starts with `/` or `~/`, and supports arrows, Enter, and
Command/Ctrl+1–9. An absolute path can also be submitted without browsing: project
mode uses the workspace-registration callback, and directory mode calls the
opt-in `onUseAbsolutePath` callback. The callback owner must validate and
canonicalize that raw path. Escape, mask click, focus trapping, and return focus
come from the Host `Modal` it renders in headless mode. Folder browsing, OS
picking, folder creation, and project registration are injected ports, so a
consumer can replace them in tests or reuse this UI from another DSH plugin
without importing Secret Catalog code.

## Marketplace decision

The catalog search found `WenhongPan/dsh-projects`, a complete project and
session organization plugin with project picking as one part of its UI. It does
not publish a standalone picker component or stable component contract, so it
was not adopted or forked. This package is a small shared component built for
the local DSH plugin set; its Secret Catalog adapter calls the installed rc.2
`remote.directoryPicker` and `remote.workspace.create` APIs.

The component's only DSH import is the Host platform module
`@deepseek-ai/dsh-client-ui-primitives` (its `Modal`, `Button`, `Input`, and
keycaps), which the consuming bundle leaves external; every Host operation
still arrives as an injected port. The consuming Secret Catalog package pins
the rc.2 workspace-controller peer contract. DSH refusals are surfaced to the user; the adapter does not
approximate an unavailable Host operation.

## Why this is not in the web profile

Every other package under `plugins/@dshfiles/` is a bundle: it has a
`dshx.config.ts`, a `cordis.patch.yml`, and an entry in the profile's
`dsh.profile.bundles`. This one has none of those, deliberately. `dshx build`
refuses it with `DSHX4006: No Host or Client entry is enabled for this project`,
and that refusal is correct — adding it to a profile would fail the boot, not
extend it.

A bundle registers Slots and Host services; this package only exports a React
component. It has no Host wiring of its own because every capability it needs
arrives as an injected port, which is what lets Secret Catalog swap the real
`remote.directoryPicker` in and a test swap a fake in.

The distinction that matters when adding a package to a profile: a bundle has a
`dsh` block in its `package.json`, a library does not. Me reads for that, not for
a plugin-shaped directory name.

Secret Catalog is the consumer, and it declares the dependency with
`link:../project-folder-picker`, the same relative form every sibling uses,
because pnpm resolves `link:` from the workspace root rather than from the
depending package.

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

`RegisteredProject` requires `workspaceId`, `title`, and the Host-canonical
`canonicalPath`. Selection is a discriminated union:

- `{ kind: 'workspace', workspaceId, canonicalPath, title }`
- `{ kind: 'directory', canonicalPath, title }`

The component filters registered projects by title/path, enters path browsing
when the query starts with `/`, and supports arrows, Enter, Escape, and
Command/Ctrl+1–9. Folder browsing, OS picking, folder creation, and project
registration are injected ports, so a consumer can replace them in tests or
reuse this UI from another DSH plugin without importing Secret Catalog code.

## Marketplace decision

The catalog search found `WenhongPan/dsh-projects`, a complete project and
session organization plugin with project picking as one part of its UI. It does
not publish a standalone picker component or stable component contract, so it
was not adopted or forked. This package is a small shared component built for
the local DSH plugin set; its Secret Catalog adapter calls the installed rc.2
`remote.directoryPicker` and `remote.workspace.create` APIs.

The component itself has no DSH peer dependency because it consumes injected
ports. The consuming Secret Catalog package pins the rc.2 workspace-controller
peer contract. DSH refusals are surfaced to the user; the adapter does not
approximate an unavailable Host operation.

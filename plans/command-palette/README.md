# Command Palette

Extract the app-wide command palette into its own plugin and give client plugins a typed action-registration API. The palette owns the searchable command UI and registry; contributing plugins own their actions. Action availability receives a small, read-only snapshot of the active thread and workspace, with plugin closures used only for plugin-specific services.

## Progress

| Step                                                              | Status      | Evidence                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect current palette, plugin boundaries, and runtime contracts | complete    | Existing palette is rendered by Thread Sidebar; Client `theme` service supports `system` and preference writes; the live root `shell.overlay` slot provides session/workspace hooks; profile composition and plugin package contracts inspected.                                                                                                                                       |
| Design the public action contract and palette ownership boundary  | complete    | Dedicated `command-palette` plugin owns UI/registry; a typed public helper writes to a versioned browser registry, avoiding Cordis injection dependencies. Actions receive read-only active-thread/workspace/theme context and return a disposer.                                                                                                                                      |
| Extract palette and migrate Thread Sidebar contributions          | complete    | New `@dshfiles/command-palette` owns palette UI, search, shortcut, and versioned browser registry; Thread Sidebar now registers its navigation and contextual actions through `@dshfiles/command-palette/api`.                                                                                                                                                                         |
| Add theme, current-thread, history, and workspace actions         | complete    | Palette contributes Light/Dark/System and workspace actions; Thread Sidebar contributes Back/Forward and current-thread copy-link/pin/unpin. `paletteRecentLimit` remains wired to the new registry.                                                                                                                                                                                   |
| Build, test, import-check, and verify in a scratch profile        | in progress | Both plugins typecheck, build, and import-check; Command Palette has 17 passing tests and Thread Sidebar 53. Minimal `palette-check` booted with zero activation failures. Full UI rebuild passed 13 consumers; Secret Catalog and AI Accounts fail on concurrent type errors, and Project Folder Picker has no build script. `profiles/web/package.json` now includes the new bundle. |

## Resume here

After the concurrent Secret Catalog and AI Accounts edits typecheck, rebuild the remaining UI consumers and run the one-shared-stylesheet e2e guard. The full `probe` boot reports nonactivations including unrelated `llm-commandcode`; the isolated palette-check profile boots cleanly. The two code revisions and progress note are scoped; JJ rebased both descendant copies while preserving their file diffs and the full worktree checksum. The pre-existing Thread Sidebar descendant conflict remains, with no new conflict introduced.

## Constraints

- Do not modify or commit unrelated shared working-copy paths.
- Do not restart the live DSH instance or rewrite the Nix-managed plugin region in `profiles/web/cordis.patch.yml`.
- Keep registrations browser-local and dispose them on plugin unload/HMR.
- Use the Host theme preference service, never DOM theme mutation.

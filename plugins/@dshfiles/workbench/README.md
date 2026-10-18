# @dshfiles/workbench

Docking workbench for DSH, in two surfaces over one panel registry. Registered panels can move, split, tab, and float
without remounting; each surface persists its own layout. The [`@dshfiles/editor`](../editor/README.md) package
contributes an editor panel, and [`@dshfiles/jujutsu`](../jujutsu/README.md) one that leads the dock by default.

## Use

- **Main surface**: a global panel of DSH's main view, opened from the left sidebar's rail. It replaces the conversation
  while it is shown, so it is where a large arranged workspace belongs.
- **Global dock**: the same panels in the frame's right column, next to the conversation. Its layout and panel set belong
  to the browser rather than to a thread, so switching threads never rearranges it — the persistent side panel. The
  workbench owns the surface; the frame owns the column and renders it while the seat asks for it.
- **Per-thread side panel**: the old right-pane tab type, kept for the native per-thread surface. It is one tab inside
  the session's own right sidebar, so it changes with the thread.

## Settings (`dshfiles-workbench`)

| Key            | Default  | Meaning                                                                                                               |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `rightPanel`   | `native` | Which surface fills the right column: `native` is the per-thread right sidebar, `dock` is the global dock.            |
| `headerToggle` | `false`  | Show a conversation-header button that toggles the workbench in the native per-thread side panel.                     |
| `demoPanels`   | `false`  | Developer fixtures: the Scratchpad and Ticker panels, which count mounts and renders to prove docking never remounts. |

The dock needs the owned frame (`@dshfiles/frame-layout`): it registers into that frame's `shell.dock` seat and calls
`ctx.rightPanel.setMode`. On the stock layout package the seat does not exist, the registration is inert, and the setting
changes nothing. The setting is the single source of truth for the mode — the frame only follows the report — so it also
comes back correctly after a reload.

## Panels

- `register({ id, title, component, dockDefault? })` on the page-global registry
  (`@dshfiles/workbench/registry`), from any plugin.
- `dockDefault: true` on at most one panel: the dock's default layout opens it alone, so the persistent surface starts on
  the panel it exists for. A saved dock layout always wins.
- Layouts persist per surface in `localStorage`: `dshfiles.workbench.layout.v1` (main),
  `dshfiles.workbench.dock-layout.v1` (dock), `dshfiles.workbench.side-panel-layout.v1` (per-thread tab).

This is an owned DSH bundle and shared panel registry. Run `pnpm build`, `pnpm test`, and `pnpm typecheck` from this package.

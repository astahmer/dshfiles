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
- **Bottom panel**: the same panels again in the frame's full-width bottom row, opened from the dock's header or the
  `bottomPanel` setting. The frame owns the row's height and its resize handle, so it reopens where the user left it.
- **Per-thread side panel**: the old right-pane tab type, kept for the native per-thread surface. It is one tab inside
  the session's own right sidebar, so it changes with the thread.
- **Move**: each surface's header lists where an open panel can go — the other docking regions, and the feature's own
  full main-view page when its definition names one. A panel lives in exactly one region, so moving it closes the copy
  the source held; asking for a region that is closed opens it first and hands the panel over when it reports ready.
- **Layouts**: the header's Layouts dialog saves the arrangement of every region under a name, and applies, renames or
  deletes those names later. A layout only changes the regions it recorded, and applying one opens a region it needs.

## Settings (`dshfiles-workbench`)

| Key            | Default  | Meaning                                                                                                                                                              |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rightPanel`   | `native` | Which surface fills the right column: `native` is the per-thread right sidebar, `dock` is the global dock.                                                           |
| `bottomPanel`  | `hidden` | `shown` opens the frame's full-width bottom row; `hidden` closes it.                                                                                                 |
| `headerToggle` | `false`  | Show a conversation-header button (and bind `workbench.toggleSidePanel` in Settings › Shortcuts) that switches the column between the dock and the per-thread panel. |
| `demoPanels`   | `false`  | Developer fixtures: the Scratchpad and Ticker panels, which count mounts and renders to prove docking never remounts.                                                |

The dock needs the owned frame (`@dshfiles/frame-layout`): it registers into that frame's `shell.dock` seat and calls
`ctx.rightPanel.setMode`; the bottom row needs the frame's `shell.bottom` seat and `ctx.frameBottom`. On the stock layout
package the seats do not exist, the registrations are inert, and the settings change nothing. The settings are the single
source of truth for what is shown — the frame only follows the reports — so they also come back correctly after a reload.

**One fallback.** The native per-session surface is the only one that can render the resources other plugins open into it
(a file preview, a diff, a terminal), so while the on-screen thread has such a tab open the column goes back to the native
surface; the dock returns — layout intact — once that thread has no open tabs. `src/right-panel-mode.ts` is that rule.

## Panels

- `register({ id, title, component, dockDefault? })` on the page-global registry
  (`@dshfiles/workbench/registry`), from any plugin.
- `dockDefault: true` on at most one panel: the dock's default layout opens it alone, so the persistent surface starts on
  the panel it exists for. A saved dock layout always wins.
- Layouts persist per surface in `localStorage`: `dshfiles.workbench.layout.v1` (main),
  `dshfiles.workbench.dock-layout.v1` (dock), `dshfiles.workbench.bottom-layout.v1` (bottom row),
  `dshfiles.workbench.side-panel-layout.v1` (per-thread tab), and named layouts under
  `dshfiles.workbench.saved-layouts.v1`.

This is an owned DSH bundle and shared panel registry. Run `pnpm build`, `pnpm test`, and `pnpm typecheck` from this package.

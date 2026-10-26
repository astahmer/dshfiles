# @dshfiles/frame-layout

![Hand the frame's regions to plugin surfaces](docs/screenshots/panel-seats.png)

DSH's three-column AppFrame, forked so the frame's dragged panel widths and collapsed sidebar survive a reload.

## Use

- **Frame**: the sidebar, main content and right column are the same three-column frame as the native layout package, with the
  same drag handles, collapse rail, macOS/Windows window-chrome seats and column-concession rules.
- **Persisted geometry**: dragging the left sidebar (264–420px) or the right panel (≥300px, capped at 70% of the frame) writes
  the px preference to this browser under `dshfiles.frame-layout.v1`, together with the wide sidebar's collapsed state. A
  reload reopens the sidebar at its **last open width and last state** and keeps the right panel's px preference.
- **Collapse is remembered**: closing the sidebar boots back closed, and reopening restores the last open width instead of
  the 280px contract default. A narrow frame (<1024px) keeps its own responsive auto-collapse rather than restoring a stored
  wide-frame override. The right panel still boots hidden, and stores only its width.
- **Storage failure degrades to upstream behavior**: a blocked or full store (private mode, quota) leaves the geometry
  in-memory, exactly as the native package.
- **Right-column seat**: the column renders the native per-thread right sidebar, or the global dock a plugin registers into
  `shell.dock` and asks for through `ctx.rightPanel.setMode('dock')` — see [the right-column seat](#the-right-column-seat).

## Port

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
- Package: `packages/client/ui-layout` (`@deepseek-ai/dsh-client-ui-layout`)
- Pinned revision: [`dsh-v0.2.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2) (`687f282e8625c6b8d11ff58211a90524be2e4317`), release 0.2.1-rc.2
- The complete client source is vendored in [`src/native`](./src/native) (upstream `src`), keeping the upstream relative
  layout: `src/native/client/*` mirrors upstream `src/client/*`, `src/native/index.ts` the upstream Host entry.
- The native row is disabled in [`cordis.patch.yml`](./cordis.patch.yml). The replacement is not optional: both packages
  provide `ctx.layout` and register the single `root` slot.

### Why the whole package is ported

`ctx.layout` exposes panel _actions_ (`toggleSidebar`, `selectPanel`, right-panel presentation), never a width, and the
frame's geometry store (`createLayoutStore`) is package-private: it is constructed inside the native plugin's apply world
and no cross-plugin store access exists. `@deepseek-ai/dsh-client-ui-layout`'s own README states the contract: _"Layout
state resets on reload"_, and its known limitations call panel geometry transient. A width cannot be written from a slot
occupant, so the smallest place that can persist one is the package that owns the store.

### Local delta

Every other vendored file is byte-identical to the pinned revision, so an upstream update starts from a real `diff`. The
whole delta is:

| File                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/client/index.ts`            | the `apply` context type comes from `@dshfiles/dshx/client` (`ClientContext`); the Host `Context.sessions` augmentation is in scope in this program, so the dshx client-program context is the one the entry contract hands over. Also restores the stored geometry on the freshly created instance, declares the `shell.dock` child slot, and provides `ctx.rightPanel` and `ctx.frameBottom`, disposing them on teardown |
| `src/native/client/stores.ts`           | `layoutInfo.sidebarLastOpen` remembers the last non-zero width; `setSidebar` writes it and `toggleSidebar` reopens at it instead of `SIDEBAR_DEFAULT`, so a remembered collapse can reopen where the user left it. `layoutInfo.rightPanelMode` plus its `setMode` action record which surface fills the right column                                                                                                       |
| `src/native/client/AppFrame.tsx`        | renders `rightbar` or the `shell.dock` seat in the right column according to `layoutInfo.rightPanelMode`, passing both the same resolved geometry. Upstream always renders the `shell.bottom` row at its content height; here the row renders only while `layoutInfo.bottomShown`, at the stored, clamped height, with a vertical drag handle                                                                              |
| `src/native/client/AppFrame.module.css` | `.bottomRow` clips its occupant and draws a top border; the bottom resize handle (`.handle[data-side='bottom']`) rides `--dsh-bottom-height` against the whole frame instead of the columns' grid area                                                                                                                                                                                                                     |
| `src/native/client/columns.ts`          | `BOTTOM_MIN`, `BOTTOM_DEFAULT` and `BOTTOM_MAX_RATIO` for the bottom row's height clamp                                                                                                                                                                                                                                                                                                                                    |
| `src/frame-widths.ts`                   | new: the browser-local geometry record (schema, read, write) and the store restore/write-back helpers                                                                                                                                                                                                                                                                                                                      |
| `src/panel-retention.ts`                | new: keeps the active `main` panel selected for `PANEL_REREGISTER_GRACE_MS` after its entry disappears, so a plugin hot reload (which unregisters the entry before the rebuilt bundle registers it again) no longer throws the user back to the thread; `index.ts` routes upstream's `retainMainPanels` through it                                                                                                         |
| `src/regions.ts`                        | new: the panel seat contracts — `RightPanelSeat` and `FrameBottomSeat`, the `ctx.rightPanel` and `ctx.frameBottom` augmentations a plugin calls, and the `shell.dock` slot declaration a dock registers into                                                                                                                                                                                                               |

`src/native/index.ts` stays upstream's no-op Host body, re-exported by `src/host.ts` because the dshx Host entry lives at
that path.

### The panel seats

The frame owns the whole geometry and exposes one seat per region to plugins:

- **Right column** — `ctx.rightPanel.setMode('dock' | 'native')` hands the column to the plugin that
  registered into `shell.dock`, or back to the native per-session right sidebar. Both receive the same
  resolved geometry (`RightbarOwnerProps`) and report their presentation through `ctx.layout`.
- **Bottom row** — `ctx.frameBottom.open(height?)` shows the full-width row below the columns and
  `ctx.frameBottom.close()` hides it; the frame stores and clamps the height (`BOTTOM_MIN` …
  `BOTTOM_MAX_RATIO` of the window) and publishes it as `--dsh-bottom-height`, so the row's resize
  handle rides its top edge and a reload reopens it where the user left it. `ctx.frameBottom.height()`
  reports the rendered height (0 while hidden). The occupant registers into the layout contract's own
  `shell.bottom` slot and fills the row it is given.

### The right-column seat

The right column has one owner at a time. A plugin that wants to keep panels on screen across threads registers into the
`shell.dock` slot and calls `ctx.rightPanel.setMode('dock')`; the frame then renders that seat instead of the native
per-session right sidebar, with the same width, drag handle, collapse and fullscreen behaviour, and hands it the same
resolved geometry (`RightbarOwnerProps`). `setMode('native')` — what a plugin does when its setting turns the dock off, and
what it does on teardown — gives the column back. A frame without this seat (the stock package) is a different layout owner
altogether, so `ctx.rightPanel` is simply absent; read it through `ctx.get('rightPanel')` rather than injecting it.

### Updating to a new DSH release

1. Compare the entire upstream package (`packages/client/ui-layout/src`) at the exact release commit against the pinned
   revision; the table above lists the only files that should differ.
2. Re-apply the local delta on top of the new upstream files rather than porting your own edits forward.
3. Recheck the Loader row identity (`ui-layout`), the `root` slot and its child declarations (upstream adds and renames
   seats; `shell.dock` is this fork's own addition), the `ctx.rightPanel` seat, `dsh.client.external`, and the plugin peer
   ranges against the installed release.
4. Update the pins, source revision and this document together; run typecheck, tests, build, the Host import check,
   `pnpm check:e2e frame-layout`, and the browser journey.

## Notes

The web profile seed includes this package, so the live `web` profile replaces the native layout row on its next restart.
Until that restart the browser keeps the stock frame.

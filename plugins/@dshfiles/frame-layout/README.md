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
  wide-frame override. The frame stores the right panel's width; Workbench owns whether its persistent right-pane tabs are shown.
- **Recovery reveal**: the owned `ctx.frameSidebar.show()` presentation port opens the left sidebar idempotently from live frame state. Repeated synchronous Reset layout calls cannot toggle it closed again; remembered widths and the prior wide-frame preference survive narrow expansion. The resolved sidebar track takes at most half the frame, so reopening a remembered 420px sidebar on a 360px frame leaves both left and centre at 180px instead of hiding the conversation. The right track still concedes first, and wider frames restore the saved width. This does not add a method to native `ILayout`.
- **Storage failure degrades to upstream behavior**: a blocked or full store (private mode, quota) leaves the geometry
  in-memory, exactly as the native package.
- **Left-content seat**: the public `shell.left` contract is declared/rendered by the owned thread sidebar, not by AppFrame.
  Its single root occupant receives `{ collapsed: boolean }`; only the flexible middle is delegated. The sidebar retains
  fixed brand/history/customize and account/settings/footer chrome, plus the native navigation/thread fallback. Keep the
  docking occupant mounted while collapsed so another region never loses its registered destination.
- **Main-surface seat**: `shell.main` hosts Workbench with the frame-authorized keyed-main renderer. The owned stack always
  uses Workbench tabs; there is no native-layout opt-out. `ctx.mainSurface` reports ownership for cooperating packages.
  Native rendering and the main-tabs portal anchor remain compatibility paths for deployments without Workbench or an empty seat.
- **Right-column seat**: Workbench owns the visible right pane through `shell.dock`, with shared real open/close/toggle
  actions registered through `ctx.rightPanel.registerDock`. The main group's **Pane options** offers **Open right pane** only while closed; **Close pane** sits at the right pane's own right edge, not in the centre. The right region spans the full frame height; opening the
  bottom row affects only left and centre. Without Workbench, the native per-thread sidebar remains a compatibility
  fallback — not a selectable Workbench surface. See [the right-column seat](#the-right-column-seat).

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

| File                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/native/client/index.ts`            | the `apply` context type comes from `@dshfiles/dshx/client` (`ClientContext`); the Host `Context.sessions` augmentation is in scope in this program, so the dshx client-program context is the one the entry contract hands over. Also restores the stored geometry on the freshly created instance, declares the `shell.dock` and `shell.main` child slots, and provides `ctx.rightPanel` with its frame-lifetime dock action registry, observable `ctx.mainSurface` and `ctx.frameBottom`, disposing them on teardown                                                                                                        |
| `src/native/client/stores.ts`           | `layoutInfo.sidebarLastOpen` remembers the last non-zero width; `setSidebar` writes it and `toggleSidebar` reopens at it instead of `SIDEBAR_DEFAULT`, so a remembered collapse can reopen where the user left it. `layoutInfo.rightPanelMode` plus its `setMode` action retain internal right-column compatibility state; `mainSurfaceMode` and `setMainSurfaceMode` retain centre-ownership compatibility state. Workbench claims the centre unconditionally in the owned stack; neither mode is a user-selectable layout preference                                                                                         |
| `src/native/client/AppFrame.tsx`        | keeps a stable main-tabs centre anchor around native `main` or `shell.main`, delegates guarded keyed-main rendering and supplies the native empty-seat fallback. Keeps `shell.dock` mounted throughout Workbench mode, passing resolved geometry plus `shown`; its carrier hides while closed. Keeps the authorized native `rightbar` resource carrier mounted but hidden throughout Workbench mode, even while the dock is closed. Upstream always renders the `shell.bottom` row at its content height; here the row renders only while `layoutInfo.bottomShown`, at the stored, clamped height, with a vertical drag handle |
| `src/native/client/AppFrame.module.css` | explicit grid cells keep the right column and its resize handle full-height across both rows; bottom content and its resize handle occupy only columns 1–2. `.bottomRow` clips its occupant and draws a top border                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/native/client/columns.ts`          | `BOTTOM_MIN`, `BOTTOM_DEFAULT` and `BOTTOM_MAX_RATIO` for the bottom row's height clamp; resolved sidebar width capped to half the frame so narrow recovery keeps the centre reachable without changing saved preferences                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/frame-widths.ts`                   | new: the browser-local geometry record (schema, read, write) and the store restore/write-back helpers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/panel-retention.ts`                | new: keeps the active `main` panel selected for `PANEL_REREGISTER_GRACE_MS` after its entry disappears, so a plugin hot reload (which unregisters the entry before the rebuilt bundle registers it again) no longer throws the user back to the thread; `index.ts` routes upstream's `retainMainPanels` through it                                                                                                                                                                                                                                                                                                             |
| `src/main-surface.ts`                   | new: adapts the frame store to the observable main-surface seat; delegates frame-authorized keyed-main rendering with a legacy-workbench recursion guard and the installed renderer's native fallback                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/right-panel.ts`                    | new: frame-lifetime dock action registration; latest live registration wins, independent disposers preserve other registrations, teardown clears all actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/regions.ts`                        | new: the public `MainSurfaceSeat`, `MainSurfaceOwnerProps`, `RightPanelSeat`, `DockPaneActions`, `DockPaneOwnerProps` and `FrameBottomSeat` contracts, their Context augmentations, and `shell.main`/`shell.dock` declarations                                                                                                                                                                                                                                                                                                                                                                                                 |

`src/native/index.ts` stays upstream's no-op Host body; it is also the dshx Host entry, so no extra forwarding module
stands between the build and that file.

### The panel seats

The frame owns the whole geometry and exposes one seat per region to plugins:

- **Centre** — the owned Workbench claims `shell.main`; [the main-surface seat](#the-main-surface-seat)
  documents its guarded renderer and ownership observable. Native centre rendering is absent-Workbench compatibility only.
- **Right column** — `shell.dock` owns the fullheight Workbench right pane. Closing hides its mounted tab region,
  preserving views and resource sessions. The `ctx.rightPanel` dock-action registry serves the main Pane options opener, pane-local Close pane icon
  and original sidebar shortcut; internal `dock`/`native` tokens are not user-selectable presentation modes.
- **Bottom row** — `ctx.frameBottom.open(height?)` shows the row below left and centre only and
  `ctx.frameBottom.close()` hides it; the frame stores and clamps the height (`BOTTOM_MIN` …
  `BOTTOM_MAX_RATIO` of the window) and publishes it as `--dsh-bottom-height`, so the row's resize
  handle rides its top edge and a reload reopens it where the user left it. `ctx.frameBottom.height()`
  reports the rendered height (0 while hidden). The occupant registers into the layout contract's own
  `shell.bottom` slot and fills the row it is given. Workbench opens an empty row with the same New tab chooser as other panes; its own far-right Close pane icon hides it.

### The main-surface seat

Import `MainSurfaceOwnerProps` and the `shell.main` slot/Context augmentations from
`@dshfiles/frame-layout/regions` (a declared dshx module, not the private native entry).
The frame declares this single, root-scoped seat alongside keyed `main` and retains its render authorization.
An occupant receives `renderMain(entryKey: string): ReactNode`, which can render `conversation` or any registered
keyed main panel. It returns `null` for `dshfiles-workbench`: the legacy global workbench entry must never be
mounted recursively inside the workbench. It grants no authority over other slots.

Read the optional `ctx.get('mainSurface')` face for presentation ownership. Workbench calls `setMode('workbench')`
unconditionally; there is no user-facing native choice. `mode()` reads ownership, and `subscribe(listener)` notifies
only when it changes and returns an unsubscribe function. React consumers can use
`useSyncExternalStore(seat.subscribe, seat.mode)`. Internal `setMode('native')` and teardown behavior remain for
package compatibility, not as an owned-stack opt-out. With no registered occupant, the installed slot renderer receives
the native panel as its empty-seat fallback even if the requested mode is workbench.

The stable `[data-main-column] > [data-slot="main"]` wrapper stays mounted across both modes. Main-tabs may portal
its strip immediately before that wrapper; nested keyed main outlets inside panels are not the strip target.
`data-main-surface="native" | "workbench"` reports the requested mode on that wrapper.

### The right-column seat

In Workbench main mode, the native rightbar outlet stays mounted inside a hidden
`[data-native-rightbar-carrier]` wrapper, including while the Workbench right pane is closed. Its authorized session
owner keeps native resource stores and portal renderers alive without drawing another column. The owned rightbar must
suppress its frame-geometry reports throughout this carrier mode. Native visibility returns only outside Workbench main
mode with native right-column ownership.

The `shell.dock` occupant also stays mounted throughout Workbench mode. The frame hides its
`[data-shell-dock-carrier]` wrapper while closed and supplies `DockPaneOwnerProps`: resolved `RightbarOwnerProps` geometry
plus optional `shown`. This frame always passes `shown: true | false`; older frames may omit it. The occupant reports
open or closed geometry through `ctx.layout` from that share, without losing its live views/drafts on close.

Import the cooperating controls from `@dshfiles/frame-layout/regions`:

```ts
interface DockPaneActions {
  isOpen(): boolean
  open(): void
  close(): void
  toggle(): void
  subscribe(listener: () => void): () => void
}
```

Workbench registers its real actions with `ctx.get('rightPanel')?.registerDock?.(actions)` and disposes that registration
on teardown. Existing sidebar controls read `ctx.get('rightPanel')?.dock?.()` at action time, including while the pane
is closed. The latest live registration wins; each disposer removes only its registration, and frame teardown clears the
registry. The frame neither mirrors pane state nor subscribes on the occupant's behalf.

`RightPanelSeat.setMode('dock' | 'native')` and `mode()` remain internal compatibility controls, not a user-facing surface
choice. Workbench requests `dock` while shown and uses the legacy `native` token while closed only to release the visible
track; this does not reveal native chrome or unmount Workbench tabs and the native resource carrier.
Outside Workbench mode the native per-session right sidebar remains the fallback for deployments without Workbench.
A stock frame has no `ctx.rightPanel`; use optional reads rather than injecting it. Historical Workbench `mainSurface`,
`rightPanel` and `headerToggle` schema fields are hidden decode-only migration inputs; they expose no new public
configuration and cannot opt the owned stack out of Workbench.

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

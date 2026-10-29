# Docking decisions

Why the Workbench is DSH's docking surface, and what the choice rules out. The behavior itself is in the
[README](../README.md); the frame's seats are in the [frame-layout README](../../frame-layout/README.md#the-panel-seats).

## What the stock right panel cannot do

- **It is per-session.** `@deepseek-ai/dsh-client-ui-sidebar-right` keeps one docking surface per Session (one
  `SurfaceState` per session id, saved under `dsh.sidebar-right.v1.<sessionId>`). Its slot is session-scoped, and
  without a Session on screen there is no panel. A panel cannot survive a thread switch there.
- **The right column is one root-scoped slot.** Declaring a slot claims it, so a second owner cannot share the column.
- **Native resources render only inside its tab domain.** File preview, diff and terminal bodies belong to that
  session-scoped domain; a foreign host cannot adopt them. The Workbench reaches them through the owned
  [`sidebar-right`](../../sidebar-right/README.md) declarer, which portals the real session-bound slots into panels.

## Decisions

- **The frame decides what fills each region.** The columns and their drag and collapse geometry already belong to the
  `frame-layout` fork, so the seats (`shell.main`, `shell.dock`, `shell.bottom`) live there. There is no second right
  column and no new column math, and the native packages stay loaded so their slot declarations survive.
- **The dock is the Workbench, evolved in place.** It reuses the Workbench's page-global panel registry, Dockview surface
  and persistence instead of forking `ui-sidebar-right` (about 3.9k lines) and `ui-dockkit` (about 4.1k lines), or
  adopting dockkit as a second engine. Dockkit is DSH's own engine, but its README calls the API internal and liable to
  change in any release, and it offers no cross-surface moves either. The registry stays the one contract contributors
  (editor, Jujutsu, backlog) already use.
- **Ownership is reported, not inferred from slot occupancy.** The Workbench reports to the frame through
  `ctx.rightPanel` and `ctx.mainSurface`, read with `ctx.get` so it still loads on a frame without those faces. Its
  entries register statically, so there is no ordering race between a component effect and the frame's declaration.
- **Moves use surfaces that already exist.** Inside a region, Dockview moves, splits, tabs and floats. Between regions,
  the region registry hands a panel over and closes the source's copy. To a full main-view page, the panel's own `main`
  entry opens through `ctx.layout.selectPanel`.
- **Dockview's chrome does not match dockkit's.** Dockview is MIT and in the workspace; the visual mismatch with the
  stock right sidebar is accepted unless it becomes a product problem.

## The main view

The Workbench is also DSH's centre column: the conversation and every global main panel are Dockview panels in one
layout, arranged by the user instead of replacing each other.

- **The frame owns the centre seat.** `frame-layout` declares `shell.main` and provides `ctx.mainSurface`, like
  `ctx.rightPanel`. The frame already declares the keyed `main` slot, so it holds the only legal render function for
  registered main entries and hands it to the seat's occupant. A `workspace-nav` fork would have had to re-declare
  `main`. Details are in the [frame-layout README](../../frame-layout/README.md#the-main-surface-seat).
- **Dockview tabs are the main view's tabs.** There is no separate strip above the centre in the owned stack.
  `main-tabs` keeps the semantics (preview, pin, indicators, close, thread open and move) and renders its native strip
  only where Workbench is absent.
- **No native-layout opt-out.** The `mainSurface` setting was first planned as a default with an explicit native
  opt-out. In the owned stack the centre always uses Workbench, and a saved `mainSurface: native` is decoded but cannot
  switch the renderer ([layout recovery](layout-recovery.md)).
- **Slot contributions keep working through their declarer.** Declaring a slot claims it, so only the declarer may
  render it. Where the declarer is ours (frame, `sidebar-right`, `chat`, `rich-composer`, `settings-shell`,
  `workspace-nav`, `thread-sidebar`), its content can become a panel; native resources (file preview, diff, terminal)
  reach panels through the owned `sidebar-right` declarer. A plugin with no slot of its own uses the panel registry.
  For a foreign declarer the route is the documented panel contract or a Host-gap row, never a client-side mirror of
  another package's state.
- **No new nested surfaces.** Nested Dockview containers were built and their saved layouts still restore under
  per-path keys, but new side-by-side or stacked layouts use Dockview groups (**Split right**, **Split down**).
- **The conversation is not a naive panel.** It owns scroll anchoring, virtualization, keyboard and focus, so moving or
  re-laying out its panel must not remount it.

Switching between already-open threads measured 32.8 ms p50 in Workbench against 111.9 ms in the native centre
([performance](../../../../docs/performance.md#workbench-main-seat-baseline-2026-10-26)).

## Things that bit

- Dockview reports layout changes only for later gestures, so a freshly applied default layout was never saved and a
  reload rebuilt the default instead of what the user saw. Every surface now saves the layout it restored or applied
  when it becomes ready.
- Dockview's layout-edge target refuses a panel from another Dockview instance. Over a region with no panel of its own,
  no target answers, so each region's own drop zone takes that case.
- A new Tailwind utility exists only after `@dshfiles/ui-styles` is rebuilt. A missing `dshx:flex-1` once collapsed the
  panel silently and swallowed tab clicks.

## Verify

```sh
pnpm --dir plugins/@dshfiles/workbench test
pnpm --dir plugins/@dshfiles/frame-layout test
pnpm run check:e2e workbench
```

The `workbench.global-dock`, `workbench.bottom-panel`, `workbench.saved-layouts` and `workbench.drag-between-regions`
journeys cover the dock, the bottom row, named layouts and real pointer drags between regions.
`workbench.saved-layouts` is timing-sensitive in a long run: it has failed once in a while in the full suite and passed
alone, so treat a red full run there as a flake first and rerun it alone.

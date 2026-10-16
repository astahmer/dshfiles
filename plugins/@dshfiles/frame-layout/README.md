# @dshfiles/frame-layout

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

## Port

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
- Package: `packages/client/ui-layout` (`@deepseek-ai/dsh-client-ui-layout`)
- Pinned revision: [`c1b47e41fcd54d20a0f061df28683bfc29ee24e5`](https://github.com/deepseek-ai/deepseek-harness/commit/c1b47e41fcd54d20a0f061df28683bfc29ee24e5), `release(dsh): 0.2.0-rc.2`
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

| File                          | Change                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/client/index.ts`  | the `apply` context type comes from `@dshfiles/dshx/client` (`ClientContext`); the Host `Context.sessions` augmentation is in scope in this program, so the dshx client-program context is the one the entry contract hands over. Also restores the stored geometry on the freshly created instance and disposes the write-back subscription on teardown |
| `src/native/client/stores.ts` | `layoutInfo.sidebarLastOpen` remembers the last non-zero width; `setSidebar` writes it and `toggleSidebar` reopens at it instead of `SIDEBAR_DEFAULT`, so a remembered collapse can reopen where the user left it                                                                                                                                        |
| `src/frame-widths.ts`         | new: the browser-local geometry record (schema, read, write) and the store restore/write-back helpers                                                                                                                                                                                                                                                    |

`src/native/index.ts` stays upstream's no-op Host body, re-exported by `src/host.ts` because the dshx Host entry lives at
that path.

### Updating to a new DSH release

1. Compare the entire upstream package (`packages/client/ui-layout/src`) at the exact release commit against the pinned
   revision; the table above lists the only files that should differ.
2. Re-apply the local delta on top of the new upstream files rather than porting your own edits forward.
3. Recheck the Loader row identity (`ui-layout`), the `root` slot and its five child declarations, `dsh.client.external`,
   and the plugin peer ranges against the installed release.
4. Update the pins, source revision and this document together; run typecheck, tests, build, the Host import check,
   `pnpm check:e2e frame-layout`, and the browser journey.

## Notes

The web profile seed includes this package, so the live `web` profile replaces the native layout row on its next restart.
Until that restart the browser keeps the stock frame.

import { decodeJsonSafe } from '@dshfiles/dshx/json'
import { Effect, Result, Schema } from 'effect'
import { SIDEBAR_AUTO_COLLAPSE } from './native/client/columns.ts'
import type { createLayoutStore } from './native/client/stores.ts'

/** Browser-local geometry key: a panel width is per-browser chrome, never a Host fact. */
export const FRAME_WIDTHS_KEY = 'dshfiles.frame-layout.v1'

const frameWidthsSchema = Schema.Struct({
  sidebar: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(10_000)),
  rightbar: Schema.NullOr(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(10_000))),
  /** Last wide-frame sidebar state; a record written before this field boots open. */
  collapsed: Schema.optionalKey(Schema.Boolean).pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
})

/** The stored geometry preferences of one browser. */
export type FrameWidths = typeof frameWidthsSchema.Type

type LayoutInstance = ReturnType<ReturnType<typeof createLayoutStore>['create']>

const writeFrameWidths = (widths: FrameWidths): void => {
  try {
    localStorage.setItem(FRAME_WIDTHS_KEY, JSON.stringify(widths))
  } catch {
    // A blocked or full store (private mode, quota) leaves geometry transient, as upstream.
  }
}

export class FrameWidthsModel {
  /** Missing, malformed or blocked storage reads as absent, so geometry falls back to the contract defaults. */
  static readonly read = (): FrameWidths | null => {
    try {
      const raw = localStorage.getItem(FRAME_WIDTHS_KEY)
      if (raw === null) return null
      const parsed = decodeJsonSafe(frameWidthsSchema, raw)
      return Result.isSuccess(parsed) ? parsed.success : null
    } catch {
      return null
    }
  }

  /**
   * Reopen the sidebar at its last open width and last wide-frame state, and keep
   * the right panel's px preference. A narrow frame keeps its own responsive
   * auto-collapse, so only a wide frame restores the stored state; the right panel
   * still boots hidden and keeps only its width.
   */
  static readonly restore = (instance: LayoutInstance): void => {
    const saved = FrameWidthsModel.read()
    if (saved === null) return
    if (saved.sidebar > 0) instance.actions.setSidebar(saved.sidebar)
    if (saved.collapsed && instance.getSnapshot().layoutInfo.viewportWidth >= SIDEBAR_AUTO_COLLAPSE) instance.actions.toggleSidebar()
    if (saved.rightbar !== null) instance.actions.setRightbar(saved.rightbar)
  }

  /**
   * Write the geometry back on every change: the store's last open width, the
   * right panel's px preference and whether the wide sidebar is collapsed.
   * @returns the change subscription's disposer.
   */
  static readonly persist = (instance: LayoutInstance): (() => void) => {
    let last: string | null = null
    return instance.subscribe(() => {
      const { sidebar, sidebarLastOpen, rightbar } = instance.getSnapshot().layoutInfo
      const next: FrameWidths = { sidebar: sidebarLastOpen, rightbar, collapsed: sidebar === 0 }
      const serialized = JSON.stringify(next)
      if (serialized === last) return
      last = serialized
      writeFrameWidths(next)
    })
  }
}

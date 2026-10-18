import type { RightPanelMode } from '@dshfiles/frame-layout/right-panel'

/**
 * Which surface the right column renders.
 *
 * The setting is the source of truth, with one fallback: the native per-session
 * surface renders the resources other plugins open into it (a file preview, a
 * diff, a terminal), and the dock cannot show those bodies until it owns them
 * (M4). While the on-screen Session has such a tab open, the native surface
 * takes the column back, so a clicked file link is never a no-op; the dock
 * returns — with its layout intact — once that Session has no open tabs.
 */
export const effectiveRightPanelMode = (input: {
  readonly setting: RightPanelMode
  readonly nativeTabsOnScreen: boolean
}): RightPanelMode => (input.setting === 'dock' && input.nativeTabsOnScreen ? 'native' : input.setting)

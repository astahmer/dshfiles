/**
 * The way into a hidden panel: one button in the conversation header's corner
 * seat, visible only while the panel is collapsed.
 *
 * It lives in the conversation's own header rather than in the frame's right
 * column so that a collapsed Sidebar costs the conversation nothing — no rail,
 * no width, and the transcript's scrollbar stays at the column's edge. The
 * corner seat is its own, past the utilities' edge, so the button never joins
 * the utilities row. Native mode shares the panel's per-session store,
 * which the slot runtime allows because both seats are session-scoped.
 * Workbench mode instead observes the frame's registered global dock actions;
 * hidden native carriers never own the visible pane's expansion. On mobile
 * devices, the disabled button stays mounted and hidden while the pane is
 * shown, preserving the title's width during the overlay slide. Desktop
 * devices collapse the seat while the pane is shown.
 *
 * The glyph is the left sidebar's collapse icon mirrored: the same affordance,
 * on the other edge.
 */
import { PanelLeftIcon } from '@dshfiles/plugin-ui/icons'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { useSyncExternalStore, type ReactNode } from 'react'
import type { DockPaneActions } from '@dshfiles/frame-layout/regions'
import { Button, isMobileDevice, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { createSidebarRightStore } from '../stores.ts'
import css from './ExpandButton.module.css'

/** The button's props: the header corner seat, the shared store, and copy. */
export type ExpandButtonProps = PropsRuntime<'conversation.session.header.corner'> &
  PropsStore<ReturnType<typeof createSidebarRightStore>> &
  PropsLocale<'sidebarRight'> &
  InjectFace<{
    dock: () => DockPaneActions | undefined
    hooks: { shortcuts: HostObservable<readonly ShortcutCatalogEntry[]>; workbenchMode: HostObservable<boolean> }
  }>

const closed = (): boolean => false
const subscribeNothing = (): (() => void) => () => {}

/** Opens a collapsed pane; when shown, hides and disables on mobile devices and renders nothing on desktop devices. */
export function ExpandButton({
  sessionId,
  useStore,
  actions,
  t,
  useShortcuts,
  useWorkbenchMode,
  dock,
}: Pick<ExpandButtonProps, 'sessionId' | 'useStore' | 'actions' | 't' | 'useShortcuts' | 'useWorkbenchMode' | 'dock'>): ReactNode {
  // A session with no surface yet is collapsed: the panel seat materializes the
  // surface on its own mount, and until then there is nothing expanded.
  const shortcut = useShortcuts(entries => entries.find(entry => entry.id === 'sidebar.right.toggle'))
  const expanded = useStore(state => state.bySession[sessionId]?.layout.expanded ?? false)
  const workbench = useWorkbenchMode(value => value, Object.is)
  const dockActions = workbench ? dock() : undefined
  const dockOpen = useSyncExternalStore(dockActions?.subscribe ?? subscribeNothing, dockActions?.isOpen ?? closed, closed)
  const shown = workbench ? dockOpen : expanded
  if (shown && !isMobileDevice()) return null
  return (
    <Tooltip label={t('chrome.expand')} shortcutKeys={shortcut?.keys} side="bottom" delayMs={500} disabled={shown}>
      <Button
        size="sm"
        className={shown ? `${css.button} ${css.expanded}` : css.button}
        disabled={shown}
        aria-label={t('chrome.expandAria')}
        aria-keyshortcuts={shortcut?.aria}
        data-sidebar-right-expand
        onClick={() => {
          if (workbench) dock()?.open()
          else actions.setExpanded(sessionId, true)
        }}
      >
        <PanelLeftIcon size={14} strokeWidth={1.5} className={css.icon} />
      </Button>
    </Tooltip>
  )
}

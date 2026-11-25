/**
 * The Inbox header's actions on a phone (round five C4): in the trailing corner of the shell's top bar, beside the
 * "Inbox" title, instead of a row of their own above the segmented control. The page renders inside a workbench pane
 * whose `transform` and `contain` would pin a fixed bar to the pane, so one bar is registered in the frame's root overlay
 * (`shell.overlay`) and reads the open page's actions from this store; it portals to the document body, because the
 * overlay layer is its own stacking context under the top bar. `InboxView.PHONE_BAR` shows it only while the top bar
 * names the Inbox, so a retained page that is not on stage draws nothing.
 */
import { useContract } from '@dshfiles/dshx/client'
import { PhoneStatus } from '@dshfiles/frame-layout/status-strip'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogPortal } from '@dshfiles/plugin-ui/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import type { PageAction } from '@dshfiles/plugin-ui/components/page'
import { EllipsisIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useId, useSyncExternalStore } from 'react'
import { InboxView } from './inbox-view.js'

export interface InboxPhoneActions {
  /** The page's one ink button (Start triage, or Resume all). */
  readonly primary: PageAction | undefined
  /** Every other header action; they fold into one menu. */
  readonly actions: readonly PageAction[]
  readonly moreLabel: string
}

/** The latest published actions per mounted page; the bar draws the most recent publisher's. */
const published = new Map<string, InboxPhoneActions>()
const listeners = new Set<() => void>()
let snapshot: InboxPhoneActions | undefined

const notify = (): void => {
  snapshot = [...published.values()].pop()
  for (const listener of listeners) listener()
}

export const InboxPhoneActionsStore = {
  publish: (owner: string, value: InboxPhoneActions): void => {
    published.delete(owner)
    published.set(owner, value)
    notify()
  },
  clear: (owner: string): void => {
    if (published.delete(owner)) notify()
  },
  read: (): InboxPhoneActions | undefined => snapshot,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
} as const

/** Publish this page's header actions for the phone bar while it is mounted. */
export const usePublishInboxPhoneActions = (value: InboxPhoneActions): void => {
  const owner = useId()
  useEffect(() => {
    InboxPhoneActionsStore.publish(owner, value)
  })
  useEffect(() => () => InboxPhoneActionsStore.clear(owner), [owner])
}

/** The bar itself, registered in `shell.overlay`. */
export const InboxPhoneBar = (): JSX.Element | null => {
  const value = useSyncExternalStore(InboxPhoneActionsStore.subscribe, InboxPhoneActionsStore.read, () => undefined)
  // Round five C2: the frame's status button (usage, working threads) leads the bar; no band above the tab bar.
  const status = useContract(PhoneStatus)
  if (value === undefined || (value.primary === undefined && value.actions.length === 0 && status.status !== 'active')) return null
  const primary = value.primary
  // A dialog root with no content is only a portal: no focus trap, no scroll lock, nothing hidden from assistive tech.
  return (
    <Dialog open modal={false}>
      <DialogPortal>
        <div data-inbox-phone-bar="" className={InboxView.PHONE_BAR}>
          {/* With Start triage present the three controls run over the centred title at 390 px; Threads keeps status. */}
          {primary === undefined && status.status === 'active' ? <status.value.Button /> : null}
          {value.actions.length === 0 ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon" variant="ghost" className="dshx:size-11 dshx:text-muted-foreground" aria-label={value.moreLabel}>
                  <EllipsisIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="dshx-root">
                {value.actions.map(action => (
                  <DropdownMenuItem key={action.id} disabled={action.disabled === true || action.pending === true} onSelect={action.onSelect}>
                    {action.icon ?? null}
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {primary === undefined ? null : (
            <Button
              type="button"
              size="sm"
              className="dshx-hit-44"
              data-page-action={primary.id}
              disabled={primary.disabled === true || primary.pending === true}
              onClick={primary.onSelect}
            >
              {primary.icon ?? null}
              {primary.label}
            </Button>
          )}
        </div>
      </DialogPortal>
    </Dialog>
  )
}

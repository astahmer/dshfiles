/**
 * The Inbox header's actions on a phone (round five C4): in the trailing corner of the shell's top bar, beside the
 * "Inbox" title, with the frame's status button in the leading corner, instead of a row of their own above the segmented control. The page renders inside a workbench pane
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
import { EllipsisIcon, ListChecksIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useId, useSyncExternalStore } from 'react'
import { InboxView } from './inbox-view.js'

export interface InboxPhoneActions {
  /** The page's other header actions, folded into one menu: the top bar keeps its title, Triage and ⋯. */
  readonly actions: readonly PageAction[]
  readonly moreLabel: string
  /**
   * Council round 11 C1: Start triage as a worded 44px "Triage" text button in the bar's trailing seats, beside ⋯, so
   * the view switcher's row keeps only the segments and their tally (council round 13 C1: the kit's bar text button).
   * Absent while nothing is open to triage.
   */
  readonly triage?: { readonly label: string; readonly onSelect: () => void }
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
  // Round five C2: the frame's status button (usage, working threads); no band above the tab bar. Round five C4 (council
  // round 5): it takes the bar's leading seat, left of the centred title, so the trailing corner (its ⋯) never
  // runs over "Inbox" at 390 px.
  const status = useContract(PhoneStatus)
  if (value === undefined || (value.actions.length === 0 && value.triage === undefined && status.status !== 'active')) return null
  // A dialog root with no content is only a portal: no focus trap, no scroll lock, nothing hidden from assistive tech.
  return (
    <Dialog open modal={false}>
      <DialogPortal>
        {status.status === 'active' ? (
          <div data-inbox-phone-bar="leading" className={InboxView.PHONE_BAR_LEADING}>
            <status.value.Button />
          </div>
        ) : null}
        <div data-inbox-phone-bar="trailing" className={InboxView.PHONE_BAR}>
          {value.triage === undefined ? null : (
            // Council round 13 C1: the kit's bar text button (secondary label at 500, list-checks glyph, 44px seat), so
            // "Triage" reads as an action beside the title, not a second title.
            <Button type="button" variant="bar" data-inbox-phone-triage="" onClick={value.triage.onSelect}>
              <ListChecksIcon aria-hidden />
              {value.triage.label}
            </Button>
          )}
          {value.actions.length === 0 ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon" variant="ghost" className="dshx:size-9 dshx:text-muted-foreground" aria-label={value.moreLabel}>
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
        </div>
      </DialogPortal>
    </Dialog>
  )
}

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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
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
  // Round five C2: the frame's status button (usage, working threads); no band above the tab bar. Round five C4 (council
  // round 5): it takes the bar's leading seat, left of the centred title, so the trailing corner (Start triage, ⋯) never
  // runs over "Inbox" at 390 px.
  const status = useContract(PhoneStatus)
  if (value === undefined || (value.primary === undefined && value.actions.length === 0 && status.status !== 'active')) return null
  const primary = value.primary
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
          {/* Council round 8 C1: Start triage (or Resume all) is a 44x44 icon-only button named by its aria-label and
              tooltip, before the page menu on the trailing edge, as on every other top bar; a worded button ran into the
              centred "Inbox" title. An action without a glyph keeps its words. */}
          {primary === undefined ? null : primary.icon === undefined ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="dshx-hit-44 dshx:h-9"
              data-page-action={primary.id}
              disabled={primary.disabled === true || primary.pending === true}
              onClick={primary.onSelect}
            >
              {primary.label}
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="dshx:size-11 dshx:text-foreground dshx:[&_svg]:size-5!"
                    data-page-action={primary.id}
                    aria-label={primary.label}
                    disabled={primary.disabled === true || primary.pending === true}
                    onClick={primary.onSelect}
                  >
                    {primary.icon}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="dshx-root">
                  {primary.label}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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

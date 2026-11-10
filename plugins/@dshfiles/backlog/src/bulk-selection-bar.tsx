import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChevronDownIcon, EllipsisIcon, MessagesSquareIcon, PinIcon, PinOffIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'

import { BacklogItems, type BacklogKind, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'

/** Space the list keeps below its last row so the bar (38px tall, 16px off the bottom) never hides it. */
export const bulkSelectionBarClearance = 64

const actionClass = 'dshx:inline-flex dshx:h-7 dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:outline-none dshx:hover:bg-accent'
const iconClass = 'dshx:size-3.5'
const chevronClass = 'dshx:size-3 dshx:opacity-60'
const menuItemClass = 'dshx:gap-2 dshx:text-[13px]'
const labelHiddenWhenCompact = 'dshx:@max-pane-compact:sr-only'
const hiddenWhenNarrow = 'dshx:@max-pane-narrow:hidden'
const shownWhenNarrow = 'dshx:hidden dshx:@max-pane-narrow:inline-flex'

const KindItems = (props: { readonly onKind: (kind: BacklogKind) => void }): ReactNode =>
  BacklogItems.kinds.map(kind => (
    <DropdownMenuItem key={kind} className={menuItemClass} onSelect={() => props.onKind(kind)}>
      <ItemGlyphs.KindIcon kind={kind} />
      {ItemGlyphs.kindLabels[kind]}
    </DropdownMenuItem>
  ))

/**
 * The selection's batch actions, on one line at any panel width: below 42rem the labelled buttons keep only their
 * icon, below 28rem Set kind, Pin and Unpin move into More actions, and only then does the count truncate.
 */
export const BulkSelectionBar = (props: {
  readonly count: number
  readonly onStartThread: () => void
  readonly onClear: () => void
  readonly onPin: () => void
  readonly onUnpin: () => void
  readonly onStatus: (status: BacklogStatus) => void
  readonly onKind: (kind: BacklogKind) => void
}): ReactNode => (
  <div className="dshx:pointer-events-none dshx:absolute dshx:inset-x-0 dshx:bottom-4 dshx:z-30 dshx:flex dshx:justify-center dshx:@container">
    <div
      role="group"
      aria-label="Selection actions"
      className="dshx:pointer-events-auto dshx:flex dshx:max-w-[calc(100%-1rem)] dshx:items-center dshx:gap-1 dshx:whitespace-nowrap dshx:rounded-xl dshx:border dshx:border-border dshx:bg-popover dshx:p-1 dshx:pl-3 dshx:text-[13px] dshx:shadow-lg dshx:animate-in dshx:fade-in-0 dshx:slide-in-from-bottom-2"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="dshx:mr-2 dshx:min-w-0 dshx:truncate dshx:tabular-nums">{props.count} selected</span>
        </TooltipTrigger>
        <TooltipContent>Shift-click selects a range; Cmd/Ctrl-click toggles items</TooltipContent>
      </Tooltip>
      <button type="button" onClick={props.onStartThread} className={actionClass}>
        <MessagesSquareIcon aria-hidden className={iconClass} />
        <span className={labelHiddenWhenCompact}>Start thread</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger className={actionClass}>
          Move to <ChevronDownIcon className={chevronClass} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="dshx-root">
          {BacklogItems.statuses.map(status => (
            <DropdownMenuItem key={status} className={menuItemClass} onSelect={() => props.onStatus(status)}>
              <ItemGlyphs.StatusIcon status={status} />
              {ItemGlyphs.statusLabels[status]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(actionClass, hiddenWhenNarrow)}>
          Set kind <ChevronDownIcon className={chevronClass} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="dshx-root">
          <KindItems onKind={props.onKind} />
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" onClick={props.onPin} className={cn(actionClass, hiddenWhenNarrow)}>
        <PinIcon aria-hidden className={iconClass} />
        <span className={labelHiddenWhenCompact}>Pin</span>
      </button>
      <button type="button" onClick={props.onUnpin} className={cn(actionClass, hiddenWhenNarrow)}>
        <PinOffIcon aria-hidden className={iconClass} />
        <span className={labelHiddenWhenCompact}>Unpin</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="More actions" className={cn(actionClass, shownWhenNarrow)}>
          <EllipsisIcon aria-hidden className={iconClass} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="dshx-root">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={menuItemClass}>Set kind</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="dshx-root">
              <KindItems onKind={props.onKind} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem className={menuItemClass} onSelect={props.onPin}>
            <PinIcon aria-hidden />
            Pin
          </DropdownMenuItem>
          <DropdownMenuItem className={menuItemClass} onSelect={props.onUnpin}>
            <PinOffIcon aria-hidden />
            Unpin
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Clear selection"
        onClick={props.onClear}
        className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:rounded-md dshx:p-1.5 dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
      >
        <XIcon className={iconClass} />
      </button>
    </div>
  </div>
)

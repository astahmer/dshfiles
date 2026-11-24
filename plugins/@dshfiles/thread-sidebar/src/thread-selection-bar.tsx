import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArchiveIcon, CircleCheckIcon, PinIcon, PinOffIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import type { ThreadSidebarTranslate } from './thread-view-manager.js'

interface ThreadSelectionBarProps {
  readonly count: number
  readonly allPinned: boolean
  readonly allSettled: boolean
  readonly onTogglePinned: () => void
  readonly onSettle: () => void
  readonly onArchive: () => void
  readonly onClear: () => void
  readonly t: ThreadSidebarTranslate
}

// In a column narrower than 17rem the three labelled buttons ran past the list's edge: the text gives way, the icon and
// the accessible name stay.
const LABEL = 'dshx:@max-[17rem]/selection:sr-only'

/**
 * The batch verbs for the selected rows, under the thread list. It is its own container, so it fits whatever width the
 * list has: the default 200px column shows three icon buttons, a wider one their labels too. Its tooltip says how to
 * extend the selection; the sidebar's TooltipProvider times it.
 */
export const ThreadSelectionBar = (props: ThreadSelectionBarProps): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div
        role="toolbar"
        aria-label={props.t('threadSidebarSelection')}
        data-testid="thread-selection-bar"
        className="dshx:@container/selection dshx:mx-2 dshx:mb-2 dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:border dshx:bg-card dshx:p-1.5 dshx:text-xs"
      >
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-medium" aria-live="polite">
          {props.t('threadSidebarSelectedCount', { count: props.count })}
        </span>
        <Button size="xs" variant="outline" onClick={props.onTogglePinned}>
          {props.allPinned ? <PinOffIcon strokeWidth={1.5} size={13} /> : <PinIcon strokeWidth={1.5} size={13} />}
          <span className={LABEL} data-selection-label="">
            {props.t(props.allPinned ? 'threadSidebarUnpin' : 'threadSidebarPin')}
          </span>
        </Button>
        <Button size="xs" variant="outline" disabled={props.allSettled} onClick={props.onSettle}>
          <CircleCheckIcon strokeWidth={1.5} size={13} />
          <span className={LABEL} data-selection-label="">
            {props.t('threadSidebarSettle')}
          </span>
        </Button>
        <Button size="xs" variant="outline" onClick={props.onArchive}>
          <ArchiveIcon strokeWidth={1.5} size={13} />
          <span className={LABEL} data-selection-label="">
            {props.t('threadSidebarArchive')}
          </span>
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label={props.t('threadSidebarClearSelection')} onClick={props.onClear}>
          <XIcon className="dshx:size-3.5" />
        </Button>
      </div>
    </TooltipTrigger>
    <TooltipContent side="top">{props.t('threadSidebarSelectionHint')}</TooltipContent>
  </Tooltip>
)

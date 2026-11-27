/**
 * dshfiles (productivity pass T4.2): every Turn of the thread as a list, for a phone or a pane too narrow for the rail
 * (the rail hides below 900px). Opened from the thread `⋯` menu (or the palette's "Turns"); the same filters as the
 * rail, and the same read boundary above its first unseen Turn; tapping a Turn jumps to it, paging history in when it
 * is not loaded.
 */
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@dshfiles/plugin-ui/components/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { CircleAlertIcon, CircleHelpIcon, MessageSquareIcon, PencilIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Fragment, type ReactNode } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'

type ChatKey = Parameters<ChatViewSlotProps['t']>[0]
import { TURN_MARK_FILTERS, TurnMarksModel, type TurnMarkFilter } from '../../turn-marks.ts'
import { seenBoundaryIndex, type TurnRailItem } from './turn-rail-items.ts'

const FILTER_LABEL: Record<TurnMarkFilter, ChatKey> = {
  all: 'chat.turnMap.all',
  questions: 'chat.turnMap.questions',
  errors: 'chat.turnMap.errors',
  edits: 'chat.turnMap.edits',
}

const KIND_ICON: Record<TurnRailItem['kind'], ReactNode> = {
  prompt: <MessageSquareIcon className="dshx:size-4 dshx:text-muted-foreground" aria-hidden="true" />,
  question: <CircleHelpIcon className="dshx:size-4 dshx:text-info" aria-hidden="true" />,
  failed: <CircleAlertIcon className="dshx:size-4 dshx:text-destructive" aria-hidden="true" />,
  edited: <PencilIcon className="dshx:size-4 dshx:text-muted-foreground" aria-hidden="true" />,
}

const KIND_LABEL: Record<TurnRailItem['kind'], ChatKey | undefined> = {
  prompt: undefined,
  question: 'chat.turnMap.kind.question',
  failed: 'chat.turnMap.kind.failed',
  edited: 'chat.turnMap.kind.edited',
}

export interface TurnsSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly items: readonly TurnRailItem[]
  readonly activeTurn: number | null
  readonly filter: TurnMarkFilter
  readonly counts: Readonly<Record<TurnMarkFilter, number>>
  readonly onFilterChange: (filter: TurnMarkFilter) => void
  readonly onNavigate: (item: TurnRailItem) => void
  /** The highest Turn the reader has reached; the same read boundary the rail draws goes above its first unseen row. */
  readonly seenTurn?: number | null
  readonly t: ChatViewSlotProps['t']
}

export function TurnsSheet({ open, onOpenChange, items, activeTurn, filter, counts, onFilterChange, onNavigate, seenTurn = null, t }: TurnsSheetProps) {
  const shown = items.filter(item => TurnMarksModel.matches(filter, item.kind, item.mark))
  const boundary = seenBoundaryIndex(shown, seenTurn)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="dshx-root dshx:flex dshx:max-h-[80dvh] dshx:flex-col dshx:gap-0 dshx:rounded-t-xl dshx:p-0" data-turns-sheet="">
        <SheetHeader className="dshx:gap-3 dshx:border-b dshx:border-border dshx:pb-3">
          <SheetTitle>{t('chat.turns.title')}</SheetTitle>
          <SheetDescription className="dshx:sr-only">{t('chat.turns.description')}</SheetDescription>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={filter}
            onValueChange={value => {
              if (value !== '') onFilterChange(value as TurnMarkFilter)
            }}
            className="dshx:w-full"
          >
            {TURN_MARK_FILTERS.map(option => (
              <ToggleGroupItem key={option} value={option} className="dshx:flex-1 dshx:gap-1.5" aria-label={t(FILTER_LABEL[option])}>
                {t(FILTER_LABEL[option])}
                <span className="dshx:text-muted-foreground dshx:tabular-nums">{counts[option]}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </SheetHeader>
        <ol className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto dshx:overscroll-contain dshx:py-1" aria-label={t('chat.turns.title')}>
          {shown.length === 0 && <li className="dshx:px-4 dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">{t('chat.turns.empty')}</li>}
          {shown.map((item, index) => {
            const kind = KIND_LABEL[item.kind]
            return (
              <Fragment key={item.turn}>
                {index === boundary && (
                  <li
                    role="separator"
                    aria-label={t('chat.turnMap.unreadBoundary')}
                    data-seen-boundary=""
                    className="dshx:flex dshx:items-center dshx:gap-3 dshx:px-4 dshx:py-2 dshx:text-2xs dshx:font-semibold dshx:text-muted-foreground"
                  >
                    <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                    {t('chat.turnMap.unreadBoundary')}
                    <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    className={cn(
                      'dshx:flex dshx:min-h-11 dshx:w-full dshx:items-start dshx:gap-3 dshx:px-4 dshx:py-2.5 dshx:text-left dshx:hover:bg-accent dshx:focus-visible:bg-accent dshx:focus-visible:outline-none',
                      item.turn === activeTurn && 'dshx:bg-accent',
                    )}
                    aria-current={item.turn === activeTurn ? 'true' : undefined}
                    data-turn-kind={item.kind}
                    onClick={() => {
                      onOpenChange(false)
                      onNavigate(item)
                    }}
                  >
                    <span className="dshx:mt-0.5 dshx:shrink-0">{KIND_ICON[item.kind]}</span>
                    <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                      <span className="dshx:truncate dshx:text-sm dshx:text-foreground">{item.prompt || t('chat.turnNavigation.turn', { turn: item.turn })}</span>
                      <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
                        {[t('chat.turnNavigation.turn', { turn: item.turn }), ...(kind === undefined ? [] : [t(kind)])].join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              </Fragment>
            )
          })}
        </ol>
      </SheetContent>
    </Sheet>
  )
}

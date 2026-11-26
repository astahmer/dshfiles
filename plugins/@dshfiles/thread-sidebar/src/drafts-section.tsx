import { plural } from '@dshfiles/dshx/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArchiveIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type JSX, type ReactNode } from 'react'
import { formatAge } from './relative-age.js'
import { GroupChevron } from './thread-group-header.js'
import type { ThreadSidebarTranslate } from './thread-view-manager.js'

/** The fields the section and its confirmation read from one draft row. */
interface DraftRow {
  readonly id: string
  readonly displayTitle: string
  readonly updatedAt: number
}

/** How many drafts the confirmation names before it says "and N more". */
const NAMED_DRAFTS = 5

/**
 * The folded "Empty drafts" group. Its Clean up verb is offered only on loaded, current data (`cleanable`), and it
 * asks first: the confirmation names the drafts it will archive, and only Confirm calls `onConfirm`.
 */
export const DraftsSection = <Row extends DraftRow>(props: {
  readonly drafts: readonly Row[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The list is loaded and DSH is reachable; otherwise the verb is not offered. */
  readonly cleanable: boolean
  readonly cleaning: boolean
  readonly onConfirm: (ids: readonly Row['id'][]) => void
  readonly renderRow: (row: Row) => ReactNode
  readonly headerClassName: string
  readonly t: ThreadSidebarTranslate
}): JSX.Element => {
  const t = props.t
  /** The drafts the confirmation names, frozen when it opened; null while it is closed. */
  const [confirming, setConfirming] = useState<readonly Row[] | null>(null)
  const count = confirming?.length ?? 0
  return (
    <section className="dshx:mt-1" aria-label={t('threadSidebarDrafts')}>
      <div
        className={cn(
          props.headerClassName,
          'dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:px-1 dshx:text-sm dshx:text-muted-foreground',
        )}
      >
        <button
          type="button"
          data-thread-section-header=""
          className="dshx:flex dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1.5 dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
          aria-expanded={props.open}
          onClick={() => props.onOpenChange(!props.open)}
        >
          <span className="dshx:inline-flex dshx:shrink-0" aria-hidden="true">
            <ArchiveIcon strokeWidth={1.5} size={14} />
          </span>
          <span className="dshx:whitespace-nowrap">{t('threadSidebarDrafts')}</span>
          <span className="dshx:text-xs dshx:tabular-nums">({props.drafts.length})</span>
          <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
          <GroupChevron open={props.open} last={!props.cleanable} />
        </button>
        {props.cleanable ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                className="dshx:shrink-0"
                aria-label={t('threadSidebarDraftsCleanUp')}
                data-drafts-clean-up=""
                disabled={props.cleaning}
                onClick={() => setConfirming(props.drafts)}
              >
                <ArchiveIcon strokeWidth={1.5} size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('threadSidebarDraftsCleanUpHint')}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {props.open ? props.drafts.map(row => props.renderRow(row)) : null}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={open => {
          if (!open) setConfirming(null)
        }}
      >
        <AlertDialogContent className="dshx-root" data-drafts-confirm="">
          <AlertDialogHeader>
            <AlertDialogTitle>{plural(t, 'threadSidebarDraftsConfirmTitle', count)}</AlertDialogTitle>
            <AlertDialogDescription>{t('threadSidebarDraftsConfirmHint')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:text-sm">
            {(confirming ?? []).slice(0, NAMED_DRAFTS).map(draft => (
              <li key={draft.id} className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2">
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{draft.displayTitle}</span>
                <span className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">{formatAge(draft.updatedAt)}</span>
              </li>
            ))}
            {count > NAMED_DRAFTS ? (
              <li className="dshx:text-xs dshx:text-muted-foreground">{plural(t, 'threadSidebarDraftsConfirmMore', count - NAMED_DRAFTS)}</li>
            ) : null}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('threadSidebarCancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!props.cleanable}
              onClick={() => {
                const ids = (confirming ?? []).map(draft => draft.id)
                setConfirming(null)
                props.onConfirm(ids)
              }}
            >
              {plural(t, 'threadSidebarDraftsConfirmAction', count)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

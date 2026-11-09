import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChevronDownIcon, GitMergeIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useState } from 'react'
import type { ThreadRevisionView } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'

const titleLine = (revision: ThreadRevisionView): string => revision.description.split('\n')[0] ?? ''

/**
 * The turn-end land offer: one click to land the answer's work, and the exact revisions that click moves, so the
 * user never lands blind. The list opens in place instead of in a tooltip or hovering layer: a large thread can hold
 * dozens of revisions, and a list that scrolls stays readable and reachable from the keyboard.
 */
export const LandPreview = (props: {
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly revisions: readonly ThreadRevisionView[]
  readonly landing: boolean
  readonly pending: boolean
  readonly onLand: () => void
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  const listId = useId()

  return (
    <div
      className="dshx-root dshx:my-3 dshx:flex dshx:w-full dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/40 dshx:px-3 dshx:py-2"
      data-testid="jj-inline-integrate-offer"
    >
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <GitMergeIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
        <button
          aria-controls={listId}
          aria-expanded={open}
          className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:cursor-pointer dshx:items-center dshx:gap-1 dshx:rounded-sm dshx:text-left dshx:text-sm dshx:text-muted-foreground dshx:hover:text-foreground dshx:focus-visible:outline-2 dshx:focus-visible:outline-offset-2 dshx:focus-visible:outline-ring"
          onClick={() => setOpen(current => !current)}
          type="button"
        >
          <span className="dshx:min-w-0">{props.t('inlineIntegrateHint', { count: props.revisions.length, bookmark: props.bookmark })}</span>
          <span className="dshx:sr-only">{props.t(open ? 'inlineIntegrateHideDetails' : 'inlineIntegrateShowDetails')}</span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn('dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground dshx:transition-transform', open && 'dshx:rotate-180')}
          />
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={props.t('rebaseOnto', { bookmark: props.bookmark })}
              className="dshx-root dshx:shrink"
              disabled={props.landing}
              onClick={props.onLand}
              size="sm"
              type="button"
            >
              {props.pending ? <Spinner /> : <GitMergeIcon aria-hidden="true" className="dshx:size-3.5" />}
              {props.pending ? props.t('rebasing') : props.t('rebaseOnto', { bookmark: props.bookmark })}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{props.t('rebaseThread', { bookmark: props.bookmark })}</TooltipContent>
        </Tooltip>
      </div>
      {open ? (
        <ul
          id={listId}
          aria-label={props.t('inlineIntegrateDetails', { bookmark: props.bookmark })}
          className="dshx:flex dshx:max-h-56 dshx:animate-in dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:border-t dshx:border-border dshx:pt-2 dshx:pl-6 dshx:fade-in-0"
        >
          {props.revisions.map(revision => (
            <li key={revision.commitId} className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2 dshx:py-0.5">
              <span className="dshx:shrink-0 dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{revision.changeId.slice(0, 8)}</span>
              <span className="dshx:line-clamp-2 dshx:min-w-0 dshx:flex-1 dshx:text-xs dshx:break-words">{titleLine(revision)}</span>
              {revision.conflict ? <Badge variant="destructive">{props.t('conflict')}</Badge> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChevronDownIcon, GitMergeIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useRef, useState } from 'react'
import type { ThreadRevisionView } from './api.js'
import { LandConfirmDialog } from './land-confirm-dialog.js'
import type { JjIntegrationTranslate } from './locales.js'

const titleLine = (revision: ThreadRevisionView): string => revision.description.split('\n')[0] ?? ''

/**
 * The turn-end land offer: the answer's work and the exact revisions it would move, so the user never lands blind.
 * Land asks the header's question first (round two item 18: every Land asks the same question). The list opens in place instead of in a tooltip or hovering layer: a large thread can hold
 * dozens of revisions, and a list that scrolls stays readable and reachable from the keyboard.
 *
 * Round three item 27: while the thread header shows its Land, this offer keeps its sentence and list and drops its own
 * button, so the screen has one Land and the answer is not followed by a second copy of the header's verb.
 */
export const LandPreview = (props: {
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly revisions: readonly ThreadRevisionView[]
  readonly landing: boolean
  readonly pending: boolean
  readonly onLand: () => void
  /** The thread header shows a Land for this thread right now. */
  readonly headerLandShown?: boolean | undefined
  /** The thread whose composer takes focus after a confirmed Land. */
  readonly sessionId?: string | undefined
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const listId = useId()
  const landButton = useRef<HTMLButtonElement>(null)
  const offersLand = props.headerLandShown !== true

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
          <span className="dshx:min-w-0">{props.t(props.revisions.length === 1 ? 'inlineIntegrateHintOne' : 'inlineIntegrateHintMany', { count: props.revisions.length, bookmark: props.bookmark })}</span>
          <span className="dshx:sr-only">{props.t(open ? 'inlineIntegrateHideDetails' : 'inlineIntegrateShowDetails')}</span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn('dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground dshx:transition-transform', open && 'dshx:rotate-180')}
          />
        </button>
        {offersLand ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={props.t('rebaseOnto', { bookmark: props.bookmark })}
                className="dshx-root dshx:shrink"
                disabled={props.landing}
                onClick={() => setConfirming(true)}
                ref={landButton}
                size="sm"
                type="button"
                // Shown only when no header Land is on screen; it asks the header's question.
                variant="outline"
              >
                {props.pending ? <Spinner /> : <GitMergeIcon aria-hidden="true" className="dshx:size-3.5" />}
                {props.pending ? props.t('rebasing') : props.t('rebaseOnto', { bookmark: props.bookmark })}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{props.t('rebaseThread', { bookmark: props.bookmark })}</TooltipContent>
          </Tooltip>
        ) : null}
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
      {offersLand ? (
        <LandConfirmDialog
          bookmark={props.bookmark}
          onConfirm={props.onLand}
          onOpenChange={setConfirming}
          open={confirming && props.revisions.length > 0}
          revisions={props.revisions}
          sessionId={props.sessionId}
          t={props.t}
          trigger={() => landButton.current}
        />
      ) : null}
    </div>
  )
}

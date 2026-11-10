import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { InlineReferenceScope, InlineReferenceText } from '@dshfiles/chat/inline-references'
import { useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { GitCommitHorizontal, RotateCcw } from '@dshfiles/plugin-ui/icons'
import type { SessionUndoKey } from './locales.js'
import { lastIndexOf, useRewindFlow, useUndoHistory } from './rewind-flow.js'
import { sessionUndoSettings } from './settings.js'

/** Long enough to stay unique in any repository jj shows, short enough for the action row. */
const SHORT_ID = 12

/**
 * A finished turn's checkpoint in its action row: the jj revision its edits left (a `jj:` reference the Jujutsu panel
 * opens) and, when a later turn exists, Restore, which rewinds to the start of the next recorded turn — the files and
 * conversation as this turn left them.
 */
export const TurnCheckpoint = (props: {
  readonly sessionId: string
  readonly turn: number
  readonly openSession: (sessionId: string) => void
  readonly t: Translate<SessionUndoKey>
}): JSX.Element | null => {
  const enabled = useSettings(sessionUndoSettings).value?.turnRevisions !== false
  const history = useUndoHistory(props.sessionId)
  const flow = useRewindFlow(props)
  const checkpoints = history.data?.checkpoints ?? []
  const index = lastIndexOf(checkpoints, props.turn)
  const revision = checkpoints[index]?.revision
  if (!enabled || index === -1 || revision === undefined) return null
  const next = checkpoints[index + 1]
  return (
    <TooltipProvider>
      <span className="dshx-root dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:text-xs" data-session-undo-checkpoint={props.turn}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:text-muted-foreground">
              <GitCommitHorizontal aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
              <code className="dshx:min-w-0 dshx:truncate" data-session-undo-revision={revision.commitId}>
                {/* This bundle carries its own copy of the scope context, so it names the thread itself. */}
                <InlineReferenceScope cwd={undefined} sessionId={props.sessionId}>
                  <InlineReferenceText surface="code" text={`jj:${revision.commitId.slice(0, SHORT_ID)}`} />
                </InlineReferenceScope>
              </code>
            </span>
          </TooltipTrigger>
          <TooltipContent>{props.t('turnRevision', { turn: props.turn })}</TooltipContent>
        </Tooltip>
        {next === undefined ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={props.t('restoreHere')}
                className="dshx:text-muted-foreground dshx:hover:text-foreground"
                data-session-undo="restore-turn"
                disabled={flow.pending}
                onClick={() => flow.confirmRewind(next.turn)}
                size="icon-xs"
                variant="ghost"
              >
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{flow.failure ?? props.t('restoreHere')}</TooltipContent>
          </Tooltip>
        )}
      </span>
      {flow.dialog}
    </TooltipProvider>
  )
}

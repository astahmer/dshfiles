import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { InlineReferenceScope, InlineReferenceText } from '@dshfiles/chat/inline-references'
import { useSettings } from '@dshfiles/dshx/client'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { GitCommitHorizontal, RotateCcw } from '@dshfiles/plugin-ui/icons'
import type { SessionUndoKey } from './locales.js'
import { lastIndexOf, useRewindFlow, useUndoHistory } from './rewind-flow.js'
import { sessionUndoSettings } from './settings.js'

/** A change id prefix as `jj log` shortens it: enough to name the revision, short enough for a muted menu detail. */
const SHORT_CHANGE = 8

/**
 * A finished turn's checkpoint, a row of its reply's `⋯` menu (b:ysaj): Restore, which rewinds to the start of the next
 * recorded turn — the files and thread as this turn left them — with the revision its edits left as a muted change name
 * (a `jj:` reference the Jujutsu panel opens). The last turn has nothing to restore to, so only the change name shows.
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
  const change = (
    <span className="dshx:ml-auto dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground" data-session-undo-revision={revision.commitId}>
      {/* This bundle carries its own copy of the scope context, so it names the thread itself. */}
      <InlineReferenceScope cwd={undefined} sessionId={props.sessionId}>
        <InlineReferenceText surface="code" text={`jj:${revision.changeId.slice(0, SHORT_CHANGE)}`} />
      </InlineReferenceScope>
    </span>
  )
  return (
    <TooltipProvider>
      <span className="dshx-root dshx:flex dshx:min-w-0 dshx:flex-col" data-session-undo-checkpoint={props.turn}>
        {next === undefined ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="dshx:flex dshx:min-h-8 dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:px-2 dshx:text-sm dshx:text-muted-foreground dshx:pointer-coarse:min-h-11"
                tabIndex={0}
              >
                <GitCommitHorizontal aria-hidden className="dshx:size-4 dshx:shrink-0" />
                <span className="dshx:truncate">{props.t('turnRevisionShort')}</span>
                {change}
              </span>
            </TooltipTrigger>
            <TooltipContent>{props.t('turnRevision', { turn: props.turn })}</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={props.t('restoreHere')}
                className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm"
                data-session-undo="restore-turn"
                disabled={flow.pending}
                onClick={() => flow.confirmRewind(next.turn)}
              >
                <RotateCcw aria-hidden className="dshx:size-4 dshx:shrink-0" />
                <span className="dshx:truncate">{props.t('restoreHereShort')}</span>
                {change}
              </button>
            </TooltipTrigger>
            <TooltipContent>{flow.failure ?? props.t('turnRevision', { turn: props.turn })}</TooltipContent>
          </Tooltip>
        )}
        {flow.failure === null ? null : (
          <span className="dshx:px-2 dshx:pb-1 dshx:text-xs dshx:text-destructive" role="alert">
            {flow.failure}
          </span>
        )}
      </span>
      {flow.dialog}
    </TooltipProvider>
  )
}

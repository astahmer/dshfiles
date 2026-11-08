import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { RotateCcwIcon, WrenchIcon } from '@dshfiles/plugin-ui/icons'
import type { ReactNode } from 'react'
import { Failure, type FailureFacts } from './failure.js'

export interface FailureComposer {
  /** Replace the draft and focus the composer; false when no composer can take it. */
  readonly retry: (text: string) => boolean
  /** Insert into the draft and focus the composer. */
  readonly askToFix: (text: string) => boolean
}

/**
 * The bar under a native failure row: retry count, and two actions that write into the composer for the user to send.
 * Its left edge (18px: the row's 10px dot plus 8px gap) lines up with the error text and the row's own actions.
 * Neither sends on its own: the user reviews the text first, the same contract `test-runs` uses for "Ask to fix".
 */
export const FailureActions = (props: {
  readonly facts: FailureFacts
  readonly composer: FailureComposer | undefined
  readonly actions: boolean
}): ReactNode => {
  const retry = Failure.retryLabel(props.facts)
  const actionable = props.actions && props.composer !== undefined && Failure.actionable(props.facts)
  if (retry === undefined && !actionable) return null
  return (
    <div
      className="dshx-root dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:py-1 dshx:pl-[18px] dshx:text-xs dshx:text-muted-foreground"
      data-dshfiles-agent-failure={props.facts.kind}
    >
      {retry !== undefined && (
        <span className="dshx:shrink-0 dshx:tabular-nums">
          {retry}
          {props.facts.provider === undefined ? '' : ` · ${props.facts.provider}`}
          {props.facts.retryState === 'cancelled' ? ' · gave up' : ''}
        </span>
      )}
      {actionable && props.composer !== undefined && (
        <>
          <Button onClick={() => props.composer?.retry(Failure.retryPrompt())} size="xs" type="button" variant="outline">
            <RotateCcwIcon aria-hidden />
            Retry
          </Button>
          <Button onClick={() => props.composer?.askToFix(Failure.fixPrompt(props.facts))} size="xs" type="button" variant="outline">
            <WrenchIcon aria-hidden />
            Ask to fix
          </Button>
          <span className="dshx:min-w-0 dshx:truncate">Puts a message in the composer for you to send.</span>
        </>
      )}
    </div>
  )
}

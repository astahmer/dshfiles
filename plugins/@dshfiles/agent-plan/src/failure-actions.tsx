import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { WrenchIcon } from '@dshfiles/plugin-ui/icons'
import type { ReactNode } from 'react'
import { Failure, type FailureFacts } from './failure.js'

export interface FailureComposer {
  /** Insert into the draft and focus the composer; false when no composer can take it. */
  readonly askToFix: (text: string) => boolean
}

/**
 * "Ask to fix" in the failure card's one row of actions, beside the card's own Retry. It writes a request into the
 * composer and does not send it: the user reviews the text first, the same contract `test-runs` uses for "Ask to fix".
 * A stopped turn, or a thread with no composer to write into, gets no button.
 */
export const AskToFix = (props: { readonly facts: FailureFacts; readonly composer: FailureComposer | undefined }): ReactNode => {
  const composer = props.composer
  if (composer === undefined || !Failure.actionable(props.facts)) return null
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="dshx-root"
            data-dshfiles-agent-failure="turn-error"
            onClick={() => composer.askToFix(Failure.fixPrompt(props.facts))}
            size="sm"
            type="button"
            variant="outline"
          >
            <WrenchIcon aria-hidden />
            Ask to fix
          </Button>
        </TooltipTrigger>
        <TooltipContent>Writes a request in the composer for you to review and send</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

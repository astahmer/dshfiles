import type { JSX } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { BacklogActivityReferences } from './activity-thread-reference.js'

/**
 * One activity line with its thread reference as a link. An anchor, not a button: a button lays out as an
 * inline-block box even under `display: inline`, so a long title wrapped inside its own centred block.
 */
export const ActivityDescription = (props: {
  readonly description: string
  readonly threadId: string | undefined
  readonly threadLabel: (sessionId: string) => string
  readonly openThread: (sessionId: string) => void
}): JSX.Element => {
  const description = props.description
  const threadId = props.threadId
  if (threadId === undefined) return <>{description}</>
  const reference = BacklogActivityReferences.threadReferenceRange(description, threadId)
  if (reference === undefined) return <>{description}</>
  const label = props.threadLabel(threadId)
  const text = reference.text.startsWith('thread:')
    ? `the thread “${label}”`
    : `${reference.text.toLowerCase().startsWith('a ') ? 'a' : 'the'} thread “${label}”`
  return (
    <>
      {description.slice(0, reference.start)}
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={`?thread=${encodeURIComponent(threadId)}`}
            className="dshx:font-medium dshx:text-info dshx:underline dshx:underline-offset-2 dshx:hover:text-foreground"
            onClick={event => {
              event.preventDefault()
              props.openThread(threadId)
            }}
          >
            {text}
          </a>
        </TooltipTrigger>
        <TooltipContent>{`Open thread ${label}`}</TooltipContent>
      </Tooltip>
      {description.slice(reference.end)}
    </>
  )
}

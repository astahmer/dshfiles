import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { JSX } from 'react'

import { actorName } from './actor-name.js'

/**
 * The actor of one activity line, linking to the thread it worked in. A reader seeing "Agent 077d59 asked for your
 * input" wants that conversation, and the actor is the only thread reference such a line carries.
 */
export const ActorThreadLink = (props: {
  readonly actorId: string | undefined
  readonly openThread: (sessionId: string) => void
  readonly className?: string
}): JSX.Element => {
  const name = actorName(props.actorId)
  const sessionId = props.actorId?.startsWith('agent:') === true ? props.actorId.slice('agent:'.length) : ''
  if (sessionId === '' || sessionId === 'unknown') return <span className={props.className}>{name}</span>
  return (
    <a
      href={`?thread=${encodeURIComponent(sessionId)}`}
      aria-label={`Open the thread of ${name}`}
      className={cn(
        'dshx:font-medium dshx:text-info dshx:decoration-info/40 dshx:underline-offset-2 dshx:hover:underline dshx:hover:text-foreground',
        props.className,
      )}
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        props.openThread(sessionId)
      }}
    >
      {name}
    </a>
  )
}

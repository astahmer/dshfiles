import { MessagesSquareIcon } from '@dshfiles/plugin-ui/icons'

import { BacklogActivityReferences } from './activity-thread-reference.js'

/** One chip per linked thread, named so two links never read as the same anonymous "Open thread". */
export const LinkedThreadChips = (props: {
  readonly sessionIds: readonly string[]
  readonly threadTitle: (sessionId: string) => string | undefined
  readonly openThread: (sessionId: string) => void
}): JSX.Element => {
  const titles = props.sessionIds.map(sessionId => props.threadTitle(sessionId))
  return (
    <>
      {props.sessionIds.map((sessionId, index) => {
        const title = titles[index]
        const label = BacklogActivityReferences.threadLabelOf({
          title,
          sessionId,
          duplicateTitle: title !== undefined && titles.filter(other => other === title).length > 1,
        })
        return (
          <button
            key={sessionId}
            type="button"
            aria-label={`Open thread ${label}`}
            onClick={event => {
              event.stopPropagation()
              props.openThread(sessionId)
            }}
            className="dshx:inline-flex dshx:min-w-0 dshx:max-w-56 dshx:items-center dshx:gap-1 dshx:font-medium dshx:text-foreground dshx:hover:underline"
          >
            <MessagesSquareIcon aria-hidden className="dshx:size-3 dshx:shrink-0" />
            <span className="dshx:min-w-0 dshx:truncate">{label}</span>
          </button>
        )
      })}
    </>
  )
}

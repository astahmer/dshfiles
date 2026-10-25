import type { ChatTurnActionExtras } from '@dshfiles/chat/chat-focus'
import { ActivityIcon } from '@dshfiles/plugin-ui/icons'
import type { TracesTranslate } from './locales.js'
import { ThreadLinks } from './thread-links.js'

/**
 * A completed-Turn action (`conversation.chat.assistant-actions`): opens the thread's Traces tab on this turn's trace through the
 * native View opener the Chat fork hands its action row. Without that opener (a detached transcript, the stock Chat
 * row) it renders nothing.
 */
export const TurnTraceButton = (props: {
  readonly turn: number
  readonly openView: ChatTurnActionExtras['openView']
  readonly t: TracesTranslate
}): JSX.Element | null => {
  const openView = props.openView
  if (openView === undefined) return null
  return (
    <div className="dshx-root dshx:flex dshx:text-xs" data-dshfiles-turn-trace={props.turn}>
      <button
        type="button"
        className="dshx:flex dshx:items-center dshx:gap-1 dshx:rounded dshx:text-muted-foreground dshx:hover:text-foreground dshx:focus-visible:outline-2 dshx:focus-visible:outline-ring"
        aria-label={props.t('turnTraceLabel', { turn: props.turn })}
        onClick={() => openView(ThreadLinks.viewId, ThreadLinks.encodeFocus({ turn: props.turn }))}
      >
        <ActivityIcon className="dshx:size-3.5 dshx:shrink-0" />
        {props.t('turnTrace')}
      </button>
    </div>
  )
}

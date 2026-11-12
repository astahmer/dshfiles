import type {} from '@dshfiles/workbench/conversation-header'
import type { FactoryComponentPropsOf, SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

/** Keep the original header and every contributed action behind its sole declarer. */
export const ConversationHeaderSurface = ({
  renderSlot,
  reserveHostCorner,
  seated,
}: Pick<FactoryComponentPropsOf<'dshfiles.workbench.conversation-header'>, 'renderSlot' | 'reserveHostCorner' | 'seated'>) => {
  const header = renderSlot('conversation.header', {})
  // In a Workbench group's tab row (one header row, visual refresh T1.4): the header fills the row's free space as a
  // borderless band; ConversationRoot.module.css reads this marker.
  if (seated === true)
    return (
      <div data-conversation-header-seated="" className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center">
        {header}
      </div>
    )
  // The presentation host owns its recovery control; leave that corner clear
  // without changing native header internals or moving any contributed action.
  return reserveHostCorner ? <div className="dshx:min-w-0 dshx:shrink-0 dshx:pr-8">{header}</div> : header
}

/** Composition-root registration shared by native and fixed Workbench occurrences. */
export const registerConversationHeaderSurface = (slots: Pick<SlotCore, 'registerFactory'>): (() => void) =>
  slots.registerFactory(
    {
      name: 'dshfiles.workbench.conversation-header',
      scope: 'session-maybe',
      children: { 'conversation.header': { kind: 'single', scope: 'session-maybe' } },
    },
    ConversationHeaderSurface,
  )

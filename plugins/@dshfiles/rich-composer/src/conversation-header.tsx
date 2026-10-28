import type {} from '@dshfiles/workbench/conversation-header'
import type { FactoryComponentPropsOf, SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

/** Keep the original header and every contributed action behind its sole declarer. */
export const ConversationHeaderSurface = ({
  renderSlot,
  reserveHostCorner,
}: Pick<FactoryComponentPropsOf<'dshfiles.workbench.conversation-header'>, 'renderSlot' | 'reserveHostCorner'>) => {
  const header = renderSlot('conversation.header', {})
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

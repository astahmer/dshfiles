import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import { THREAD_ASIDE_CONVERSATION_SLOT } from './thread-aside.js'

/** Fixed chat selection used by an aside's embedded Conversation occurrence. */
const FixedChatView = (props: ConversationViewsProps): ReactNode => props.renderSlot('conversation.session', { view: 'chat' })

/** Render the shared Conversation content for the aside's thread, as the native subagent chat does. */
export const ThreadAsideConversation = (props: PropsRuntime<typeof THREAD_ASIDE_CONVERSATION_SLOT> & PropsRenderFactories): ReactNode =>
  props.renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: FixedChatView } })

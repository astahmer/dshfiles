import type { ConversationLocationDataSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useMemo, useSyncExternalStore } from 'react'
import type { LiveActivity } from './live-activity.js'
import type { PlanWrite } from './plan-progress.js'

/** Per-Session readers of this plugin's two Conversation view targets. */
export interface AgentTargets<SessionId> {
  readonly plan: (sessionId: SessionId) => ConversationLocationDataSource<readonly PlanWrite[] | undefined>
  readonly activity: (sessionId: SessionId) => ConversationLocationDataSource<LiveActivity | undefined>
}

const NONE: ConversationLocationDataSource<undefined> = { getSnapshot: () => undefined, subscribe: () => () => {} }

/**
 * Bind the readers to `ctx.uiConversation`. A Session the Conversation service does not know yet (or no longer) reads
 * as empty instead of throwing, so a card renders its native fallback.
 */
export const agentTargets = <SessionId>(uiConversation: {
  binding(sessionId: SessionId): { target(target: 'dshfiles-agent-plan' | 'dshfiles-agent-activity'): ConversationLocationDataSource<unknown> }
}): AgentTargets<SessionId> => {
  const read = <Value>(sessionId: SessionId, target: 'dshfiles-agent-plan' | 'dshfiles-agent-activity'): ConversationLocationDataSource<Value | undefined> => {
    try {
      // SAFETY: ConversationViewSnapshotMap (conversation-targets.ts) types each target's snapshot as Value.
      return uiConversation.binding(sessionId).target(target) as ConversationLocationDataSource<Value | undefined>
    } catch {
      return NONE
    }
  }
  return { plan: sessionId => read(sessionId, 'dshfiles-agent-plan'), activity: sessionId => read(sessionId, 'dshfiles-agent-activity') }
}

export const useTarget = <SessionId, Value>(
  sessionId: SessionId,
  select: (sessionId: SessionId) => ConversationLocationDataSource<Value | undefined>,
): Value | undefined => {
  const source = useMemo(() => select(sessionId), [select, sessionId])
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}

import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationMatchResult, ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TurnActivity, type ToolCallRecord, type ToolResultRecord, type TurnActivitySummary } from './turn-activity.js'

export const TURN_ACTIVITY_KEY = 'dshfiles-turn-activity'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Tool work of one finished Turn, published by @dshfiles/turn-summary. */
    'dshfiles-turn-activity': TurnActivitySummary
  }
}

interface TurnActivityState {
  readonly turn: number
  readonly calls: readonly ToolCallRecord[]
  readonly results: readonly ToolResultRecord[]
  readonly closed: boolean
}

const match = (event: SessionEventLike): ConversationMatchResult | null => {
  if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
  if (event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'turn/end') return { id: String(event.data.turn), role: 'update' }
  return null
}

const firstText = (event: SessionEventLike): string | undefined => {
  if (event.type !== 'tool/result') return undefined
  const block = event.data.message.content.find(candidate => candidate.type === 'text')
  return block?.type === 'text' ? block.text : undefined
}

/**
 * A state-only Conversation Definition: it owns no view target, collects one Turn's `tool/call` and `tool/result`
 * events, and publishes their summary on the Turn once it ends, where the footer entry reads it.
 */
export const turnActivityDefinition: ConversationNodeDefinitionInput<TurnActivityState> = {
  kind: TURN_ACTIVITY_KEY,
  match: { 'turn/start': match, 'turn/end': match, 'tool/call': match, 'tool/result': match },
  start: (_context, start) => {
    if (start.event.type !== 'turn/start') throw new Error(`${TURN_ACTIVITY_KEY} starts on turn/start`)
    return { turn: start.event.data.turn, calls: [], results: [], closed: false }
  },
  update: (context, update) => {
    const event = update.event
    if (event.type === 'turn/end') return { ...context.state, closed: true }
    if (event.type === 'tool/call')
      return { ...context.state, calls: [...context.state.calls, { callId: event.data.callId, name: event.data.name, arguments: event.data.arguments }] }
    if (event.type === 'tool/result')
      return {
        ...context.state,
        results: [...context.state.results, { callId: event.data.message.toolCallId, isError: event.data.message.isError === true, text: firstText(event) }],
      }
    return context.state
  },
  publication: published => (published.event.type === 'turn/end' ? 'immediate' : 'none'),
  buildLocationData: (context, scope) => {
    const state = context.state
    if (scope !== 'turn' || state === undefined || !state.closed) return null
    return { kind: 'turn', turn: state.turn, key: TURN_ACTIVITY_KEY, value: TurnActivity.summarize(state) }
  },
}

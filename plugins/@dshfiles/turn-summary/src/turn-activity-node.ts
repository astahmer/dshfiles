import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationMatchResult, ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Option, Schema } from 'effect'
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
  /** Sequence of the turn's `workspace/changes` event, which addresses its changed-files review. */
  readonly changesSeq: number | undefined
}

const match = (event: SessionEventLike): ConversationMatchResult | null => {
  if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
  if (event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'turn/end') return { id: String(event.data.turn), role: 'update' }
  if (isWorkspaceChanges(event)) {
    const turn = turnOfChanges(event)
    return turn === undefined ? null : { id: String(turn), role: 'update' }
  }
  return null
}

/** Emitted by the Host's workspace-changes package once a top-level turn's changed files are summarized. */
const WORKSPACE_CHANGES = 'workspace/changes'
const changesDataSchema = Schema.Struct({ turn: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)) })
/** The event type comes from a Host package this plugin does not depend on, so its type is not in the event union. */
const isWorkspaceChanges = (event: SessionEventLike): boolean => {
  const type: string = event.type
  return type === WORKSPACE_CHANGES
}
const turnOfChanges = (event: SessionEventLike): number | undefined => Option.getOrUndefined(Schema.decodeUnknownOption(changesDataSchema)(event.data))?.turn

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
  match: { 'turn/start': match, 'turn/end': match, 'tool/call': match, 'tool/result': match, [WORKSPACE_CHANGES]: match },
  start: (_context, start) => {
    if (start.event.type !== 'turn/start') throw new Error(`${TURN_ACTIVITY_KEY} starts on turn/start`)
    return { turn: start.event.data.turn, calls: [], results: [], closed: false, changesSeq: undefined }
  },
  update: (context, update) => {
    const event = update.event
    if (event.type === 'turn/end') return { ...context.state, closed: true }
    if (isWorkspaceChanges(event)) return { ...context.state, changesSeq: 'seq' in event ? event.seq : undefined }
    if (event.type === 'tool/call')
      return { ...context.state, calls: [...context.state.calls, { callId: event.data.callId, name: event.data.name, arguments: event.data.arguments }] }
    if (event.type === 'tool/result')
      return {
        ...context.state,
        results: [...context.state.results, { callId: event.data.message.toolCallId, isError: event.data.message.isError === true, text: firstText(event) }],
      }
    return context.state
  },
  publication: published => (published.event.type === 'turn/end' || isWorkspaceChanges(published.event) ? 'immediate' : 'none'),
  buildLocationData: (context, scope) => {
    const state = context.state
    if (scope !== 'turn' || state === undefined || !state.closed) return null
    return { kind: 'turn', turn: state.turn, key: TURN_ACTIVITY_KEY, value: { ...TurnActivity.summarize(state), changesSeq: state.changesSeq } }
  },
}

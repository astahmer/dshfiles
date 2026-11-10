import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import type { PromptedTurnCountState } from './prompted-turn-count-types.js'

const countSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const stateSchema = Schema.Struct({
  turn: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(-1)),
  prompted: Schema.Boolean,
  count: countSchema,
})

const INITIAL_STATE: PromptedTurnCountState = { turn: -1, prompted: false, count: 0 }

const hasPromptText = (content: readonly { readonly type: string; readonly text?: string }[]): boolean =>
  content.some(block => block.type === 'text' && /\S/.test(block.text ?? ''))

/**
 * Turns opened by a human prompt, counted the way `turnOutline` marks them (a turn whose first human message carries
 * text), so a Session list can show the count without the whole outline: 163 B instead of 78.6 KB for a 158-Session
 * corpus.
 */
const applyPromptedTurnCount = (state: PromptedTurnCountState, event: SessionEvent): PromptedTurnCountState => {
  if (event.type === 'turn/start') {
    return event.data.turn <= state.turn ? state : { turn: event.data.turn, prompted: false, count: state.count }
  }
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return state
  if (state.turn < 0 || state.prompted || !hasPromptText(event.data.content)) return state
  return { turn: state.turn, prompted: true, count: state.count + 1 }
}

export const promptedTurnCountProjection = {
  key: 'promptedTurnCount',
  stateSchema: zodSchemaFromEffect(stateSchema),
  stateVersion: 1,
  init: () => INITIAL_STATE,
  apply: applyPromptedTurnCount,
  wire: { viewSchema: zodSchemaFromEffect(countSchema), view: state => state.count },
} satisfies ProjectionDefinition<'promptedTurnCount', PromptedTurnCountState>

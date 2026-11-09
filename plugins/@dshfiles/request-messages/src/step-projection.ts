import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const stepSchema = Schema.Struct({
  turn: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  step: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
})

export type RequestMessagesStep = typeof stepSchema.Type

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    dshfilesRequestMessagesStep: RequestMessagesStep | null
  }
}

/**
 * The latest `step/start` turn and step, folded by this plugin because the native `turnBoundary`
 * projection keeps only that event's seq and reading its payload back would need the deprecated
 * synchronous session event reads.
 */
export const requestMessagesStepProjectionDefinition = {
  key: 'dshfilesRequestMessagesStep',
  stateSchema: zodSchemaFromEffect(Schema.NullOr(stepSchema)),
  init: () => null,
  apply: (state, event: SessionEvent) => (event.type === 'step/start' ? { turn: event.data.turn, step: event.data.step } : state),
  stateVersion: 1,
} satisfies ProjectionDefinition<'dshfilesRequestMessagesStep', RequestMessagesStep | null>

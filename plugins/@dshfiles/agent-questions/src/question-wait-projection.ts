import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-llm'
import { isTimedAskUserQuestionSchema } from '@deepseek-ai/dsh-user-questions'
import { Schema } from 'effect'
import { z } from 'zod'

const maximumTimeoutSeconds = 2_147_483

const boundedString = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const questionWaitRecordSchema = Schema.Struct({
  callId: boundedString(1, 256),
  waitMode: Schema.Literals(['blocking', 'timed', 'unknown']),
  startedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  timeoutMs: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
  deadlineAt: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
})

const questionWaitStateSchema = Schema.Struct({
  timedToolConfigured: Schema.Boolean,
  defaultTimeoutSeconds: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: -1, maximum: maximumTimeoutSeconds }))),
  active: Schema.Array(questionWaitRecordSchema),
})

const questionWaitViewSchema = Schema.Struct({ active: Schema.Array(questionWaitRecordSchema) })

export type QuestionWaitRecord = typeof questionWaitRecordSchema.Type
export type QuestionWaitState = typeof questionWaitStateSchema.Type
export type QuestionWaitView = typeof questionWaitViewSchema.Type

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    dshfilesQuestionWaits: QuestionWaitView
  }

  interface SessionProjectionStateMap {
    dshfilesQuestionWaits: QuestionWaitState
  }
}

const timedParameterSchema = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  default: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: -1, maximum: maximumTimeoutSeconds }))),
})
const toolParametersSchema = Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) })
const toolArgumentsSchema = Schema.Struct({ timeout: Schema.optionalKey(Schema.Number.check(Schema.isInt())) })
const decodePreserving = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S['Type'] | undefined => {
  try {
    return Schema.decodeUnknownSync(schema, { onExcessProperty: 'ignore' })(value)
  } catch {
    return undefined
  }
}
const decodeJsonText = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, text: string): S['Type'] | undefined => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  return decodePreserving(schema, value)
}

const pendingResultSchema = Schema.Struct({ pending: Schema.Literal(true) })
const userQuestionReplySourceSchema = Schema.Struct({ kind: Schema.Literal('user-question-reply'), callId: Schema.String })
const projectionCompatibilitySchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  z.custom<S['Type']>(value => {
    try {
      Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value)
      return true
    } catch {
      return false
    }
  })

export const defaultTimeoutFromDescription = (description: string | undefined): number | null => {
  if (description === undefined) return null
  const match = description.match(/\bdefault\s+(-?\d+)\b/i)
  if (match?.[1] === undefined) return null
  const timeout = Number(match[1])
  if (!Number.isSafeInteger(timeout) || (timeout !== -1 && (timeout < 1 || timeout > maximumTimeoutSeconds))) return null
  return timeout
}

type TimeoutSettings =
  | { readonly waitMode: 'unknown'; readonly timeoutMs: null }
  | { readonly waitMode: 'blocking'; readonly timeoutMs: null }
  | { readonly waitMode: 'timed'; readonly timeoutMs: number }

const unknownTimeoutSettings: TimeoutSettings = { waitMode: 'unknown', timeoutMs: null }

const timeoutSettings = (input: { readonly argumentsText: string; readonly defaultTimeoutSeconds: number | null }): TimeoutSettings => {
  const parsed = decodeJsonText(toolArgumentsSchema, input.argumentsText)
  if (parsed === undefined) return unknownTimeoutSettings
  const timeoutSeconds = parsed.timeout ?? input.defaultTimeoutSeconds
  if (timeoutSeconds === null || timeoutSeconds === undefined) return unknownTimeoutSettings
  if (timeoutSeconds === -1) return { waitMode: 'blocking', timeoutMs: null }
  if (timeoutSeconds < 1 || timeoutSeconds > maximumTimeoutSeconds) return unknownTimeoutSettings
  return { waitMode: 'timed', timeoutMs: timeoutSeconds * 1_000 }
}

const isPendingResult = (content: readonly { readonly type: string; readonly text?: string }[]): boolean => {
  const textBlock = content.find(block => block.type === 'text')
  if (textBlock?.text === undefined) return false
  return decodeJsonText(pendingResultSchema, textBlock.text) !== undefined
}

const upsertWait = (input: { readonly active: readonly QuestionWaitRecord[]; readonly record: QuestionWaitRecord }): QuestionWaitRecord[] => [
  ...input.active.filter(record => record.callId !== input.record.callId),
  input.record,
]

export const applyQuestionWaitEvent = (state: QuestionWaitState, event: SessionEvent): QuestionWaitState => {
  if (event.type === 'request/header') {
    const tool = event.data.header.tools?.find(candidate => candidate.name === 'ask_user_question')
    const parsedParameters = decodePreserving(toolParametersSchema, tool?.parameters)
    const timeoutParameter = parsedParameters?.properties.timeout
    if (tool === undefined || !isTimedAskUserQuestionSchema(tool) || timeoutParameter === undefined) {
      return state.timedToolConfigured || state.defaultTimeoutSeconds !== null ? { ...state, timedToolConfigured: false, defaultTimeoutSeconds: null } : state
    }

    const parsedParameter = decodePreserving(timedParameterSchema, timeoutParameter)
    return {
      ...state,
      timedToolConfigured: true,
      defaultTimeoutSeconds: parsedParameter === undefined ? null : (parsedParameter.default ?? defaultTimeoutFromDescription(parsedParameter.description)),
    }
  }

  if (event.type === 'tool/call' && state.timedToolConfigured && event.data.name === 'ask_user_question') {
    const timeout = timeoutSettings({ argumentsText: event.data.arguments, defaultTimeoutSeconds: state.defaultTimeoutSeconds })
    const timeoutMs = timeout.timeoutMs
    return {
      ...state,
      active: upsertWait({
        active: state.active,
        record: {
          callId: event.data.callId,
          waitMode: timeout.waitMode,
          startedAt: event.time,
          timeoutMs,
          deadlineAt: timeoutMs === null ? null : event.time + timeoutMs,
        },
      }),
    }
  }

  if (event.type === 'tool/result') {
    const callId = event.data.message.toolCallId
    const active = state.active.find(record => record.callId === callId)
    if (active === undefined) return state
    if (event.data.error?.code === 'TOOL_OUTCOME_UNKNOWN' || isPendingResult(event.data.message.content)) return state
    return { ...state, active: state.active.filter(record => record.callId !== callId) }
  }

  if (event.type === 'tool/ptc-dispatch') {
    if (event.data.name !== 'ask_user_question' || event.data.isError || !isPendingResult(event.data.content)) return state
    return {
      ...state,
      active: upsertWait({
        active: state.active,
        record: {
          callId: event.data.subCallId,
          waitMode: 'unknown',
          startedAt: event.time,
          timeoutMs: null,
          deadlineAt: null,
        },
      }),
    }
  }

  if (event.type === 'user/message') {
    const source = decodePreserving(userQuestionReplySourceSchema, event.data.source)
    if (source === undefined) return state
    return { ...state, active: state.active.filter(record => record.callId !== source.callId) }
  }

  return state
}

export const questionWaitProjectionDefinition = {
  key: 'dshfilesQuestionWaits',
  stateSchema: projectionCompatibilitySchema(questionWaitStateSchema),
  init: () => ({ timedToolConfigured: false, defaultTimeoutSeconds: null, active: [] }),
  apply: applyQuestionWaitEvent,
  wire: {
    viewSchema: projectionCompatibilitySchema(questionWaitViewSchema),
    view: (state: QuestionWaitState) => ({ active: state.active }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'dshfilesQuestionWaits', QuestionWaitState>

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-llm'
import { isTimedAskUserQuestionSchema } from '@deepseek-ai/dsh-user-questions'
import { z } from 'zod'

const maximumTimeoutSeconds = 2_147_483

const questionWaitRecordSchema = z
  .object({
    callId: z.string().min(1).max(256),
    waitMode: z.enum(['blocking', 'timed', 'unknown']),
    startedAt: z.number().int().nonnegative(),
    timeoutMs: z.number().int().positive().nullable(),
    deadlineAt: z.number().int().nonnegative().nullable(),
  })
  .strict()

const questionWaitStateSchema = z
  .object({
    timedToolConfigured: z.boolean(),
    defaultTimeoutSeconds: z.number().int().min(-1).max(maximumTimeoutSeconds).nullable(),
    active: z.array(questionWaitRecordSchema),
  })
  .strict()

const questionWaitViewSchema = z.object({ active: z.array(questionWaitRecordSchema) }).strict()

export type QuestionWaitRecord = z.infer<typeof questionWaitRecordSchema>
export type QuestionWaitState = z.infer<typeof questionWaitStateSchema>
export type QuestionWaitView = z.infer<typeof questionWaitViewSchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    dshfilesQuestionWaits: QuestionWaitView
  }

  interface SessionProjectionStateMap {
    dshfilesQuestionWaits: QuestionWaitState
  }
}

const timedParameterSchema = z
  .object({
    description: z.string().optional(),
    default: z.number().int().min(-1).max(maximumTimeoutSeconds).optional(),
  })
  .passthrough()
const toolParametersSchema = z.object({ properties: z.record(z.string(), z.unknown()) }).passthrough()

const toolArgumentsSchema = z.object({ timeout: z.number().int().optional() }).passthrough()
const decodeJsonText = <Schema extends z.ZodType>(schema: Schema, text: string): z.ZodSafeParseResult<z.output<Schema>> | undefined => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  return schema.safeParse(value)
}

const pendingResultSchema = z.object({ pending: z.literal(true) }).passthrough()
const userQuestionReplySourceSchema = z.object({ kind: z.literal('user-question-reply'), callId: z.string() }).passthrough()

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
  if (parsed?.success !== true) return unknownTimeoutSettings
  const timeoutSeconds = parsed.data.timeout ?? input.defaultTimeoutSeconds
  if (timeoutSeconds === null || timeoutSeconds === undefined) return unknownTimeoutSettings
  if (timeoutSeconds === -1) return { waitMode: 'blocking', timeoutMs: null }
  if (timeoutSeconds < 1 || timeoutSeconds > maximumTimeoutSeconds) return unknownTimeoutSettings
  return { waitMode: 'timed', timeoutMs: timeoutSeconds * 1_000 }
}

const isPendingResult = (content: readonly { readonly type: string; readonly text?: string }[]): boolean => {
  const textBlock = content.find(block => block.type === 'text')
  if (textBlock?.text === undefined) return false
  return decodeJsonText(pendingResultSchema, textBlock.text)?.success === true
}

const upsertWait = (input: { readonly active: readonly QuestionWaitRecord[]; readonly record: QuestionWaitRecord }): QuestionWaitRecord[] => [
  ...input.active.filter(record => record.callId !== input.record.callId),
  input.record,
]

export const applyQuestionWaitEvent = (state: QuestionWaitState, event: SessionEvent): QuestionWaitState => {
  if (event.type === 'request/header') {
    const tool = event.data.header.tools?.find(candidate => candidate.name === 'ask_user_question')
    const parsedParameters = toolParametersSchema.safeParse(tool?.parameters)
    const timeoutParameter = parsedParameters.success ? parsedParameters.data.properties.timeout : undefined
    if (tool === undefined || !isTimedAskUserQuestionSchema(tool) || timeoutParameter === undefined) {
      return state.timedToolConfigured || state.defaultTimeoutSeconds !== null ? { ...state, timedToolConfigured: false, defaultTimeoutSeconds: null } : state
    }

    const parsedParameter = timedParameterSchema.safeParse(timeoutParameter)
    return {
      ...state,
      timedToolConfigured: true,
      defaultTimeoutSeconds: parsedParameter.success ? (parsedParameter.data.default ?? defaultTimeoutFromDescription(parsedParameter.data.description)) : null,
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
    const source = userQuestionReplySourceSchema.safeParse(event.data.source)
    if (!source.success) return state
    return { ...state, active: state.active.filter(record => record.callId !== source.data.callId) }
  }

  return state
}

export const questionWaitProjectionDefinition = {
  key: 'dshfilesQuestionWaits',
  stateSchema: questionWaitStateSchema,
  init: () => ({ timedToolConfigured: false, defaultTimeoutSeconds: null, active: [] }),
  apply: applyQuestionWaitEvent,
  wire: {
    viewSchema: questionWaitViewSchema,
    view: (state: QuestionWaitState) => ({ active: state.active }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'dshfilesQuestionWaits', QuestionWaitState>

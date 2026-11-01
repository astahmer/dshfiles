import * as Schema from 'effect/Schema'
import { MultiHostSchema } from './schema.js'
import type { ModelSelection, TranscriptEntry } from './api.js'

const eventSchema = Schema.Struct({ type: Schema.String, seq: Schema.Number.check(Schema.isFinite(), Schema.isInt()), data: Schema.Unknown }).pipe(MultiHostSchema.passthrough)
const recordSchema = Schema.Struct({ type: Schema.Literal('event'), event: eventSchema }).pipe(MultiHostSchema.passthrough)
const textBlockSchema = Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String), name: Schema.optional(Schema.String) }).pipe(MultiHostSchema.passthrough)
const messageSchema = Schema.Struct({ content: Schema.optional(Schema.Array(textBlockSchema).check(Schema.isMaxLength(512))) }).pipe(MultiHostSchema.passthrough)
const userMessageSchema = Schema.Struct({
  content: Schema.optional(Schema.Array(textBlockSchema).check(Schema.isMaxLength(512))),
  source: Schema.optional(Schema.Struct({ kind: Schema.String }).pipe(MultiHostSchema.passthrough)),
}).pipe(MultiHostSchema.passthrough)
const assistantSchema = Schema.Struct({ message: messageSchema }).pipe(MultiHostSchema.passthrough)
const toolCallSchema = Schema.Struct({ callId: Schema.String, name: Schema.String, arguments: Schema.optional(Schema.String) }).pipe(MultiHostSchema.passthrough)
const toolArgumentsSchema = Schema.Struct({
  command: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
}).pipe(MultiHostSchema.passthrough)
const toolResultSchema = Schema.Struct({
  message: Schema.Struct({ toolCallId: Schema.String, isError: Schema.optional(Schema.Boolean), content: Schema.optional(Schema.Array(textBlockSchema)) }).pipe(
    MultiHostSchema.passthrough,
  ),
}).pipe(MultiHostSchema.passthrough)
const turnEndSchema = Schema.Struct({ reason: Schema.optional(Schema.Struct({ kind: Schema.String }).pipe(MultiHostSchema.passthrough)) }).pipe(MultiHostSchema.passthrough)
const titleSchema = Schema.Struct({ title: Schema.String }).pipe(MultiHostSchema.passthrough)
const requestHeaderSchema = Schema.Struct({
  header: Schema.Struct({ config: Schema.Struct({ provider: Schema.String, model: Schema.String }).pipe(MultiHostSchema.passthrough) }).pipe(MultiHostSchema.passthrough),
}).pipe(MultiHostSchema.passthrough)

const maxText = 8_000
const maxToolOutput = 1_200

const toolSummary = (call: Schema.Schema.Type<typeof toolCallSchema>): string => {
  let parsed: Schema.Schema.Type<typeof toolArgumentsSchema> | undefined
  try {
    const result = MultiHostSchema.safeDecode(toolArgumentsSchema, JSON.parse(call.arguments ?? '{}'))
    parsed = result.success ? result.data : undefined
  } catch {
    parsed = undefined
  }
  const detail = parsed?.command ?? parsed?.path ?? parsed?.description
  return detail === undefined ? call.name : `${call.name}: ${detail.split('\n', 1)[0]?.slice(0, 200) ?? ''}`
}
const clip = (text: string): string => (text.length > maxText ? `${text.slice(0, maxText)}…` : text)
const texts = (blocks: readonly Schema.Schema.Type<typeof textBlockSchema>[] | undefined): string =>
  (blocks ?? [])
    .filter(block => block.type === 'text' && block.text !== undefined)
    .map(block => block.text)
    .join('\n')
    .trim()

export type TranscriptWaiting = { readonly kind: 'question' | 'tool'; readonly tool: string; readonly since: number }
type ReducedTranscript = { entries: TranscriptEntry[]; running: boolean; title?: string; model?: ModelSelection; waiting?: TranscriptWaiting }

const questionTool = (name: string): boolean => name === 'ask_user_question' || name === 'ask_parent_question' || name.endsWith('__ask_user_question')

/**
 * Reduce a remote Session's history records to what the local remote-thread view shows: user and assistant text, one
 * line per tool call, and turn outcomes. The native renderer cannot show another runtime's Session, so this view
 * reads the same durable events and drops the ones only the agent needs (system prompts, runtime context, headers).
 */
export const reduceTranscript = (
  records: readonly unknown[],
): {
  readonly entries: TranscriptEntry[]
  readonly running: boolean
  readonly title?: string
  readonly model?: ModelSelection
  readonly waiting?: TranscriptWaiting
} => {
  const entries: TranscriptEntry[] = []
  let running = false
  let title: string | undefined
  let model: ModelSelection | undefined
  let lastCall: { readonly callId: string; readonly name: string; readonly seq: number } | undefined
  const toolEntries = new Map<string, number>()
  const resolvedCalls = new Set<string>()
  for (const raw of records) {
    const record = MultiHostSchema.safeDecode(recordSchema, raw)
    if (!record.success) continue
    const { type, seq, data } = record.data.event
    if (type === 'turn/start') running = true
    if (type === 'turn/end') {
      running = false
      const reason = MultiHostSchema.safeDecode(turnEndSchema, data).data?.reason?.kind
      if (reason !== undefined && reason !== 'completed') entries.push({ seq, kind: 'status', text: `Turn ended: ${reason}` })
    }
    if (type === 'session/title') title = MultiHostSchema.safeDecode(titleSchema, data).data?.title ?? title
    if (type === 'request/header') {
      const config = MultiHostSchema.safeDecode(requestHeaderSchema, data).data?.header.config
      if (config !== undefined) model = { provider: config.provider, model: config.model }
    }
    if (type === 'user/message') {
      const message = MultiHostSchema.safeDecode(userMessageSchema, data)
      if (!message.success || message.data.source?.kind !== 'user') continue
      const text = texts(message.data.content)
      if (text !== '') entries.push({ seq, kind: 'user', text: clip(text) })
    }
    if (type === 'assistant/message') {
      const message = MultiHostSchema.safeDecode(assistantSchema, data)
      if (!message.success) continue
      const text = texts(message.data.message.content)
      if (text !== '') entries.push({ seq, kind: 'assistant', text: clip(text) })
    }
    if (type === 'tool/call') {
      const call = MultiHostSchema.safeDecode(toolCallSchema, data)
      if (!call.success) continue
      const entry: TranscriptEntry = { seq, kind: 'tool', text: toolSummary(call.data) }
      entries.push(entry)
      toolEntries.set(call.data.callId, entries.length - 1)
      lastCall = { callId: call.data.callId, name: call.data.name, seq }
    }
    if (type === 'tool/result') {
      const result = MultiHostSchema.safeDecode(toolResultSchema, data)
      if (result.success) resolvedCalls.add(result.data.message.toolCallId)
      const entryIndex = result.success ? toolEntries.get(result.data.message.toolCallId) : undefined
      const entry = entryIndex === undefined ? undefined : entries[entryIndex]
      if (result.data === undefined || entryIndex === undefined || entry === undefined) continue
      const output = texts(result.data.message.content)
      const shown = output.length > maxToolOutput ? `${output.slice(0, maxToolOutput)}…` : output
      entries[entryIndex] = {
        ...entry,
        text: `${entry.text}${result.data.message.isError === true ? ' (failed)' : ''}${shown === '' ? '' : `\n${shown}`}`,
      }
    }
  }
  const waiting: TranscriptWaiting | undefined =
    running && lastCall !== undefined && !resolvedCalls.has(lastCall.callId)
      ? { kind: questionTool(lastCall.name) ? 'question' : 'tool', tool: lastCall.name, since: lastCall.seq }
      : undefined
  const reduced: ReducedTranscript = { entries, running }
  if (title !== undefined) reduced.title = title
  if (model !== undefined) reduced.model = model
  if (waiting !== undefined) reduced.waiting = waiting
  return reduced
}

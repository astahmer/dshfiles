import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { SchemaFields } from './schema.js'
import type { ModelSelection, TranscriptEntry } from './api.js'

const eventSchema = Schema.Struct({ type: Schema.String, seq: Schema.Number.check(Schema.isFinite(), Schema.isInt()), data: Schema.Unknown }).pipe(
  SchemaFields.passthrough,
)
const recordSchema = Schema.Struct({ type: Schema.Literal('event'), event: eventSchema }).pipe(SchemaFields.passthrough)
const textBlockSchema = Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String), name: Schema.optional(Schema.String) }).pipe(
  SchemaFields.passthrough,
)
const messageSchema = Schema.Struct({ content: Schema.optional(Schema.Array(textBlockSchema).check(Schema.isMaxLength(512))) }).pipe(
  SchemaFields.passthrough,
)
const userMessageSchema = Schema.Struct({
  content: Schema.optional(Schema.Array(textBlockSchema).check(Schema.isMaxLength(512))),
  source: Schema.optional(Schema.Struct({ kind: Schema.String }).pipe(SchemaFields.passthrough)),
}).pipe(SchemaFields.passthrough)
const assistantSchema = Schema.Struct({ message: messageSchema }).pipe(SchemaFields.passthrough)
const toolCallSchema = Schema.Struct({ callId: Schema.String, name: Schema.String, arguments: Schema.optional(Schema.String) }).pipe(
  SchemaFields.passthrough,
)
const toolArgumentsSchema = Schema.Struct({
  command: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
}).pipe(SchemaFields.passthrough)
const toolResultSchema = Schema.Struct({
  message: Schema.Struct({ toolCallId: Schema.String, isError: Schema.optional(Schema.Boolean), content: Schema.optional(Schema.Array(textBlockSchema)) }).pipe(
    SchemaFields.passthrough,
  ),
}).pipe(SchemaFields.passthrough)
const turnEndSchema = Schema.Struct({ reason: Schema.optional(Schema.Struct({ kind: Schema.String }).pipe(SchemaFields.passthrough)) }).pipe(
  SchemaFields.passthrough,
)
const titleSchema = Schema.Struct({ title: Schema.String }).pipe(SchemaFields.passthrough)
const requestHeaderSchema = Schema.Struct({
  header: Schema.Struct({ config: Schema.Struct({ provider: Schema.String, model: Schema.String }).pipe(SchemaFields.passthrough) }).pipe(
    SchemaFields.passthrough,
  ),
}).pipe(SchemaFields.passthrough)

const decodeRecord = Schema.decodeUnknownOption(recordSchema)
const decodeTurnEnd = Schema.decodeUnknownOption(turnEndSchema)
const decodeTitle = Schema.decodeUnknownOption(titleSchema)
const decodeRequestHeader = Schema.decodeUnknownOption(requestHeaderSchema)
const decodeUserMessage = Schema.decodeUnknownOption(userMessageSchema)
const decodeAssistant = Schema.decodeUnknownOption(assistantSchema)
const decodeToolCall = Schema.decodeUnknownOption(toolCallSchema)
const decodeToolResult = Schema.decodeUnknownOption(toolResultSchema)
const decodeToolArguments = Schema.decodeUnknownOption(toolArgumentsSchema)

const maxText = 8_000
const maxToolOutput = 1_200

const toolSummary = (call: Schema.Schema.Type<typeof toolCallSchema>): string => {
  let parsed: Schema.Schema.Type<typeof toolArgumentsSchema> | undefined
  try {
    parsed = Option.getOrUndefined(decodeToolArguments(JSON.parse(call.arguments ?? '{}')))
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
    const record = decodeRecord(raw)
    if (Option.isNone(record)) continue
    const { type, seq, data } = record.value.event
    if (type === 'turn/start') running = true
    if (type === 'turn/end') {
      running = false
      const reason = Option.getOrUndefined(Option.flatMap(decodeTurnEnd(data), end => Option.fromUndefinedOr(end.reason?.kind)))
      if (reason !== undefined && reason !== 'completed') entries.push({ seq, kind: 'status', text: `Turn ended: ${reason}` })
    }
    if (type === 'session/title') title = Option.match(decodeTitle(data), { onNone: () => title, onSome: row => row.title })
    if (type === 'request/header') {
      const config = Option.getOrUndefined(Option.flatMap(decodeRequestHeader(data), header => Option.fromUndefinedOr(header.header.config)))
      if (config !== undefined) model = { provider: config.provider, model: config.model }
    }
    if (type === 'user/message') {
      const message = decodeUserMessage(data)
      if (Option.isNone(message) || message.value.source?.kind !== 'user') continue
      const text = texts(message.value.content)
      if (text !== '') entries.push({ seq, kind: 'user', text: clip(text) })
    }
    if (type === 'assistant/message') {
      const message = decodeAssistant(data)
      if (Option.isNone(message)) continue
      const text = texts(message.value.message.content)
      if (text !== '') entries.push({ seq, kind: 'assistant', text: clip(text) })
    }
    if (type === 'tool/call') {
      const call = decodeToolCall(data)
      if (Option.isNone(call)) continue
      const entry: TranscriptEntry = { seq, kind: 'tool', text: toolSummary(call.value) }
      entries.push(entry)
      toolEntries.set(call.value.callId, entries.length - 1)
      lastCall = { callId: call.value.callId, name: call.value.name, seq }
    }
    if (type === 'tool/result') {
      const result = decodeToolResult(data)
      if (Option.isSome(result)) resolvedCalls.add(result.value.message.toolCallId)
      const entryIndex = Option.isSome(result) ? toolEntries.get(result.value.message.toolCallId) : undefined
      const entry = entryIndex === undefined ? undefined : entries[entryIndex]
      if (Option.isNone(result) || entryIndex === undefined || entry === undefined) continue
      const output = texts(result.value.message.content)
      const shown = output.length > maxToolOutput ? `${output.slice(0, maxToolOutput)}…` : output
      entries[entryIndex] = {
        ...entry,
        text: `${entry.text}${result.value.message.isError === true ? ' (failed)' : ''}${shown === '' ? '' : `\n${shown}`}`,
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

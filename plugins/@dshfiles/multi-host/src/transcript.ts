import { z } from 'zod'
import type { ModelSelection, TranscriptEntry } from './api.js'

const eventSchema = z.object({ type: z.string(), seq: z.number().int(), data: z.unknown() }).passthrough()
const recordSchema = z.object({ type: z.literal('event'), event: eventSchema }).passthrough()
const textBlockSchema = z.object({ type: z.string(), text: z.string().optional(), name: z.string().optional() }).passthrough()
const messageSchema = z.object({ content: z.array(textBlockSchema).max(512).optional() }).passthrough()
const userMessageSchema = messageSchema.extend({ source: z.object({ kind: z.string() }).passthrough().optional() })
const assistantSchema = z.object({ message: messageSchema }).passthrough()
const toolCallSchema = z.object({ callId: z.string(), name: z.string(), arguments: z.string().optional() }).passthrough()
const toolArgumentsSchema = z.object({ command: z.string().optional(), description: z.string().optional(), path: z.string().optional() }).passthrough()
const toolResultSchema = z
  .object({ message: z.object({ toolCallId: z.string(), isError: z.boolean().optional(), content: z.array(textBlockSchema).optional() }).passthrough() })
  .passthrough()
const turnEndSchema = z.object({ reason: z.object({ kind: z.string() }).passthrough().optional() }).passthrough()
const titleSchema = z.object({ title: z.string() }).passthrough()
const requestHeaderSchema = z
  .object({ header: z.object({ config: z.object({ provider: z.string(), model: z.string() }).passthrough() }).passthrough() })
  .passthrough()

const maxText = 8_000
const maxToolOutput = 1_200

const toolSummary = (call: z.infer<typeof toolCallSchema>): string => {
  let parsed: z.infer<typeof toolArgumentsSchema> | undefined
  try {
    parsed = toolArgumentsSchema.safeParse(JSON.parse(call.arguments ?? '{}')).data
  } catch {
    parsed = undefined
  }
  const detail = parsed?.command ?? parsed?.path ?? parsed?.description
  return detail === undefined ? call.name : `${call.name}: ${detail.split('\n', 1)[0]?.slice(0, 200) ?? ''}`
}
const clip = (text: string): string => (text.length > maxText ? `${text.slice(0, maxText)}…` : text)
const texts = (blocks: readonly z.infer<typeof textBlockSchema>[] | undefined): string =>
  (blocks ?? [])
    .filter(block => block.type === 'text' && block.text !== undefined)
    .map(block => block.text)
    .join('\n')
    .trim()

export type TranscriptWaiting = { readonly kind: 'question' | 'tool'; readonly tool: string; readonly since: number }

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
  const toolEntries = new Map<string, TranscriptEntry>()
  const resolvedCalls = new Set<string>()
  for (const raw of records) {
    const record = recordSchema.safeParse(raw)
    if (!record.success) continue
    const { type, seq, data } = record.data.event
    if (type === 'turn/start') running = true
    if (type === 'turn/end') {
      running = false
      const reason = turnEndSchema.safeParse(data).data?.reason?.kind
      if (reason !== undefined && reason !== 'completed') entries.push({ seq, kind: 'status', text: `Turn ended: ${reason}` })
    }
    if (type === 'session/title') title = titleSchema.safeParse(data).data?.title ?? title
    if (type === 'request/header') {
      const config = requestHeaderSchema.safeParse(data).data?.header.config
      if (config !== undefined) model = { provider: config.provider, model: config.model }
    }
    if (type === 'user/message') {
      const message = userMessageSchema.safeParse(data)
      if (!message.success || message.data.source?.kind !== 'user') continue
      const text = texts(message.data.content)
      if (text !== '') entries.push({ seq, kind: 'user', text: clip(text) })
    }
    if (type === 'assistant/message') {
      const message = assistantSchema.safeParse(data)
      if (!message.success) continue
      const text = texts(message.data.message.content)
      if (text !== '') entries.push({ seq, kind: 'assistant', text: clip(text) })
    }
    if (type === 'tool/call') {
      const call = toolCallSchema.safeParse(data)
      if (!call.success) continue
      const entry: TranscriptEntry = { seq, kind: 'tool', text: toolSummary(call.data) }
      entries.push(entry)
      toolEntries.set(call.data.callId, entry)
      lastCall = { callId: call.data.callId, name: call.data.name, seq }
    }
    if (type === 'tool/result') {
      const result = toolResultSchema.safeParse(data)
      if (result.success) resolvedCalls.add(result.data.message.toolCallId)
      const entry = result.success ? toolEntries.get(result.data.message.toolCallId) : undefined
      if (result.data === undefined || entry === undefined) continue
      const output = texts(result.data.message.content)
      const shown = output.length > maxToolOutput ? `${output.slice(0, maxToolOutput)}…` : output
      entry.text = `${entry.text}${result.data.message.isError === true ? ' (failed)' : ''}${shown === '' ? '' : `\n${shown}`}`
    }
  }
  const waiting: TranscriptWaiting | undefined =
    running && lastCall !== undefined && !resolvedCalls.has(lastCall.callId)
      ? { kind: questionTool(lastCall.name) ? 'question' : 'tool', tool: lastCall.name, since: lastCall.seq }
      : undefined
  return {
    entries,
    running,
    ...(title === undefined ? {} : { title }),
    ...(model === undefined ? {} : { model }),
    ...(waiting === undefined ? {} : { waiting }),
  }
}

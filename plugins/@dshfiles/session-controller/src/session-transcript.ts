import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { Schema } from 'effect'

const MAX_TEXT = 8_000

const textBlockSchema = Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })
const userMessageSchema = Schema.Struct({
  content: Schema.optional(Schema.Array(textBlockSchema).check(Schema.isMaxLength(512))),
  source: Schema.optional(Schema.Struct({ kind: Schema.String })),
})
const assistantMessageSchema = Schema.Struct({
  message: Schema.Struct({ content: Schema.optional(Schema.Array(textBlockSchema).check(Schema.isMaxLength(512))) }),
})

type TextBlock = Schema.Schema.Type<typeof textBlockSchema>
type UserMessage = Schema.Schema.Type<typeof userMessageSchema>
type AssistantMessage = Schema.Schema.Type<typeof assistantMessageSchema>

/** What a reader of the thread typed or was told; runtime context, reminders and other synthetic inputs stay out. */
const SPOKEN_SOURCES = new Set(['user', 'dshfiles-plugin-message'])

export interface TranscriptEntry {
  readonly seq: number
  readonly role: 'user' | 'assistant'
  readonly text: string
}

const textOf = (blocks: readonly TextBlock[] | undefined): string => {
  const joined = (blocks ?? [])
    .flatMap(block => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
    .join('\n')
    .trim()
  return joined.length > MAX_TEXT ? `${joined.slice(0, MAX_TEXT)}…` : joined
}

const decode = <Value>(schema: Schema.ConstraintDecoder<Value>, data: unknown): Value | undefined => {
  const result = Schema.decodeUnknownResult(schema)(data)
  return result._tag === 'Success' ? result.success : undefined
}

const entryOf = (event: SessionEvent): TranscriptEntry | undefined => {
  if (event.type === 'user/message') {
    const message: UserMessage | undefined = decode(userMessageSchema, event.data)
    if (message === undefined || !SPOKEN_SOURCES.has(message.source?.kind ?? '')) return undefined
    const text = textOf(message.content)
    return text === '' ? undefined : { seq: event.seq, role: 'user', text }
  }
  if (event.type === 'assistant/message') {
    const message: AssistantMessage | undefined = decode(assistantMessageSchema, event.data)
    const text = message === undefined ? '' : textOf(message.message.content)
    return text === '' ? undefined : { seq: event.seq, role: 'assistant', text }
  }
  return undefined
}

/** The last `limit` user and assistant messages of a Session event log, oldest first. */
export const recentTranscript = (input: { readonly events: readonly SessionEvent[]; readonly limit: number }) => {
  const newestFirst: TranscriptEntry[] = []
  for (let index = input.events.length - 1; index >= 0 && newestFirst.length <= input.limit; index -= 1) {
    const event = input.events[index]
    if (event === undefined) continue
    const entry = entryOf(event)
    if (entry !== undefined) newestFirst.push(entry)
  }
  return {
    entries: newestFirst.slice(0, input.limit).reverse(),
    truncated: newestFirst.length > input.limit,
  }
}

/** The log tail a cold transcript read decodes, as `TailLog` serves it. */
export interface TranscriptTail {
  before(frames: number): readonly SessionEvent[]
  readonly complete: boolean
  readonly decodedFrames: number
}

/**
 * The newest `limit` entries of a cold log, decoding the frames the count needs instead of the whole transcript.
 * `undefined` when the tail cannot reach back far enough, so the caller falls back to the full read.
 */
export const recentTranscriptFromTail = (input: { readonly tail: TranscriptTail; readonly limit: number }) => {
  for (let frames = 8; ; frames *= 2) {
    const decoded = input.tail.decodedFrames
    const transcript = recentTranscript({ events: input.tail.before(frames), limit: input.limit })
    if (transcript.truncated || input.tail.complete) return transcript
    // A window that decoded its first frame holds nothing further back.
    if (input.tail.decodedFrames === decoded) return undefined
  }
}

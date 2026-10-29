import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

const MAX_TEXT = 8_000

const textBlock = z.looseObject({ type: z.string(), text: z.string().optional() })
const userMessage = z.looseObject({ content: z.array(textBlock).max(512).optional(), source: z.looseObject({ kind: z.string() }).optional() })
const assistantMessage = z.looseObject({ message: z.looseObject({ content: z.array(textBlock).max(512).optional() }) })

/** What a reader of the thread typed or was told; runtime context, reminders and other synthetic inputs stay out. */
const SPOKEN_SOURCES = new Set(['user', 'dshfiles-plugin-message'])

export interface TranscriptEntry {
  readonly seq: number
  readonly role: 'user' | 'assistant'
  readonly text: string
}

const textOf = (blocks: readonly z.infer<typeof textBlock>[] | undefined): string => {
  const joined = (blocks ?? [])
    .flatMap(block => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
    .join('\n')
    .trim()
  return joined.length > MAX_TEXT ? `${joined.slice(0, MAX_TEXT)}…` : joined
}

const entryOf = (event: SessionEvent): TranscriptEntry | undefined => {
  if (event.type === 'user/message') {
    const message = userMessage.safeParse(event.data).data
    if (message === undefined || !SPOKEN_SOURCES.has(message.source?.kind ?? '')) return undefined
    const text = textOf(message.content)
    return text === '' ? undefined : { seq: event.seq, role: 'user', text }
  }
  if (event.type === 'assistant/message') {
    const message = assistantMessage.safeParse(event.data).data
    const text = message === undefined ? '' : textOf(message.message.content)
    return text === '' ? undefined : { seq: event.seq, role: 'assistant', text }
  }
  return undefined
}

/** The last `limit` user and assistant messages of a Session event log, oldest first. */
export const recentTranscript = (input: { readonly events: readonly SessionEvent[]; readonly limit: number }) => {
  const entries = input.events.flatMap(event => entryOf(event) ?? [])
  return { entries: entries.slice(-input.limit), truncated: entries.length > input.limit }
}

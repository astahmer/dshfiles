import { z } from 'zod'

export const THREAD_MENTION_CAPTURE_EVENT = 'dshfiles:thread-sidebar:mention-capture'
export const THREAD_MENTION_INSERT_EVENT = 'dshfiles:thread-sidebar:mention-insert'

const threadMentionTextSchema = z.string().refine(value => value.startsWith('@thread:') && value.slice('@thread:'.length).trim().length > 0)

export const threadMentionText = (sessionId: string): string => `@thread:${sessionId} `

export const decodeThreadMentionText = (value: unknown): string | null => {
  const parsed = threadMentionTextSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data
}

export const captureThreadMentionInsertion = (): void => {
  window.dispatchEvent(new Event(THREAD_MENTION_CAPTURE_EVENT))
}

export const requestThreadMentionInsertion = (sessionId: string): void => {
  window.dispatchEvent(new CustomEvent(THREAD_MENTION_INSERT_EVENT, { detail: threadMentionText(sessionId) }))
}

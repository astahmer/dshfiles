import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'

export interface SessionPreviewMessage {
  readonly seq: number
  readonly role: 'user' | 'assistant'
  readonly text: string
}

const MAX_PREVIEW_CODE_POINTS = 360
const MAX_PREVIEW_MESSAGES = 3

const previewText = (text: string): string => {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  const codePoints = Array.from(normalized)
  if (codePoints.length <= MAX_PREVIEW_CODE_POINTS) return normalized
  return `${codePoints.slice(0, MAX_PREVIEW_CODE_POINTS).join('')}…`
}

export const sessionPreviewMessages = (entries: readonly SessionEventLikeEntry[]): readonly SessionPreviewMessage[] => {
  const messages: SessionPreviewMessage[] = []
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    if (entry.event.type === 'user/message') {
      if (entry.event.data.source.kind !== 'user') continue
      const text = previewText(entry.event.data.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join(' '))
      if (text.length > 0) messages.push({ seq: entry.event.seq, role: 'user', text })
      continue
    }
    if (entry.event.type !== 'assistant/message') continue
    const text = previewText(entry.event.data.message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join(' '))
    if (text.length > 0) messages.push({ seq: entry.event.seq, role: 'assistant', text })
  }
  return messages.slice(-MAX_PREVIEW_MESSAGES)
}

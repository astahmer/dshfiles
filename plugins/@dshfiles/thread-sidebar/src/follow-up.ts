import { SessionId } from '@deepseek-ai/dsh-session/types'
import * as Schema from 'effect/Schema'
import type { DraftInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SchemaHelpers } from './schema-helpers.js'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(512))

export const followUpPrompt = (sessionId: string, threadLabel = 'thread'): DraftInput => {
  const parsed = SchemaHelpers.decodeUnknownSafe(sessionIdSchema, sessionId)
  if (!parsed.success) throw new Error('A follow-up requires a valid thread ID.')
  const label = threadLabel.replace(/[\]\r\n]+/gu, ' ').trim() || 'thread'
  const sessionBytes = new TextEncoder().encode(JSON.stringify(SessionId(parsed.data)))
  const sessionBinary = Array.from(sessionBytes, byte => String.fromCharCode(byte)).join('')
  const sessionPayload = btoa(sessionBinary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  const referenceText = `@[${label}](dsh-session:${sessionPayload})`
  const prefix = 'Follow-up after '
  const text = `${prefix}${referenceText} :\n`
  return {
    text,
    references: [
      {
        source: 'reference',
        ref: referenceText,
        offset: prefix.length,
        length: referenceText.length,
        label,
        appearance: 'session',
        clipboardText: referenceText,
      },
    ],
  }
}

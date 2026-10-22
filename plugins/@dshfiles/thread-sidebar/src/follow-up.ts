import { z } from 'zod'

const sessionIdSchema = z.string().min(1).max(512)

export const followUpPrompt = (sessionId: string): string => {
  const parsed = sessionIdSchema.safeParse(sessionId)
  if (!parsed.success) throw new Error('A follow-up requires a valid thread ID.')
  return `Follow-up after @session:${parsed.data} :\n`
}

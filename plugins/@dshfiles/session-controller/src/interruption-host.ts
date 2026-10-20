import { createHash } from 'node:crypto'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { interruptionApi } from './interruption-api.ts'
import type { SessionRequestId } from './native/types.ts'

export const interruptionHost = interruptionApi.host({
  available: async ({ ctx, input }) => {
    const sessionId = SessionId(input.sessionId)
    if (!ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) return { available: false }
    return { available: (await ctx.sessionController.interruptedTurn(sessionId)) === input.seq }
  },
  resume: async ({ ctx, input }) => {
    const sessionId = SessionId(input.sessionId)
    if (!ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) return { accepted: false }
    if ((await ctx.sessionController.interruptedTurn(sessionId)) !== input.seq) return { accepted: false }
    const hash = createHash('sha256').update(`resume-interrupted:${sessionId}:${input.seq}`).digest('hex')
    const requestId = brandString<SessionRequestId>(
      `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
    )
    try {
      await ctx.sessionController.prompt(
        {
          sessionId,
          requestId,
          mode: 'queue',
          expectedInterruptedSeq: input.seq,
          content: [
            {
              type: 'text',
              text: 'Continue the interrupted task from the persisted transcript and current workspace state. Verify missing tool results before repeating any action. If safe continuation is unclear, explain what needs human input.',
            },
          ],
        },
        AbortSignal.timeout(15_000),
      )
      return { accepted: true }
    } catch (error) {
      if (remoteErrorOf(error)?.code === 'session/interruption-superseded') return { accepted: false }
      throw error
    }
  },
})

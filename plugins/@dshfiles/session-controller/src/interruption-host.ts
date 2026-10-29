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
    const controller = ctx.get('sessionController')
    if (controller === undefined) return { available: false }
    const stopped = await controller.stoppedTurn(sessionId)
    return stopped?.seq === input.seq ? { available: true, action: stopped.action } : { available: false }
  },
  retry: async ({ ctx, input }) => {
    const sessionId = SessionId(input.sessionId)
    if (!ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) return { accepted: false }
    const controller = ctx.get('sessionController')
    if (controller === undefined) return { accepted: false }
    return { accepted: await controller.retryStoppedTurn({ sessionId, seq: input.seq }) }
  },
  resume: async ({ ctx, input }) => {
    const sessionId = SessionId(input.sessionId)
    if (!ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) return { accepted: false }
    const controller = ctx.get('sessionController')
    const stopped = await controller?.stoppedTurn(sessionId)
    if (controller === undefined || stopped?.action !== 'resume' || stopped.seq !== input.seq) return { accepted: false }
    const hash = createHash('sha256').update(`resume-interrupted:${sessionId}:${input.seq}`).digest('hex')
    const requestId = brandString<SessionRequestId>(
      `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
    )
    try {
      await controller.prompt(
        {
          sessionId,
          requestId,
          mode: 'queue',
          expectedInterruptedSeq: input.seq,
          content: [
            {
              type: 'text',
              text: 'Continue the interrupted task (stopped by a DSH restart, a failed model request or the output-token limit) from the persisted transcript and current workspace state. Verify missing tool results before repeating any action. If safe continuation is unclear, explain what needs human input.',
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

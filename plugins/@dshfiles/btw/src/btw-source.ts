import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandClaim, InputTriggerSource } from '@dshfiles/input-trigger/client'

/**
 * The `/btw <question>` composer command. Args-tolerant: `/btw what is this?`
 * claims the whole line, bare `/btw` claims too so the hint shows. `matchClaim`
 * answers for a persisted chip without acting, so a restored `/btw ` draft keeps
 * its chip and its hint instead of decaying into literal text.
 */
export const createBtwSource = (input: { readonly description: string; readonly claimFor: (sessionId: SessionId) => CommandClaim }): InputTriggerSource => ({
  trigger: '/',
  name: 'btw',
  async candidates(_session, request) {
    return request.position === 'leading' && 'btw'.startsWith(request.query.toLowerCase()) ? [{ name: 'btw', description: input.description }] : []
  },
  onPick: pick => ({ claim: input.claimFor(pick.session.sessionId) }),
  async matchEnter(session, line) {
    return line === '/btw' || line.startsWith('/btw ') ? { claim: input.claimFor(session.sessionId) } : undefined
  },
  async matchClaim(session, token) {
    return token === '/btw' ? input.claimFor(session.sessionId) : undefined
  },
})

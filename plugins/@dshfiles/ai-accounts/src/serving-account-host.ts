import type { ApiCaller } from '@dshfiles/dshx/api'
import { accountRuntime } from './account-runtime.js'
import { servingAccountApi } from './serving-account-api.js'

/** Same trust boundary as Fast mode: agents self-only; authenticated UI/Host can select a chat. */
export const servingAccountSessionForCaller = (input: { readonly sessionId?: string | undefined }, caller: ApiCaller): string => {
  if (caller.kind === 'agent') {
    if (caller.sessionId === undefined) throw new Error('Serving account metadata requires an active Agent session.')
    if (input.sessionId !== undefined && input.sessionId !== caller.sessionId)
      throw new Error('Agents can only read serving account metadata for their own session.')
    return caller.sessionId
  }
  if (input.sessionId === undefined) throw new Error('Serving account metadata requires a session ID.')
  return input.sessionId
}
export const servingAccountHostApi = servingAccountApi.host({
  snapshot: async ({ ctx, input, caller }) => {
    const sessionId = servingAccountSessionForCaller(input, caller)
    const service = accountRuntime(ctx)?.servingAccount
    if (service === undefined) return { sessionId, currentAttempt: null, lastSuccessful: null }
    return service.read(sessionId)
  },
})

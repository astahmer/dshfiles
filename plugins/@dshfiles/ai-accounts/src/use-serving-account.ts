import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useApi } from '@dshfiles/dshx/client'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { servingAccountApi } from './serving-account-api.js'
import { servingAccountQuery } from './serving-account-query.js'
export type UseServingAccountSessions = PropsRuntime<'main'>['useSessions']

/** Call under decorate + PluginQueryProvider. Pass the public slot's useSessions; client setup injects sessions. */
export const useServingAccount = (useSessions: UseServingAccountSessions) => {
  const client = useApi(servingAccountApi)
  const sessionId = useSessions(
    state =>
      state.ids.find(id => {
        const session = state.byId[id]
        return session !== undefined && !session.blank && (session.retainedBy.mainView ?? 0) > 0
      }) ?? null,
  )
  const running = useSessions(state => (sessionId === null ? false : state.byId[sessionId]?.running === true))
  const query = useQuery(servingAccountQuery(client, sessionId, running))
  const snapshot = query.data?.sessionId === sessionId && !query.isError ? query.data : null
  const current = snapshot?.currentAttempt
  // While a chat runs, an old successful account is not evidence of the current attempt.
  const activeAccountId = running
    ? current?.status === 'attempting' || current?.status === 'succeeded'
      ? current.accountId
      : null
    : (snapshot?.lastSuccessful?.accountId ?? null)
  return { sessionId, running, snapshot, activeAccountId }
}

import { useApi } from '@dshfiles/dshx/client'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { aiAccountsKeys } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import type { QuotaContinuationSummary } from './quota-continuation-model.js'

/**
 * Active quota recoveries for every thread. A notice or toggle appears on the
 * turn that just failed, after the Host stored the recovery, so a page cached
 * before that write must never decide whether its controls render.
 */
export const useQuotaContinuations = () => {
  const accounts = useApi(aiAccountsApi)
  return useQuery({
    queryKey: aiAccountsKeys.quotaContinuations,
    queryFn: ({ signal }) => accounts.quotaContinuations(undefined, { signal }),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

/** The one recovery a thread is waiting on, if any. */
export const waitingContinuationFor = (
  continuations: readonly QuotaContinuationSummary[] | undefined,
  sessionId: string,
): QuotaContinuationSummary | undefined => continuations?.find(item => item.sessionId === sessionId && item.state === 'waiting')

import { useApi } from '@dshfiles/dshx/client'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { aiAccountsKeys, aiAccountsQueries, UNREADABLE_USAGE_MESSAGE } from './accounts-queries.js'
import { aiAccountsApi, type AccountsUsage } from './api.js'
import { usePreferences } from './use-preferences.js'

const UNANSWERED_USAGE_MESSAGE = 'The account host did not answer. Check that DSH is running, then retry.'
const AMBIENT_USAGE_REFRESH_MS = 5 * 60_000

/**
 * Live quota for a surface. Every surface shares one cache; `refresh` bypasses the Host's sweep cache. `failure` says
 * why the last read did not land, including while older `usage` stays on screen.
 *
 * A view polls on the configured interval, also while hidden. An `ambient` surface (the sidebar strip, the edge widget)
 * is always mounted, so on its own it polls every five minutes and only while visible: each sweep reads every provider.
 * Query refetches on the shortest interval among mounted surfaces, so an open view keeps its freshness.
 */
export const useAccountsUsage = (options: { readonly enabled?: boolean; readonly ambient?: boolean } = {}) => {
  const accounts = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  const { usageRefreshMs } = usePreferences()
  const ambient = options.ambient === true
  const usageQuery = useQuery({
    ...aiAccountsQueries.usage(accounts, ambient ? Math.max(usageRefreshMs, AMBIENT_USAGE_REFRESH_MS) : usageRefreshMs),
    ...(ambient && { refetchIntervalInBackground: false }),
    enabled: options.enabled ?? true,
  })
  const refreshMutation = useMutation({
    mutationFn: () => aiAccountsQueries.readFreshUsage(accounts),
    onSuccess: async next => {
      // A poll already in flight read the sweep this refresh replaced; landing later it would put the old reading back.
      await queryClient.cancelQueries({ queryKey: aiAccountsKeys.usage })
      queryClient.setQueryData<AccountsUsage | null>(aiAccountsKeys.usage, previous => aiAccountsQueries.keepLastGoodUsage(previous, next))
    },
  })
  // A failed refresh stays visible until a later read succeeds.
  const refreshError = refreshMutation.isError && refreshMutation.submittedAt > usageQuery.dataUpdatedAt ? refreshMutation.error : null
  const readError = refreshError ?? usageQuery.error
  const unreadable = usageQuery.data === null ? UNREADABLE_USAGE_MESSAGE : null

  return {
    usage: usageQuery.data ?? null,
    refreshing: refreshMutation.isPending,
    failure: readError === null ? unreadable : errorMessage(readError, UNANSWERED_USAGE_MESSAGE),
    refresh: (): Promise<void> =>
      refreshMutation.mutateAsync().then(
        () => undefined,
        () => undefined,
      ),
  }
}

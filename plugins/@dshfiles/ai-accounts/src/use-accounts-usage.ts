import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { usePreferences } from './use-preferences.js'

/**
 * Live quota for a surface. Every surface polls on the configured interval and
 * shares one cache; `refresh` bypasses the Host's sweep cache.
 */
export const useAccountsUsage = (options: { readonly enabled?: boolean } = {}) => {
  const accounts = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  const { usageRefreshMs } = usePreferences()
  const usageQuery = useQuery({ ...aiAccountsQueries.usage(accounts, usageRefreshMs), enabled: options.enabled ?? true })
  const refreshMutation = useMutation({
    mutationFn: () => aiAccountsQueries.readFreshUsage(accounts),
    onSuccess: next => queryClient.setQueryData(aiAccountsKeys.usage, next),
  })
  // A failed refresh stays visible until a later read succeeds.
  const refreshFailed = refreshMutation.isError && refreshMutation.submittedAt > usageQuery.dataUpdatedAt

  return {
    usage: usageQuery.data ?? null,
    refreshing: refreshMutation.isPending,
    failed: usageQuery.isError || usageQuery.data === null || refreshFailed,
    refresh: (): Promise<void> => refreshMutation.mutateAsync().then(
      () => undefined,
      () => undefined,
    ),
  }
}

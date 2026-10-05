import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { aiAccountsApi, type AccountsFile, type OverlaySettings } from './api.js'

/**
 * Every ai-accounts slot shares one query client, so the sidebar foot, the edge
 * overlay, and both panels read one cached usage sweep instead of polling the
 * providers once per surface.
 */
export const accountsKeys = {
  all: ['ai-accounts'] as const,
  file: ['ai-accounts', 'file'] as const,
  usage: ['ai-accounts', 'usage'] as const,
  overlays: ['ai-accounts', 'overlays'] as const,
  historySettings: ['ai-accounts', 'history-settings'] as const,
  history: ['ai-accounts', 'history'] as const,
  historyFor: (instanceId: string, days: number) => ['ai-accounts', 'history', instanceId, days] as const,
  catalogFor: (instanceId: string) => ['ai-accounts', 'catalog', instanceId] as const,
  identityFor: (instanceId: string) => ['ai-accounts', 'identity', instanceId] as const,
}

/** Quota moves on its own, so it refreshes on an interval rather than per render. */
const USAGE_REFRESH_MS = 60_000

const DEFAULT_OVERLAYS: OverlaySettings = { edgeWidget: true, footerQuota: true }

export const useAccountsFile = () => {
  const api = useApi(aiAccountsApi)
  return useQuery({ queryKey: accountsKeys.file, queryFn: ({ signal }) => api.read(undefined, { signal }) })
}

export const useAccountsUsage = () => {
  const api = useApi(aiAccountsApi)
  return useQuery({ queryKey: accountsKeys.usage, queryFn: ({ signal }) => api.usage(undefined, { signal }), refetchInterval: USAGE_REFRESH_MS })
}

/** A surface that cannot read its toggle still draws, matching the Host default. */
export const useOverlaySettings = (): OverlaySettings | undefined => {
  const api = useApi(aiAccountsApi)
  const overlays = useQuery({ queryKey: accountsKeys.overlays, queryFn: ({ signal }) => api.overlaySettings(undefined, { signal }) })
  return overlays.isError ? DEFAULT_OVERLAYS : overlays.data
}

export const useQuotaHistory = (input: { readonly instanceId: string | null; readonly days: number }) => {
  const api = useApi(aiAccountsApi)
  const instanceId = input.instanceId ?? ''
  return useQuery({
    queryKey: accountsKeys.historyFor(instanceId, input.days),
    queryFn: ({ signal }) => api.history({ instanceId, days: input.days }, { signal }),
    enabled: instanceId !== '',
    refetchInterval: USAGE_REFRESH_MS,
  })
}

export const useHistorySettings = () => {
  const api = useApi(aiAccountsApi)
  return useQuery({ queryKey: accountsKeys.historySettings, queryFn: ({ signal }) => api.historySettings(undefined, { signal }) })
}

/** Writes return the whole file, so the cache takes the answer instead of refetching it. */
export const useAccountsFileWriter = () => {
  const queryClient = useQueryClient()
  return (file: AccountsFile): void => {
    queryClient.setQueryData(accountsKeys.file, file)
  }
}

/** Read now and record, so a fresh chart does not wait for the next scheduled sweep. */
export const useRecordUsage = () => {
  const api = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.collectUsage(),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: accountsKeys.usage }),
        queryClient.invalidateQueries({ queryKey: accountsKeys.history }),
        queryClient.invalidateQueries({ queryKey: accountsKeys.historySettings }),
      ]),
  })
}

export const useSaveOverlaySettings = () => {
  const api = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<OverlaySettings>) => api.saveOverlaySettings({ patch }),
    onSuccess: overlays => queryClient.setQueryData(accountsKeys.overlays, overlays),
  })
}

import { useApi } from '@dshfiles/dshx/client'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi, type NativeProviders } from './api.js'

type Provider = NativeProviders['providers'][number]

const statusOf = (provider: Provider, liveReload: boolean): string => {
  if (provider.lockedReason !== null) return 'Off (profile patch)'
  if (provider.enabled === provider.running) return provider.enabled ? 'On' : 'Off'
  if (liveReload) return provider.enabled ? 'Turning on…' : 'Turning off…'
  return provider.enabled ? 'On after restart' : 'Off after restart'
}

/**
 * Native DSH providers with an on/off switch. Turning one off only marks its
 * Loader row disabled in the profile patch: its settings and API key stay, and
 * turning it back on restores it as it was. A Host older than this Client has
 * no such method, so the list explains that instead of failing.
 */
export const NativeProvidersList = (props: { readonly compact?: boolean }): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  const providersQuery = useQuery(aiAccountsQueries.nativeProviders(accounts))
  const state = providersQuery.data ?? null
  const missing = providersQuery.isError
  const toggleMutation = useMutation({
    mutationFn: (input: { readonly entryId: string; readonly enabled: boolean }) => accounts.setNativeProviderEnabled(input),
    onSuccess: next => queryClient.setQueryData(aiAccountsKeys.nativeProviders, next),
  })
  const error = toggleMutation.isError ? errorMessage(toggleMutation.error, String(toggleMutation.error)) : null

  if (missing) return <p className="dshx:px-2 dshx:text-xs dshx:text-muted-foreground">Restart DSH to switch native providers from here.</p>
  if (state === null) return null
  if (!state.available) return <p className="dshx:px-2 dshx:text-xs dshx:text-muted-foreground">{state.reason}</p>
  if (state.providers.length === 0) return null

  const toggle = (provider: Provider, enabled: boolean): void => toggleMutation.mutate({ entryId: provider.entryId, enabled })

  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-1">
      <ul className={cn('dshx:flex dshx:flex-col', props.compact === true ? 'dshx:gap-0.5' : 'dshx:gap-1.5')}>
        {state.providers.map(provider => (
          <li
            className={cn(
              'dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2',
              props.compact === true ? 'dshx:rounded-md dshx:px-2 dshx:py-1' : 'dshx:rounded-lg dshx:border dshx:bg-card dshx:px-3 dshx:py-2',
            )}
            key={provider.entryId}
          >
            <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
              <span className="dshx:truncate dshx:text-sm">{provider.label}</span>
              <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground" title={provider.lockedReason ?? provider.entryId}>
                {statusOf(provider, state.liveReload)}
              </span>
            </div>
            <Switch
              aria-label={`${provider.enabled ? 'Disable' : 'Enable'} ${provider.label}`}
              checked={provider.enabled}
              disabled={toggleMutation.isPending || provider.lockedReason !== null}
              onCheckedChange={enabled => toggle(provider, enabled)}
              size="sm"
            />
          </li>
        ))}
      </ul>
      {error === null ? null : (
        <p className="dshx:px-2 dshx:text-xs dshx:text-destructive" role="alert">
          {error}
        </p>
      )}
      <p className="dshx:px-2 dshx:text-xs dshx:text-muted-foreground">
        Off keeps the provider&apos;s settings and API key. {state.liveReload ? 'Changes apply within a few seconds.' : 'Restart DSH to apply a change.'}
      </p>
    </div>
  )
}

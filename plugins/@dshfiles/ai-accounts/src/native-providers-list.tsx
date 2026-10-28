import { useApi } from '@dshfiles/dshx/client'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { BoxIcon, ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi, type NativeProviders } from './api.js'

export type NativeProviderRow = NativeProviders['providers'][number]
export const nativeProviderStatus = (provider: NativeProviderRow, liveReload: boolean): string => {
  if (provider.lockedReason !== null) return 'Off (profile patch)'
  if (provider.enabled === provider.running) return provider.enabled ? 'Available' : 'Off'
  if (liveReload) return provider.enabled ? 'Turning on…' : 'Turning off…'
  return provider.enabled ? 'On after restart' : 'Off after restart'
}
/** Native rows share the visual list, but never masquerade as saved credential-bearing accounts. */
export const NativeProvidersList = (props: {
  readonly compact?: boolean
  readonly selectedEntryId?: string | null
  readonly onSelect?: (entryId: string) => void
  readonly search?: string
}): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const client = useQueryClient()
  const query = useQuery(aiAccountsQueries.nativeProviders(accounts))
  const state = query.data ?? null
  const toggle = useMutation({
    mutationFn: (input: { entryId: string; enabled: boolean }) => accounts.setNativeProviderEnabled(input),
    onSuccess: next => client.setQueryData(aiAccountsKeys.nativeProviders, next),
  })
  if (query.isError) return <p className="dshx:px-2 dshx:text-xs dshx:text-muted-foreground">Restart DSH to manage built-in providers here.</p>
  if (state === null) return null
  if (!state.available) return <p className="dshx:px-2 dshx:text-xs dshx:text-muted-foreground">{state.reason}</p>
  const search = props.search?.trim().toLocaleLowerCase() ?? ''
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
      <ul className="dshx:flex dshx:flex-col dshx:gap-2">
        {state.providers
          .filter(provider => `${provider.label} ${provider.routes.join(' ')}`.toLocaleLowerCase().includes(search))
          .map(provider => (
            <li
              className={cn(
                'dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border/60 dshx:bg-card dshx:px-3 dshx:py-3',
                props.selectedEntryId === provider.entryId && 'dshx:border-info/60 dshx:bg-info/5',
              )}
              key={provider.entryId}
            >
              <button
                aria-current={props.selectedEntryId === provider.entryId ? 'true' : undefined}
                aria-label={`Select ${provider.label}`}
                className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-3 dshx:text-left"
                onClick={() => props.onSelect?.(provider.entryId)}
                type="button"
              >
                <span className="dshx:grid dshx:size-11 dshx:shrink-0 dshx:place-items-center dshx:rounded-lg dshx:bg-info dshx:text-primary-foreground">
                  <BoxIcon className="dshx:size-7" />
                </span>
                <span className="dshx:min-w-0">
                  <strong className="dshx:block dshx:truncate dshx:text-sm dshx:font-semibold">{provider.label}</strong>
                  <span className="dshx:mt-1 dshx:block dshx:text-[11px] dshx:text-muted-foreground">Built-in provider</span>
                </span>
              </button>
              <span
                className={cn(
                  'dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-[11px]',
                  provider.enabled && provider.running ? 'dshx:text-success' : 'dshx:text-muted-foreground',
                )}
              >
                <span aria-hidden className="dshx:size-2 dshx:rounded-full dshx:bg-current" />
                <span className="dshx:@max-pane-narrow:hidden">{nativeProviderStatus(provider, state.liveReload)}</span>
              </span>
              <Switch
                aria-label={`${provider.enabled ? 'Disable' : 'Enable'} ${provider.label}`}
                checked={provider.enabled}
                className="dshx:data-[state=checked]:bg-info"
                disabled={toggle.isPending || provider.lockedReason !== null}
                onCheckedChange={enabled => toggle.mutate({ entryId: provider.entryId, enabled })}
                size="sm"
              />
              <Button aria-label={`Open ${provider.label}`} onClick={() => props.onSelect?.(provider.entryId)} size="icon-xs" type="button" variant="ghost">
                <ChevronRightIcon />
              </Button>
            </li>
          ))}
      </ul>
      {toggle.isError ? (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          {errorMessage(toggle.error, 'Could not update the provider.')}
        </p>
      ) : null}
    </div>
  )
}

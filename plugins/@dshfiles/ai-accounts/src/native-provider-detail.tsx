import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { BoxIcon, LayersIcon, Settings2Icon, BarChart3Icon } from '@dshfiles/plugin-ui/icons'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { useState } from 'react'
import { aiAccountsApi } from './api.js'
import { aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { nativeProviderStatus } from './native-providers-list.js'
import type { AccountSection } from './account-connection-status.js'
import { AccountUsageDashboard } from './account-usage-dashboard.js'

export const NativeProviderDetail = (props: {
  readonly entryId: string
  readonly section: AccountSection
  readonly onSectionChange: (section: AccountSection) => void
  readonly onOpenUsageHistory: () => void
}): JSX.Element => {
  const api = useApi(aiAccountsApi)
  const client = useQueryClient()
  const query = useQuery(aiAccountsQueries.nativeProviders(api))
  const provider = query.data?.providers.find(row => row.entryId === props.entryId)
  const [route, setRoute] = useState<string | null>(null)
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setNativeProviderEnabled({ entryId: props.entryId, enabled }),
    onSuccess: next => client.setQueryData(aiAccountsKeys.nativeProviders, next),
  })
  if (provider === undefined)
    return (
      <section className="dshx:rounded-xl dshx:border dshx:bg-card dshx:p-6">
        <p role="status">{query.isError ? 'Built-in provider information is unavailable.' : 'Reading provider…'}</p>
      </section>
    )
  const activeRoute = route !== null && provider.routes.includes(route) ? route : provider.routes[0]
  return (
    <section aria-label="Selected built-in provider" className="dshx:@container dshx:min-w-0 dshx:rounded-xl dshx:border dshx:bg-card">
      <header className="dshx:flex dshx:items-center dshx:gap-4 dshx:p-6">
        <span className="dshx:grid dshx:size-16 dshx:place-items-center dshx:rounded-lg dshx:bg-info dshx:text-primary-foreground">
          <BoxIcon className="dshx:size-10" />
        </span>
        <div className="dshx:min-w-0 dshx:flex-1">
          <h2 className="dshx:truncate dshx:text-2xl dshx:font-semibold">{provider.label}</h2>
          <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">Built-in provider · {provider.entryId}</p>
        </div>
        <span className="dshx:text-xs dshx:text-success">{nativeProviderStatus(provider, query.data?.liveReload ?? false)}</span>
        <Switch
          aria-label={`${provider.enabled ? 'Disable' : 'Enable'} ${provider.label}`}
          checked={provider.enabled}
          className="dshx:data-[state=checked]:bg-info"
          disabled={toggle.isPending || provider.lockedReason !== null}
          onCheckedChange={enabled => toggle.mutate(enabled)}
        />
      </header>
      <Tabs
        onValueChange={value => {
          if (value === 'models' || value === 'settings' || value === 'usage') props.onSectionChange(value)
        }}
        value={props.section}
      >
        <TabsList aria-label="Provider sections" className="dshx:mx-4 dshx:h-12 dshx:gap-6 dshx:@max-pane-narrow:gap-0" variant="line">
          <TabsTrigger value="models">
            <LayersIcon />
            Models
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2Icon />
            Settings
          </TabsTrigger>
          <TabsTrigger value="usage">
            <BarChart3Icon />
            Usage
          </TabsTrigger>
        </TabsList>
        <TabsContent className="dshx:min-w-0 dshx:border-t dshx:p-5" value="models">
          <h3 className="dshx:mb-2 dshx:text-sm dshx:font-semibold">Provider routes</h3>
          <p className="dshx:mb-4 dshx:text-xs dshx:text-muted-foreground">
            This built-in provider owns its model catalog. It is separate from a saved AI Accounts profile.
          </p>
          <ul className="dshx:divide-y dshx:rounded-lg dshx:border">
            {provider.routes.map(id => (
              <li className="dshx:p-3 dshx:font-mono! dshx:text-sm" key={id}>
                {id}
              </li>
            ))}
          </ul>
          {provider.routes.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">No running route is currently registered.</p> : null}
        </TabsContent>
        <TabsContent className="dshx:border-t dshx:p-5 dshx:text-sm" value="settings">
          <h3 className="dshx:mb-3 dshx:font-semibold">Provider settings</h3>
          <p className="dshx:text-muted-foreground">
            Its configuration and credentials remain owned by the provider's plugin. The routing switch keeps these settings intact.
          </p>
          <p className="dshx:mt-3 dshx:text-xs">
            {provider.lockedReason ?? (query.data?.liveReload ? 'Changes apply live.' : 'A DSH restart is required to apply routing changes.')}
          </p>
        </TabsContent>
        <TabsContent className="dshx:min-w-0 dshx:border-t dshx:p-4" value="usage">
          {provider.routes.length > 1 ? (
            <div className="dshx:mb-4">
              <Combobox
                label="Provider route"
                onValueChange={setRoute}
                options={provider.routes.map(value => ({ value, label: value }))}
                value={activeRoute ?? ''}
              />
            </div>
          ) : null}
          {activeRoute === undefined ? (
            <p className="dshx:text-sm dshx:text-muted-foreground">Usage cannot be attributed without a provider route.</p>
          ) : (
            <AccountUsageDashboard accountId={activeRoute} displayName={provider.label} onOpenUsageHistory={props.onOpenUsageHistory} />
          )}
        </TabsContent>
      </Tabs>
      {toggle.isError ? (
        <p className="dshx:p-4 dshx:text-xs dshx:text-destructive" role="alert">
          Could not update this provider.
        </p>
      ) : null}
    </section>
  )
}

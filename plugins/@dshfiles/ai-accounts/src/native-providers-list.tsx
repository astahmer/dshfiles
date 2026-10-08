import { useApi } from '@dshfiles/dshx/client'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCallback, useEffect, useState } from 'react'
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
  const [state, setState] = useState<NativeProviders | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void accounts
      .nativeProviders()
      .then(next => {
        setState(next)
        setMissing(false)
      })
      .catch(() => setMissing(true))
  }, [accounts])

  useEffect(load, [load])

  // A live reload lands a couple of seconds after the patch is written; read again once it has.
  const pending = state?.providers.some(provider => provider.enabled !== provider.running && provider.lockedReason === null) === true
  useEffect(() => {
    if (!pending || state?.liveReload !== true) return
    const timer = setTimeout(load, 3_500)
    return () => clearTimeout(timer)
  }, [pending, state, load])

  if (missing) return <p className="dshx:px-2 dshx:text-xs dshx:text-muted-foreground">Restart DSH to switch native providers from here.</p>
  if (state === null) return null
  if (!state.available) return <p className="dshx:px-2 dshx:text-xs dshx:text-muted-foreground">{state.reason}</p>
  if (state.providers.length === 0) return null

  const toggle = (provider: Provider, enabled: boolean): void => {
    setBusy(provider.entryId)
    setError(null)
    void accounts
      .setNativeProviderEnabled({ entryId: provider.entryId, enabled })
      .then(setState)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(null))
  }

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
              disabled={busy !== null || provider.lockedReason !== null}
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

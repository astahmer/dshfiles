import type { SecretLinkRevealProps } from '@dshfiles/backlog/secret-link-reveal'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { EyeIcon, EyeOffIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { secretCatalogApi } from './api.js'
import { CatalogNavigation } from './catalog-navigation.js'
import type { SecretCatalogTranslate } from './locales.js'
import { secretLinkTarget } from './secret-link-reveal-model.js'
import { secretCatalogSettings } from './settings.js'
import { useSecretReveal } from './use-secret-reveal.js'

const hint = 'dshx:text-[11px] dshx:text-muted-foreground'

const OpenInCatalog = (props: { readonly alias: string; readonly t: SecretCatalogTranslate }): JSX.Element | null =>
  CatalogNavigation.available ? (
    <Button type="button" variant="link" size="sm" className="dshx:h-auto dshx:p-0 dshx:text-[11px]" onClick={() => CatalogNavigation.open(props.alias)}>
      {props.t('refActionOpenCatalog')}
    </Button>
  ) : null

/**
 * An item's `secret:` link revealed in place, through the Catalog's own `reveal` verb and reveal machine: an explicit
 * click, hidden again after the configured seconds, on Esc or on Hide. The value lives only in this control's
 * machine while shown; nothing is written back to the item, the cache or the backlog.
 */
export const SecretLinkRevealControl = (props: SecretLinkRevealProps & { readonly t: SecretCatalogTranslate }): JSX.Element | null => {
  const t = props.t
  const api = useApi(secretCatalogApi)
  const settings = useSettings(secretCatalogSettings)
  const revealMs = (settings.value?.revealSeconds ?? 15) * 1000
  const [snapshot, send] = useSecretReveal(api)
  const rows = useQuery({
    queryKey: ['secret-catalog', 'link-reveal', props.cwd],
    queryFn: ({ signal }) => api.list({ cwd: props.cwd }, { signal }),
    retry: false,
    staleTime: 30_000,
  })
  if (rows.isPending) return null
  if (rows.isError) {
    return (
      <span className={hint} data-testid="secret-link-reveal-unavailable">
        {t('linkRevealUnavailable')}{' '}
        <Button type="button" variant="link" size="sm" className="dshx:h-auto dshx:p-0 dshx:text-[11px]" onClick={() => void rows.refetch()}>
          {t('refActionRecheck')}
        </Button>
      </span>
    )
  }
  const target = secretLinkTarget(props.reference, rows.data)
  if (target.state === 'invalid') return null
  if (target.state === 'missing') {
    return (
      <span className={hint} data-testid="secret-link-reveal-missing">
        {t('linkRevealMissing')} <OpenInCatalog alias={target.reference.alias} t={t} />
      </span>
    )
  }
  if (target.state === 'ambiguous') {
    return (
      <span className={hint} data-testid="secret-link-reveal-ambiguous">
        {t('linkRevealAmbiguous', { scopes: target.scopes.join(', ') })} <OpenInCatalog alias={target.reference.alias} t={t} />
      </span>
    )
  }
  const { row, scope } = target
  const revealed = snapshot.context.revealed?.rowId === row.id ? snapshot.context.revealed.value : null
  const loading = snapshot.matches('loading')
  const toggle = (): void =>
    send({ type: 'toggle', rowId: row.id, payload: { alias: row.alias, cwd: props.cwd, scope, environment: row.environment }, revealMs })
  return (
    <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5" data-testid="secret-link-reveal">
      {revealed === null ? null : (
        <output
          aria-label={t('revealedValue', { alias: row.alias })}
          className="dshx:min-w-0 dshx:truncate dshx:rounded-sm dshx:bg-muted dshx:px-1.5 dshx:py-0.5 dshx:font-mono dshx:text-xs dshx:select-all"
          onKeyDown={event => {
            if (event.key === 'Escape') send({ type: 'hide' })
          }}
          tabIndex={0}
        >
          {revealed}
        </output>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="dshx:size-6 dshx:shrink-0"
        aria-label={revealed === null ? t('revealAlias', { alias: row.alias }) : t('hideAlias', { alias: row.alias })}
        aria-pressed={revealed !== null}
        disabled={loading}
        onClick={toggle}
      >
        {loading ? <Spinner /> : revealed === null ? <EyeIcon aria-hidden className="dshx:size-3.5" /> : <EyeOffIcon aria-hidden className="dshx:size-3.5" />}
      </Button>
      {snapshot.matches('failed') ? (
        <span role="alert" className="dshx:text-[11px] dshx:text-destructive">
          {t('revealFailed')}
        </span>
      ) : null}
    </span>
  )
}

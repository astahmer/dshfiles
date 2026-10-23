import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { CheckIcon, ExternalLinkIcon, KeyRoundIcon, ListIcon, RefreshCwIcon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { secretCatalogApi, secretSetupApi } from './api.js'
import { CatalogNavigation } from './catalog-navigation.js'
import type { SecretCatalogTranslate } from './locales.js'
import { repairView } from './secret-reference-repair-model.js'
import type { SecretReferenceStatus } from './secret-reference-status-schema.js'
import { SecretSetupModel } from './secret-setup-model.js'

export const referenceStatusKey = ['secret-catalog', 'reference-status'] as const

interface SecretReferenceRepairProps {
  readonly reference: string
  readonly cwd: string | null
  readonly probeFolders?: readonly string[]
  readonly t: SecretCatalogTranslate
  /** Writes another reference into the owning setting; the picker is offered only when it is given. */
  readonly onBind?: (reference: string) => Promise<void>
  readonly className?: string
}

/**
 * The repair card for a stored `secret:ALIAS[@env]` that does not resolve: it names the reference and the Host's
 * typed reason, and offers the fixes that reason allows — set the value in the right scope, pick another secret,
 * open the Catalog on that alias, or re-check. It renders nothing while the reference resolves.
 */
export const SecretReferenceRepair = (props: SecretReferenceRepairProps): JSX.Element | null => {
  const setupApi = useApi(secretSetupApi)
  const catalogApi = useApi(secretCatalogApi)
  const queryClient = useQueryClient()
  const t = props.t
  const probeFolders = props.probeFolders ?? []
  const status = useQuery({
    queryKey: [...referenceStatusKey, props.reference, props.cwd, probeFolders],
    queryFn: ({ signal }) => setupApi.referenceStatus({ reference: props.reference, cwd: props.cwd, probeFolders: [...probeFolders] }, { signal }),
    retry: false,
    staleTime: 5_000,
  })
  const [mode, setMode] = useState<'idle' | 'set' | 'pick'>('idle')
  const [value, setValue] = useState('')
  const sawFailure = useRef(false)
  const data: SecretReferenceStatus | undefined = status.data
  const view = data === undefined ? null : repairView(data)

  useEffect(() => {
    if (data !== undefined && data.state !== 'resolved' && data.state !== 'empty') sawFailure.current = true
  }, [data])
  useEffect(() => {
    setMode('idle')
    setValue('')
  }, [props.reference])

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: referenceStatusKey }),
      queryClient.invalidateQueries({ queryKey: ['secret-catalog', 'list'] }),
    ])
  }

  const store = useMutation({
    mutationFn: async (secretValue: string) => {
      if (data === undefined || data.alias === null || data.environment === null || view?.setValue === null) throw new Error(t('refSaveUnavailable'))
      if (view?.setValue === 'replace') {
        if (data.scope === null) throw new Error(t('refSaveUnavailable'))
        await catalogApi.update({ alias: data.alias, cwd: data.cwd, scope: data.scope, environment: data.environment, value: secretValue })
        return
      }
      await setupApi.create({
        alias: data.alias,
        cwd: data.writeScope === 'global' ? null : data.cwd,
        scope: data.writeScope,
        environment: data.environment,
        valueMode: 'manual',
        value: secretValue,
      })
    },
    onSuccess: async () => {
      setMode('idle')
      await invalidate()
    },
  })

  const bind = useMutation({
    mutationFn: async (reference: string) => {
      if (props.onBind === undefined) return
      await props.onBind(reference)
    },
    onSuccess: async () => {
      setMode('idle')
      await invalidate()
    },
  })

  const pickable = useQuery({
    queryKey: ['secret-catalog', 'list', props.cwd],
    enabled: mode === 'pick',
    queryFn: ({ signal }) => setupApi.list({ cwd: props.cwd }, { signal }),
    retry: false,
    staleTime: 30_000,
  })
  const pickRows = useMemo(
    () => SecretSetupModel.uniquelyBindableSecrets(pickable.data ?? []).filter(row => SecretSetupModel.reference(row) !== data?.reference),
    [pickable.data, data?.reference],
  )

  if (status.isPending) return null
  if (data?.state === 'resolved') {
    if (!sawFailure.current) return null
    return (
      <p
        className={cn('dshx-root dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-success', props.className)}
        data-testid="secret-reference-resolved"
        role="status"
      >
        <CheckIcon aria-hidden="true" className="dshx:size-3.5" />
        {t('refStateResolved', { reference: data.reference ?? props.reference })}
      </p>
    )
  }
  if (data !== undefined && view === null) return null

  const message = view === null ? t('refStateCheckFailed', { reference: props.reference }) : t(view.messageKey, view.params)
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (value.length === 0 || store.isPending) return
    setValue('')
    store.mutate(value)
  }
  const alias = data?.alias ?? null

  return (
    <section
      aria-label={t('refRepairTitle')}
      className={cn(
        'dshx-root dshx:flex dshx:max-w-xl dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-warning/50 dshx:bg-card dshx:p-3 dshx:text-xs',
        props.className,
      )}
      data-state={data?.state ?? 'check-failed'}
      data-testid="secret-reference-repair"
    >
      <p className="dshx:flex dshx:items-start dshx:gap-1.5" role="alert">
        <TriangleAlertIcon aria-hidden="true" className="dshx:mt-0.5 dshx:size-3.5 dshx:shrink-0 dshx:text-warning" />
        <span className="dshx:min-w-0 dshx:break-words">{message}</span>
      </p>
      {view?.symlinkTarget !== null && view?.symlinkTarget !== undefined ? (
        <p className="dshx:text-muted-foreground" data-testid="secret-reference-symlink-warning">
          {t('refSymlinkWarning', { target: view.symlinkTarget })}
        </p>
      ) : null}
      {mode === 'set' && view?.setValue !== null && view !== null ? (
        <form className="dshx:flex dshx:flex-col dshx:gap-1.5" noValidate onSubmit={submit}>
          <span className="dshx:text-muted-foreground">
            {t(view.setValue === 'replace' ? 'refReplaceTarget' : 'refCreateTarget', {
              alias: alias ?? '',
              environment: data?.environment ?? '',
              scope: view.setValue === 'replace' ? (data?.scope ?? '') : (data?.writeScope ?? ''),
            })}
          </span>
          <div className="dshx:flex dshx:gap-2">
            <Input
              aria-label={t('refValueLabel', { alias: alias ?? '' })}
              autoComplete="new-password"
              autoFocus
              className="dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:font-mono! dshx:text-xs"
              disabled={store.isPending}
              onChange={event => setValue(event.currentTarget.value)}
              placeholder={t('jevSetupValuePlaceholder')}
              spellCheck={false}
              type="password"
              value={value}
            />
            <Button disabled={store.isPending || value.length === 0} size="sm" type="submit">
              {store.isPending ? <Spinner /> : null}
              {t('refSave')}
            </Button>
            <Button disabled={store.isPending} onClick={() => setMode('idle')} size="sm" type="button" variant="ghost">
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : null}
      {store.isError ? (
        <p className="dshx:text-destructive" role="alert">
          {t('refSaveFailed', { reason: errorMessage(store.error, t('setupCreateFailed')) })}
        </p>
      ) : null}
      {mode === 'pick' ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          {pickable.isPending ? (
            <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-muted-foreground">
              <Spinner /> {t('loadingMetadata')}
            </span>
          ) : null}
          {pickable.isError ? <span className="dshx:text-destructive">{t('loadFailed')}</span> : null}
          {pickable.data !== undefined && pickRows.length === 0 ? <span className="dshx:text-muted-foreground">{t('noBindableAliases')}</span> : null}
          <ul aria-label={t('secretAliases')} className="dshx:flex dshx:max-h-48 dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto">
            {pickRows.map(row => (
              <li key={row.id}>
                <button
                  className="dshx:flex dshx:w-full dshx:items-baseline dshx:gap-2 dshx:rounded-sm dshx:px-2 dshx:py-1 dshx:text-left dshx:hover:bg-accent"
                  disabled={bind.isPending}
                  onClick={() => bind.mutate(SecretSetupModel.reference(row))}
                  type="button"
                >
                  <span className="dshx:font-mono! dshx:text-xs">{`${row.alias}@${row.environment}`}</span>
                  <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground">{row.scope}</span>
                </button>
              </li>
            ))}
          </ul>
          {bind.isError ? <span className="dshx:text-destructive">{errorMessage(bind.error, t('setupBindFailed'))}</span> : null}
        </div>
      ) : null}
      <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
        {view?.setValue !== null && view !== null && mode !== 'set' ? (
          <Button onClick={() => setMode('set')} size="sm" type="button" variant="outline">
            <KeyRoundIcon />
            {t(view.setValue === 'replace' ? 'refActionReplaceValue' : 'refActionSetValue')}
          </Button>
        ) : null}
        {props.onBind !== undefined ? (
          <Button onClick={() => setMode(current => (current === 'pick' ? 'idle' : 'pick'))} size="sm" type="button" variant="outline">
            <ListIcon />
            {t('refActionPick')}
          </Button>
        ) : null}
        {alias !== null && CatalogNavigation.available ? (
          <Button onClick={() => CatalogNavigation.open(alias)} size="sm" type="button" variant="ghost">
            <ExternalLinkIcon />
            {t('refActionOpenCatalog')}
          </Button>
        ) : null}
        <Button disabled={status.isFetching} onClick={() => void status.refetch()} size="sm" type="button" variant="ghost">
          {status.isFetching ? <Spinner /> : <RefreshCwIcon />}
          {t('refActionRecheck')}
        </Button>
      </div>
    </section>
  )
}

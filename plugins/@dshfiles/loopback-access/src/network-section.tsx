import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { fieldErrorMessages, revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useId, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { loopbackAccessApi } from './api.js'
import type { NetworkTranslate } from './locales.js'
import { networkFormSchema, networkSnapshotSchema, type NetworkForm, type NetworkSnapshot } from './network-api.js'

const networkQueryKey = ['loopback-access', 'network'] as const

type NetworkSaveInput = NetworkForm & { readonly expectedRevision: number }

const networkDraft = (preferences: NetworkForm) => ({
  lanEnabled: preferences.lanEnabled,
  bindAddress: preferences.bindAddress,
  port: String(preferences.port),
})

const Row = (props: { readonly label: string; readonly hint: string; readonly htmlFor: string; readonly children: ReactNode }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-4 dshx:py-3">
    <div className="dshx:min-w-0 dshx:flex-1">
      <label className="dshx:text-sm dshx:font-medium" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      <p className="dshx:m-0 dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">{props.hint}</p>
    </div>
    {props.children}
  </div>
)

/** Status refreshes never replace this mounted form's draft or its optimistic-concurrency baseline. */
export const NetworkPreferences = (props: {
  readonly snapshot: NetworkSnapshot
  readonly t: NetworkTranslate
  readonly save: (input: NetworkSaveInput) => Promise<NetworkSnapshot>
  readonly unavailable?: boolean
}): JSX.Element => {
  const { snapshot, t } = props
  const id = useId()
  const revision = useRef(snapshot.revision)
  const [initial, setInitial] = useState(() => networkDraft(snapshot.saved))
  const save = useMutation({ mutationFn: (input: NetworkSaveInput) => props.save(input) })
  const readOnly = !snapshot.writable || snapshot.integration !== 'managed' || props.unavailable === true
  const disabled = readOnly || save.isPending
  const draftSchema = networkFormSchema
    .omit({ localhostEnabled: true })
    .extend({
      port: z.string().refine(value => /^\d+$/u.test(value) && Number(value) <= 65535, t('invalidPort')),
    })
    .superRefine((value, context) => {
      if (value.lanEnabled && !snapshot.addresses.some(item => item.address === value.bindAddress)) {
        context.addIssue({ code: 'custom', path: ['bindAddress'], message: t('addressRequired') })
      }
    })
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: draftSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await save.mutateAsync({
          ...value,
          // Older Hosts require this wire field; it is no longer an editable preference.
          localhostEnabled: true,
          port: Number(value.port),
          expectedRevision: revision.current,
        })
        revision.current = result.revision
        const next = networkDraft(result.saved)
        setInitial(next)
        formApi.reset(next)
      } catch {
        // The mutation owns and renders this failure; keep the user's draft for correction/retry.
      }
    },
  })
  const options: ComboboxOption[] = Array.from(
    new Map(
      snapshot.addresses.map(item => [
        item.address,
        {
          value: item.address,
          label: `${item.interfaceName} · ${item.address}`,
          keywords: [item.interfaceName, item.address, item.family],
        },
      ]),
    ).values(),
  )

  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
      {snapshot.integration === 'unsupported' ? (
        <p role="status" className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
          {snapshot.unavailableReason ?? t('unsupported')}
        </p>
      ) : null}
      {!snapshot.writable && snapshot.integration !== 'unsupported' ? (
        <p role="status" className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
          {t('readOnly')}
        </p>
      ) : null}
      {snapshot.integration === 'needs-setup' ? <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">{t('setup')}</p> : null}
      {snapshot.cliOverrides.host !== null || snapshot.cliOverrides.port !== null ? (
        <div role="status" className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted dshx:p-3 dshx:text-xs">
          <p className="dshx:m-0">{t('cliOverride')}</p>
          {snapshot.cliOverrides.host !== null ? (
            <p className="dshx:m-0 dshx:mt-1 dshx:break-all">
              {t('hostOverride')}: {snapshot.cliOverrides.host}
            </p>
          ) : null}
          {snapshot.cliOverrides.port !== null ? (
            <p className="dshx:m-0 dshx:mt-1">
              {t('portOverride')}: {snapshot.cliOverrides.port}
            </p>
          ) : null}
        </div>
      ) : null}
      <form
        noValidate
        onSubmit={event => {
          event.preventDefault()
          if (!disabled) void form.handleSubmit()
        }}
      >
        <fieldset disabled={disabled} className="dshx:m-0 dshx:min-w-0 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:px-4 dshx:pb-4">
          <form.Field name="lanEnabled">
            {field => (
              <Row htmlFor={`${id}-lan`} label={t('lanEnabled')} hint={t('lanHint')}>
                <Switch
                  id={`${id}-lan`}
                  aria-label={t('lanEnabled')}
                  checked={field.state.value}
                  disabled={disabled}
                  onCheckedChange={enabled => {
                    field.handleChange(enabled)
                    save.reset()
                  }}
                />
              </Row>
            )}
          </form.Field>
          <form.Subscribe selector={state => state.values.lanEnabled}>
            {lanEnabled =>
              lanEnabled ? (
                <form.Field name="bindAddress">
                  {field => {
                    const choices =
                      field.state.value === null || options.some(item => item.value === field.state.value)
                        ? options
                        : [{ value: field.state.value, label: `${t('missingAddress')} · ${field.state.value}`, disabled: true }, ...options]
                    const errors = fieldErrorMessages(field.state.meta.errors)
                    return (
                      <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:pb-3">
                        <span className="dshx:text-sm dshx:font-medium">{t('bindAddress')}</span>
                        <Combobox
                          label={t('bindAddress')}
                          value={field.state.value ?? ''}
                          options={choices}
                          disabled={disabled}
                          placeholder={t('chooseAddress')}
                          searchLabel={t('addressSearch')}
                          searchPlaceholder={t('addressSearch')}
                          emptyLabel={t('noAddresses')}
                          matchTriggerWidth
                          onValueChange={value => {
                            field.handleChange(value)
                            save.reset()
                          }}
                        />
                        {errors.length > 0 ? (
                          <p role="alert" className="dshx:m-0 dshx:text-xs dshx:text-destructive">
                            {errors.join(' ')}
                          </p>
                        ) : null}
                      </div>
                    )
                  }}
                </form.Field>
              ) : null
            }
          </form.Subscribe>
          <details className="dshx:border-t dshx:border-border dshx:py-3">
            <summary className="dshx:cursor-pointer dshx:text-sm dshx:font-medium">{t('advanced')}</summary>
            <form.Field name="port">
              {field => {
                const errors = fieldErrorMessages(field.state.meta.errors)
                return (
                  <div className="dshx:mt-3 dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
                    <label htmlFor={`${id}-port`} className="dshx:text-sm">
                      {t('port')}
                    </label>
                    <Input
                      id={`${id}-port`}
                      aria-label={t('port')}
                      aria-describedby={`${id}-port-help`}
                      aria-invalid={errors.length > 0}
                      className="dshx:w-32 dshx:max-w-full"
                      type="number"
                      min={0}
                      max={65535}
                      step={1}
                      inputMode="numeric"
                      value={field.state.value}
                      disabled={disabled}
                      onBlur={field.handleBlur}
                      onChange={event => {
                        field.handleChange(event.currentTarget.value)
                        save.reset()
                      }}
                    />
                    <p id={`${id}-port-help`} className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">
                      {t('portHint')}
                    </p>
                    {errors.length > 0 ? (
                      <p role="alert" className="dshx:m-0 dshx:text-xs dshx:text-destructive">
                        {errors.join(' ')}
                      </p>
                    ) : null}
                  </div>
                )
              }}
            </form.Field>
          </details>
          <form.Subscribe selector={state => state.isSubmitting}>
            {submitting => (
              <Button type="submit" size="sm" disabled={disabled || submitting}>
                {t(submitting ? 'saving' : 'save')}
              </Button>
            )}
          </form.Subscribe>
          {save.isError ? (
            <p role="alert" className="dshx:m-0 dshx:mt-3 dshx:text-sm dshx:text-destructive">
              {errorMessage(save.error, t('saveFailed'))}
            </p>
          ) : null}
          {save.isSuccess ? (
            <p role="status" className="dshx:m-0 dshx:mt-3 dshx:text-xs dshx:text-muted-foreground">
              {t('saved')}
            </p>
          ) : null}
        </fieldset>
      </form>
      <section aria-label={t('currentUrls')} className="dshx:min-w-0 dshx:rounded-xl dshx:border dshx:border-border dshx:p-4">
        <h3 className="dshx:m-0 dshx:text-sm dshx:font-medium">{t('currentUrls')}</h3>
        <p className="dshx:m-0 dshx:mt-1 dshx:break-all dshx:text-xs dshx:text-muted-foreground">
          {t('currentListener')}: {snapshot.active.host} · {snapshot.active.port}
        </p>
        <ul className="dshx:m-0 dshx:mt-2 dshx:flex dshx:list-none dshx:flex-col dshx:gap-1 dshx:p-0">
          {snapshot.active.urls.map(url => (
            <li key={url} className="dshx:min-w-0 dshx:break-all dshx:text-xs">
              <code>{url}</code>
            </li>
          ))}
        </ul>
        <p role="status" className="dshx:m-0 dshx:mt-3 dshx:text-xs dshx:text-muted-foreground">
          {t(snapshot.pendingRestart ? 'pendingRestart' : 'active')}
        </p>
      </section>
    </div>
  )
}

export const NetworkSection = (props: { readonly t: NetworkTranslate }): JSX.Element => {
  const api = useApi(loopbackAccessApi)
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: networkQueryKey,
    retry: false,
    queryFn: async ({ signal }) => networkSnapshotSchema.parse(await api.network(undefined, { signal })),
  })
  return (
    <section className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:max-w-2xl dshx:flex-col dshx:gap-4">
      <header>
        <h2 className="dshx:m-0 dshx:text-lg dshx:font-semibold">{props.t('networkAccess')}</h2>
        <p className="dshx:m-0 dshx:mt-1 dshx:text-sm dshx:text-muted-foreground">{props.t('description')}</p>
      </header>
      {query.isPending ? (
        <p role="status" className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
          {props.t('loading')}
        </p>
      ) : null}
      {query.isError ? (
        <div role="alert" className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
          <p className="dshx:m-0">{props.t('unavailable')}</p>
          <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {props.t('retry')}
          </Button>
        </div>
      ) : null}
      {query.data === undefined ? null : (
        <NetworkPreferences
          t={props.t}
          snapshot={query.data}
          unavailable={query.isError}
          save={async input => {
            const snapshot = networkSnapshotSchema.parse(await api.saveNetwork(input))
            queryClient.setQueryData(networkQueryKey, snapshot)
            return snapshot
          }}
        />
      )}
    </section>
  )
}

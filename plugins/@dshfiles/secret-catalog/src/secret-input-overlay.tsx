import { useApi } from '@dshfiles/dshx/client'
import { parseSecretReference } from '@dshfiles/credential-port'
import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { KeyRoundIcon, PlusIcon, SearchIcon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { secretCatalogApi, secretSetupApi } from './api.js'
import { JevSecretSetup } from './jev-secret-setup.js'
import type { SecretCatalogTranslate } from './locales.js'
import type { SecretMetadata } from './secret-metadata.js'
import { SecretInputBinding } from './secret-input-bind.js'
import { JEV_SECRET_ALIAS, JEV_SECRET_ENVIRONMENT, saveGlobalJevSecret } from './jev-secret-store.js'
import { placeSecretButton, placeSecretPanel } from './secret-input-placement.js'
import { type FieldAnchor, secretInputOverlayMachine } from './secret-input-overlay-machine.js'
import { SecretSetupForm } from './secret-setup-form.js'
import type { SecretSetupTarget } from './secret-setup-form.js'
import { SecretSetupModel } from './secret-setup-model.js'
import { SecretSetupSteps } from './secret-setup-step.js'
import { referenceStatusKey, SecretReferenceRepair } from './secret-reference-repair.js'

const noProbeFolders: readonly string[] = []

interface SecretInputOverlayProps {
  readonly t: SecretCatalogTranslate
}

const panelWidth = 320

const measure = (element: Element): FieldAnchor | null => {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return null
  if (!element.isConnected || !SecretInputBinding.accepts(element)) return null
  const rect = element.getBoundingClientRect()
  return rect.width === 0 || rect.height === 0 ? null : { element, rect }
}

const rowText = (row: SecretMetadata): string => `${row.alias}@${row.environment}`

const isBacklogJevField = (element: Element): boolean => {
  const setting = element.closest('[data-setting-path]')
  const settings = element.closest('[data-settings-namespace]')
  return SecretInputBinding.isBacklogJevSetting({
    namespace: settings?.getAttribute('data-settings-namespace') ?? null,
    path: setting?.getAttribute('data-setting-path') ?? null,
  })
}

const targetOf = (element: HTMLInputElement | HTMLTextAreaElement): SecretSetupTarget => {
  const cwd = element.dataset.secretCwd
  const parsedScope = Schema.decodeUnknownOption(secretScopeSchemaEffect)(element.dataset.secretScope)
  const target: SecretSetupTarget = {
    cwd: cwd === undefined || cwd === '' ? null : cwd,
  }
  if (element.dataset.secretAlias !== undefined) target.suggestedAlias = element.dataset.secretAlias
  if (element.dataset.secretEnvironment !== undefined) target.environment = element.dataset.secretEnvironment
  if (Option.isSome(parsedScope)) target.scope = parsedScope.value
  return target
}

/**
 * Offers the Secret Catalog on any input carrying `data-secret-input="reference"`, the way a password manager offers
 * its vault on a login field. A pick writes `secret:ALIAS[@env]`; the field therefore stores a reference, and the
 * value is resolved later on the Host by whoever consumes it.
 */
export const SecretInputOverlay = (props: SecretInputOverlayProps): JSX.Element | null => {
  const api = useApi(secretCatalogApi)
  const setupApi = useApi(secretSetupApi)
  const queryClient = useQueryClient()
  const [snapshot, send, actor] = useMachine(secretInputOverlayMachine)
  const [query, setQuery] = useState('')
  const [panelSize, setPanelSize] = useState({ width: panelWidth, height: 0 })
  const [fieldText, setFieldText] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLSpanElement | null>(null)
  const anchor = snapshot.context.anchor
  const jevSetupOpen = snapshot.matches('jevSetup')
  const jevSetupPending = snapshot.matches({ jevSetup: 'saving' })
  const creating = snapshot.matches('create')
  const open = snapshot.matches('list') || creating || jevSetupOpen
  const createStep = snapshot.context.create?.step ?? SecretSetupSteps.draft()

  const setAnchor = useCallback(
    (element: Element | null) => {
      send({ type: 'measure', anchor: element === null || !SecretInputBinding.accepts(element) ? null : measure(element) })
    },
    [send],
  )

  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const element = event.target
      if (!(element instanceof Element) || !element.matches(SecretInputBinding.selector)) return
      send({ type: 'focus', anchor: measure(element) })
    }
    const onFocusOut = (event: FocusEvent): void => {
      const next = event.relatedTarget
      const target = event.target
      const focusStaysInside = next instanceof Node && (panelRef.current?.contains(next) === true || toggleRef.current?.contains(next) === true)
      const focusedLayerElementWasRemoved =
        next === null && target instanceof Node && (panelRef.current?.contains(target) === true || toggleRef.current?.contains(target) === true)
      if (focusStaysInside || focusedLayerElementWasRemoved) return
      window.setTimeout(() => {
        if (actor.getSnapshot().matches({ jevSetup: 'saving' })) return
        const active = document.activeElement
        const keepOpen = panelRef.current?.contains(active) === true || toggleRef.current?.contains(active) === true
        if (active !== null && (active.matches(SecretInputBinding.selector) || keepOpen)) return
        send({ type: 'blur' })
      }, 0)
    }
    const onCreate = (event: Event): void => {
      const element = event.target
      if (!(element instanceof Element) || !element.matches(SecretInputBinding.selector) || !SecretInputBinding.accepts(element)) return
      if (actor.getSnapshot().matches({ jevSetup: 'saving' })) return
      element.focus()
      const measured = measure(element)
      if (measured !== null) send({ type: 'create', anchor: measured })
    }
    const remeasure = (): void => {
      const current = actor.getSnapshot().context.anchor
      if (current !== null) setAnchor(current.element)
    }
    document.addEventListener(SecretInputBinding.createEvent, onCreate)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    return () => {
      document.removeEventListener(SecretInputBinding.createEvent, onCreate)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
    }
  }, [actor, send, setAnchor])

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (panel === null) return
    const remeasure = (): void => setPanelSize({ width: panel.offsetWidth, height: panel.scrollHeight })
    remeasure()
    const observer = new ResizeObserver(remeasure)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [open, creating, jevSetupOpen])

  const anchoredElement = anchor?.element ?? null
  useEffect(() => {
    if (anchoredElement === null) return setFieldText('')
    const read = (): void => setFieldText(anchoredElement.value)
    read()
    anchoredElement.addEventListener('input', read)
    return () => anchoredElement.removeEventListener('input', read)
  }, [anchoredElement])
  const settledText = useDebouncedValue({ value: fieldText, delayMs: 400 }).trim()
  const fieldReference = parseSecretReference(settledText) === null ? null : settledText

  const cwd = anchor === null ? null : targetOf(anchor.element).cwd
  // Same key and options as the repair card, so the badge and the card share one Host check.
  const referenceStatus = useQuery({
    queryKey: [...referenceStatusKey, fieldReference ?? '', cwd, noProbeFolders],
    enabled: fieldReference !== null,
    queryFn: ({ signal }) => setupApi.referenceStatus({ reference: fieldReference ?? '', cwd, probeFolders: [] }, { signal }),
    retry: false,
    staleTime: 5_000,
  })
  const referenceState = fieldReference === null ? null : (referenceStatus.data?.state ?? null)
  const referenceUnresolved = referenceState !== null && referenceState !== 'resolved' && referenceState !== 'empty'
  useEffect(() => {
    if (!referenceUnresolved || fieldReference === null) return
    send({ type: 'reference.unresolved', reference: fieldReference })
  }, [fieldReference, referenceUnresolved, send])
  const listQuery = useQuery({
    queryKey: ['secret-catalog', 'list', cwd],
    enabled: anchor !== null,
    staleTime: 30_000,
    queryFn: ({ signal }) => api.list({ cwd }, { signal }),
  })

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase()
    const matches = SecretSetupModel.uniquelyBindableSecrets(listQuery.data ?? [])
    return text === '' ? matches : matches.filter(row => rowText(row).toLowerCase().includes(text) || row.item.toLowerCase().includes(text))
  }, [listQuery.data, query])
  const jevRows = useMemo(
    () => (listQuery.data ?? []).filter(row => row.alias === JEV_SECRET_ALIAS && row.environment === JEV_SECRET_ENVIRONMENT && row.scope === 'global'),
    [listQuery.data],
  )
  const backlogJevField = anchor !== null && isBacklogJevField(anchor.element)
  let jevUnavailable: 'loading' | 'failed' | 'ambiguous' | null = null
  if (listQuery.isError) jevUnavailable = 'failed'
  else if (listQuery.data === undefined) jevUnavailable = 'loading'
  else if (jevRows.length > 1) jevUnavailable = 'ambiguous'

  const saveJevKey = async (value: string): Promise<void> => {
    if (anchor === null || !(anchor.element instanceof HTMLInputElement) || !anchor.element.isConnected)
      throw new Error('The Jev setting is no longer available.')
    if (!isBacklogJevField(anchor.element) || jevRows.length > 1) throw new Error('The Jev setting is not ready for a key.')
    const reference = await saveGlobalJevSecret({ api, existing: jevRows.length === 1, value })
    SecretInputBinding.writeValue(anchor.element, reference)
    anchor.element.focus()
    anchor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    anchor.element.blur()
    void queryClient.invalidateQueries({ queryKey: ['secret-catalog'] })
  }

  const choose = (row: SecretMetadata): void => {
    if (anchor === null) return
    SecretInputBinding.writeValue(anchor.element, SecretInputBinding.referenceText({ alias: row.alias, environment: row.environment }))
    send({ type: 'pick' })
    anchor.element.focus()
  }

  if (anchor === null) return null
  const layer = anchor.element.closest('[role="dialog"]') ?? document.body
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const settingLabel = backlogJevField
    ? anchor.element.closest('[data-setting-path="jevSecret"]')?.querySelector('[data-setting-label="jevSecret"]')?.getBoundingClientRect()
    : undefined
  const showJevLabel = settingLabel !== undefined
  const button = showJevLabel
    ? placeSecretButton({ anchor: settingLabel, viewport, width: 104, height: 28, align: 'after' })
    : placeSecretButton({ anchor: anchor.rect, viewport })
  const placement = placeSecretPanel({ anchor: anchor.rect, panel: { width: panelSize.width, height: panelSize.height || 1 }, viewport })
  return createPortal(
    <>
      <span className="dshx:pointer-events-auto" ref={toggleRef} style={{ position: 'fixed', left: button.left, top: button.top, zIndex: 61 }}>
        <Button
          aria-description={referenceUnresolved ? props.t('refUnresolvedBadge') : undefined}
          aria-expanded={open}
          data-reference-state={referenceState ?? undefined}
          aria-label={backlogJevField ? props.t('jevSetupButton') : props.t('bindSecret')}
          data-testid={backlogJevField ? 'secret-input-jev-setup' : 'secret-input-bind'}
          disabled={jevSetupPending || creating}
          onClick={() => {
            send({ type: 'toggle', jevField: backlogJevField })
          }}
          onMouseDown={event => event.preventDefault()}
          className={showJevLabel ? 'dshx:h-7 dshx:px-2 dshx:text-xs' : undefined}
          size={showJevLabel ? 'sm' : 'icon-sm'}
          title={backlogJevField ? props.t('jevSetupButton') : props.t('bindSecret')}
          type="button"
          variant="ghost"
        >
          {referenceUnresolved ? <TriangleAlertIcon className="dshx:text-warning" /> : <KeyRoundIcon />}
          {showJevLabel ? props.t('jevSetupButton') : null}
        </Button>
      </span>
      {open ? (
        <div
          ref={panelRef}
          aria-label={jevSetupOpen ? props.t('jevSetupTitle') : props.t(creating ? 'setupCreateAndBind' : 'bindSecret')}
          className="dshx-root dshx:pointer-events-auto dshx:flex dshx:w-80 dshx:max-w-[calc(100vw-1rem)] dshx:flex-col dshx:gap-2 dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:border-border dshx:bg-popover dshx:p-2 dshx:text-popover-foreground dshx:shadow-md"
          data-side={placement.side}
          data-testid="secret-input-panel"
          role="group"
          style={{ position: 'fixed', left: placement.left, top: placement.top, maxHeight: placement.maxHeight, zIndex: 61 }}
        >
          {jevSetupOpen ? (
            <JevSecretSetup
              existing={jevRows.length === 1}
              onCancel={() => send({ type: 'jev.cancel' })}
              onPendingChange={pending => send({ type: 'jev.pending', pending })}
              onSave={saveJevKey}
              onSaved={() => send({ type: 'jev.saved' })}
              t={props.t}
              unavailable={jevUnavailable}
            />
          ) : creating ? (
            <SecretSetupForm
              onBind={async reference => {
                if (!anchor.element.isConnected) throw new Error('The reference field is no longer available.')
                SecretInputBinding.writeValue(anchor.element, reference)
              }}
              onBound={() => {
                send({ type: 'bound' })
                anchor.element.focus()
              }}
              onCancel={() => {
                send({ type: 'cancel.create' })
                anchor.element.focus()
              }}
              onStepChange={step => send({ type: 'step', step })}
              step={createStep}
              t={props.t}
              target={targetOf(anchor.element)}
            />
          ) : (
            <>
              {fieldReference !== null ? <SecretReferenceRepair className="dshx:max-w-none dshx:p-2" cwd={cwd} reference={fieldReference} t={props.t} /> : null}
              <p className="dshx:px-1 dshx:text-xs dshx:font-medium">{props.t('bindSecret')}</p>
              {backlogJevField && (
                <Button className="dshx:w-full dshx:justify-start" onClick={() => send({ type: 'open.jev' })} size="sm" type="button" variant="outline">
                  <PlusIcon />
                  {props.t('jevSetupButton')}
                </Button>
              )}
              <div className="dshx:relative">
                <SearchIcon className="dshx:pointer-events-none dshx:absolute dshx:left-2 dshx:top-1/2 dshx:size-3.5 dshx:-translate-y-1/2 dshx:text-muted-foreground" />
                <Input
                  aria-label={props.t('searchSecrets')}
                  className="dshx:h-8 dshx:w-full dshx:pl-7"
                  onChange={event => setQuery(event.currentTarget.value)}
                  placeholder={props.t('searchAliases')}
                  value={query}
                />
              </div>
              {listQuery.isPending ? (
                <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-1 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">
                  <Spinner /> {props.t('loadingMetadata')}
                </div>
              ) : null}
              {listQuery.isError ? <p className="dshx:px-1 dshx:text-xs dshx:text-destructive">{props.t('loadFailed')}</p> : null}
              {!listQuery.isPending && listQuery.isError !== true ? (
                <ul aria-label={props.t('secretAliases')} className="dshx:flex dshx:flex-col dshx:gap-0.5">
                  {rows.map(row => (
                    <li key={row.id}>
                      <button
                        className="dshx:flex dshx:w-full dshx:flex-col dshx:items-start dshx:gap-0.5 dshx:rounded-sm dshx:px-2 dshx:py-1.5 dshx:text-left dshx:hover:bg-accent"
                        onClick={() => choose(row)}
                        type="button"
                      >
                        <span className="dshx:font-mono! dshx:text-xs">{rowText(row)}</span>
                        <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
                          {row.scope}
                          {row.item === '' ? '' : ` · ${row.item}`}
                        </span>
                      </button>
                    </li>
                  ))}
                  {rows.length === 0 ? (
                    <li className="dshx:px-1 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">
                      {backlogJevField ? props.t('jevSetupNoGlobalAlias') : props.t('noBindableAliases')}
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <Button onClick={() => send({ type: 'open.create' })} size="sm" type="button" variant="outline">
                {props.t('setupAddAndBind')}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </>,
    layer,
  )
}

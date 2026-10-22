import { useApi } from '@dshfiles/dshx/client'
import { secretScopeSchema } from '@dshfiles/credential-port'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { KeyRoundIcon, PlusIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { secretCatalogApi } from './api.js'
import { JevSecretSetup } from './jev-secret-setup.js'
import type { SecretCatalogTranslate } from './locales.js'
import type { SecretMetadata } from './secret-metadata.js'
import { SecretInputBinding } from './secret-input-bind.js'
import { JEV_SECRET_ALIAS, JEV_SECRET_ENVIRONMENT, saveGlobalJevSecret } from './jev-secret-store.js'
import { placeSecretButton, placeSecretPanel } from './secret-input-placement.js'
import { SecretSetupForm } from './secret-setup-form.js'
import type { SecretSetupTarget } from './secret-setup-form.js'
import { SecretSetupModel } from './secret-setup-model.js'

interface FieldAnchor {
  readonly element: HTMLInputElement | HTMLTextAreaElement
  readonly rect: DOMRect
}

interface SecretInputOverlayProps {
  readonly t: SecretCatalogTranslate
}

const panelWidth = 320

const measure = (element: HTMLInputElement | HTMLTextAreaElement): FieldAnchor | null => {
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
  const parsedScope = secretScopeSchema.safeParse(element.dataset.secretScope)
  const target: SecretSetupTarget = {
    cwd: cwd === undefined || cwd === '' ? null : cwd,
  }
  if (element.dataset.secretAlias !== undefined) target.suggestedAlias = element.dataset.secretAlias
  if (element.dataset.secretEnvironment !== undefined) target.environment = element.dataset.secretEnvironment
  if (parsedScope.success) target.scope = parsedScope.data
  return target
}

/**
 * Offers the Secret Catalog on any input carrying `data-secret-input="reference"`, the way a password manager offers
 * its vault on a login field. A pick writes `secret:ALIAS[@env]`; the field therefore stores a reference, and the
 * value is resolved later on the Host by whoever consumes it.
 */
export const SecretInputOverlay = (props: SecretInputOverlayProps): JSX.Element | null => {
  const api = useApi(secretCatalogApi)
  const queryClient = useQueryClient()
  const [anchor, setAnchor] = useState<FieldAnchor | null>(null)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createdReference, setCreatedReference] = useState<{ readonly element: HTMLInputElement | HTMLTextAreaElement; readonly reference: string } | null>(
    null,
  )
  const [query, setQuery] = useState('')
  const [jevSetupOpen, setJevSetupOpen] = useState(false)
  const [jevSetupPending, setJevSetupPending] = useState(false)
  const [panelSize, setPanelSize] = useState({ width: panelWidth, height: 0 })
  const panelRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLSpanElement | null>(null)

  const track = useCallback((element: Element | null) => {
    if (element === null || !SecretInputBinding.accepts(element)) return setAnchor(null)
    setCreatedReference(current => (current !== null && current.element !== element ? null : current))
    setAnchor(measure(element))
  }, [])

  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const element = event.target
      if (jevSetupPending || !(element instanceof Element) || !element.matches(SecretInputBinding.selector)) return
      setCreating(false)
      setJevSetupOpen(false)
      track(element)
    }
    const onFocusOut = (event: FocusEvent): void => {
      const next = event.relatedTarget
      const target = event.target
      const focusStaysInside = next instanceof Node && (panelRef.current?.contains(next) === true || toggleRef.current?.contains(next) === true)
      const focusedLayerElementWasRemoved =
        next === null && target instanceof Node && (panelRef.current?.contains(target) === true || toggleRef.current?.contains(target) === true)
      if (focusStaysInside || focusedLayerElementWasRemoved) return
      window.setTimeout(() => {
        if (jevSetupPending) return
        const active = document.activeElement
        const keepOpen = panelRef.current?.contains(active) === true || toggleRef.current?.contains(active) === true
        if (active !== null && (active.matches(SecretInputBinding.selector) || keepOpen)) return
        setAnchor(null)
        setOpen(false)
        setCreating(false)
        setJevSetupOpen(false)
      }, 0)
    }
    const remeasure = (): void => {
      setAnchor(current => (current === null ? null : measure(current.element)))
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
    }
  }, [jevSetupPending, track])

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

  const cwd = anchor === null ? null : targetOf(anchor.element).cwd
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
    void queryClient.invalidateQueries({ queryKey: ['secret-catalog', 'list'] })
  }

  const savedJevKey = (): void => {
    setOpen(false)
    setJevSetupOpen(false)
    setAnchor(null)
  }

  const choose = (row: SecretMetadata): void => {
    if (anchor === null) return
    SecretInputBinding.writeValue(anchor.element, SecretInputBinding.referenceText({ alias: row.alias, environment: row.environment }))
    setCreatedReference(null)
    setOpen(false)
    anchor.element.focus()
  }

  if (anchor === null) return null
  const referenceToRetry = createdReference?.element === anchor.element ? createdReference.reference : undefined
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
          aria-expanded={open}
          aria-label={backlogJevField ? props.t('jevSetupButton') : props.t('bindSecret')}
          data-testid={backlogJevField ? 'secret-input-jev-setup' : 'secret-input-bind'}
          disabled={jevSetupPending || creating}
          onClick={() => {
            if (jevSetupPending || creating) return
            if (open) {
              setOpen(false)
              setJevSetupOpen(false)
              return
            }
            setJevSetupOpen(backlogJevField)
            setCreating(false)
            setOpen(true)
          }}
          onMouseDown={event => event.preventDefault()}
          className={showJevLabel ? 'dshx:h-7 dshx:px-2 dshx:text-xs' : undefined}
          size={showJevLabel ? 'sm' : 'icon-sm'}
          title={backlogJevField ? props.t('jevSetupButton') : props.t('bindSecret')}
          type="button"
          variant="ghost"
        >
          <KeyRoundIcon />
          {showJevLabel ? props.t('jevSetupButton') : null}
        </Button>
      </span>
      {open ? (
        <div
          ref={panelRef}
          aria-label={jevSetupOpen ? props.t('jevSetupTitle') : creating ? props.t('setupCreateAndBind') : props.t('bindSecret')}
          className="dshx-root dshx:pointer-events-auto dshx:flex dshx:w-80 dshx:max-w-[calc(100vw-1rem)] dshx:flex-col dshx:gap-2 dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:border-border dshx:bg-popover dshx:p-2 dshx:text-popover-foreground dshx:shadow-md"
          data-side={placement.side}
          data-testid="secret-input-panel"
          role="group"
          style={{ position: 'fixed', left: placement.left, top: placement.top, maxHeight: placement.maxHeight, zIndex: 61 }}
        >
          {jevSetupOpen ? (
            <JevSecretSetup
              existing={jevRows.length === 1}
              onCancel={() => setJevSetupOpen(false)}
              onPendingChange={setJevSetupPending}
              onSave={saveJevKey}
              onSaved={savedJevKey}
              t={props.t}
              unavailable={jevUnavailable}
            />
          ) : creating ? (
            <>
              <p className="dshx:px-1 dshx:text-xs dshx:font-medium">{props.t('setupCreateAndBind')}</p>
              <SecretSetupForm
                {...(referenceToRetry === undefined ? {} : { createdReference: referenceToRetry })}
                onBind={async reference => {
                  if (!anchor.element.isConnected) throw new Error('The reference field is no longer available.')
                  SecretInputBinding.writeValue(anchor.element, reference)
                }}
                onBound={() => {
                  setCreatedReference(current => (current?.element === anchor.element ? null : current))
                  setCreating(false)
                  setOpen(false)
                  anchor.element.focus()
                }}
                onCancel={() => {
                  setCreating(false)
                  anchor.element.focus()
                }}
                onCreatedReference={reference => setCreatedReference({ element: anchor.element, reference })}
                t={props.t}
                target={targetOf(anchor.element)}
              />
            </>
          ) : (
            <>
              <p className="dshx:px-1 dshx:text-xs dshx:font-medium">{props.t('bindSecret')}</p>
              {backlogJevField && (
                <Button className="dshx:w-full dshx:justify-start" onClick={() => setJevSetupOpen(true)} size="sm" type="button" variant="outline">
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
              <Button onClick={() => setCreating(true)} size="sm" type="button" variant="outline">
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

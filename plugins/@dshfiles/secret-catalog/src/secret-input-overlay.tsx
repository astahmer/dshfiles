import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { KeyRoundIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { useApi } from '@dshfiles/dshx/client'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { secretCatalogApi } from './api.js'
import type { SecretMetadata } from './secret-metadata.js'
import { SecretInputBinding } from './secret-input-bind.js'
import { placeSecretButton, placeSecretPanel } from './secret-input-placement.js'

interface FieldAnchor {
  readonly element: HTMLInputElement | HTMLTextAreaElement
  readonly rect: DOMRect
}

const panelWidth = 320

const measure = (element: HTMLInputElement | HTMLTextAreaElement): FieldAnchor | null => {
  if (!element.isConnected || !SecretInputBinding.accepts(element)) return null
  const rect = element.getBoundingClientRect()
  return rect.width === 0 || rect.height === 0 ? null : { element, rect }
}

const rowText = (row: SecretMetadata): string => `${row.alias}@${row.environment}`

/**
 * Offers the Secret Catalog on any input carrying `data-secret-input="reference"`, the way a password manager offers
 * its vault on a login field. A pick writes `secret:ALIAS[@env]`; the field therefore stores a reference, and the
 * value is resolved later on the Host by whoever consumes it.
 */
export const SecretInputOverlay = (): JSX.Element | null => {
  const api = useApi(secretCatalogApi)
  const [anchor, setAnchor] = useState<FieldAnchor | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [panelSize, setPanelSize] = useState({ width: panelWidth, height: 0 })
  const panelRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLSpanElement | null>(null)

  const track = useCallback((element: Element | null) => {
    if (element === null || !SecretInputBinding.accepts(element)) return setAnchor(null)
    setAnchor(measure(element))
  }, [])

  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const element = event.target
      if (!(element instanceof Element) || !element.matches(SecretInputBinding.selector)) return
      track(element)
    }
    const onFocusOut = (event: FocusEvent): void => {
      const next = event.relatedTarget
      window.setTimeout(() => {
        const active = document.activeElement
        const keepOpen = panelRef.current?.contains(active) === true || toggleRef.current?.contains(active) === true
        if (active !== null && (active.matches(SecretInputBinding.selector) || keepOpen)) return
        setAnchor(null)
        setOpen(false)
      }, 0)
      if (next === null) return
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
  }, [track])

  // The panel flips on the room it needs, so its unclipped content height and its boxed width are the placement inputs.
  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (panel === null) return
    const remeasure = (): void => setPanelSize({ width: panel.offsetWidth, height: panel.scrollHeight })
    remeasure()
    const observer = new ResizeObserver(remeasure)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [open])

  const listQuery = useQuery({
    queryKey: ['secret-catalog', 'list', null],
    enabled: anchor !== null,
    staleTime: 30_000,
    queryFn: ({ signal }) => api.list({ cwd: null }, { signal }),
  })

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase()
    const matches = listQuery.data ?? []
    return text === '' ? matches : matches.filter(row => rowText(row).toLowerCase().includes(text) || row.item.toLowerCase().includes(text))
  }, [listQuery.data, query])

  const choose = (row: SecretMetadata): void => {
    if (anchor === null) return
    SecretInputBinding.writeValue(anchor.element, SecretInputBinding.referenceText({ alias: row.alias, environment: row.environment }))
    setOpen(false)
    anchor.element.focus()
  }

  if (anchor === null) return null
  // A modal layer makes everything outside it inert, so the affordance is portaled into the field's own dialog.
  const layer = anchor.element.closest('[role="dialog"]') ?? document.body
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const button = placeSecretButton({ anchor: anchor.rect, viewport })
  const placement = placeSecretPanel({ anchor: anchor.rect, panel: { width: panelSize.width, height: panelSize.height || 1 }, viewport })
  return createPortal(
    <>
      <span className="dshx:pointer-events-auto" ref={toggleRef} style={{ position: 'fixed', left: button.left, top: button.top, zIndex: 61 }}>
        <Button
          aria-expanded={open}
          aria-label="Bind a secret"
          data-testid="secret-input-bind"
          onClick={() => setOpen(current => !current)}
          onMouseDown={event => event.preventDefault()}
          size="icon-sm"
          title="Bind a Secret Catalog alias"
          type="button"
          variant="ghost"
        >
          <KeyRoundIcon />
        </Button>
      </span>
      {open ? (
        <div
          ref={panelRef}
          aria-label="Bind a secret"
          className="dshx-root dshx:pointer-events-auto dshx:flex dshx:w-80 dshx:max-w-[calc(100vw-1rem)] dshx:flex-col dshx:gap-2 dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:border-border dshx:bg-popover dshx:p-2 dshx:text-popover-foreground dshx:shadow-md"
          data-side={placement.side}
          role="group"
          style={{ position: 'fixed', left: placement.left, top: placement.top, maxHeight: placement.maxHeight, zIndex: 61 }}
        >
          <p className="dshx:px-1 dshx:text-xs dshx:font-medium">Bind a secret</p>
          <div className="dshx:relative">
            <SearchIcon className="dshx:pointer-events-none dshx:absolute dshx:left-2 dshx:top-1/2 dshx:size-3.5 dshx:-translate-y-1/2 dshx:text-muted-foreground" />
            <Input
              aria-label="Search secrets"
              className="dshx:h-8 dshx:w-full dshx:pl-7"
              onChange={event => setQuery(event.currentTarget.value)}
              placeholder="Search aliases"
              value={query}
            />
          </div>
          {listQuery.isPending ? (
            <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-1 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">
              <Spinner /> Loading secrets
            </div>
          ) : null}
          {listQuery.isError ? <p className="dshx:px-1 dshx:text-xs dshx:text-destructive">Secrets could not be loaded. Check the secret CLI.</p> : null}
          {!listQuery.isPending && listQuery.isError !== true ? (
            <ul aria-label="Secret aliases" className="dshx:flex dshx:flex-col dshx:gap-0.5">
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
                  No global alias matches. Add one in the Secret Catalog panel; project aliases need a folder there.
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>,
    layer,
  )
}

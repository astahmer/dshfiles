import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { SearchIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ShellTranslate } from './native/locales.js'

const HOST_ATTRIBUTE = 'data-dshfiles-plugins-filter-host'
const PANEL_SELECTOR = '[data-plugin-panel]'
const GROUP_SELECTOR = 'section[data-plugin-group]'
const CARD_SELECTOR = 'li[data-plugin-package], li[data-plugin-item]'

export interface InstalledPluginsFilterCount {
  readonly matched: number
  readonly total: number
}

const findInstalledContainer = (root: ParentNode): HTMLElement | null => {
  const panel = root.querySelector(PANEL_SELECTOR)
  if (panel === null) return null
  const firstGroup = panel.querySelector(GROUP_SELECTOR)
  return firstGroup?.parentElement ?? null
}

const cardSearchText = (card: HTMLElement): string =>
  [card.getAttribute('data-plugin-package') ?? '', card.getAttribute('data-plugin-item') ?? '', card.textContent ?? ''].join(' ').toLowerCase()

/**
 * Filters installed plugin cards (`li[data-plugin-package]`, `li[data-plugin-item]`) inside DSH's native Plugins tab
 * by setting standard `hidden` attributes on non-matching cards and emptied groups without mutating React's children.
 */
export const applyInstalledPluginsFilter = (container: HTMLElement, query: string): InstalledPluginsFilterCount => {
  const tokens = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  const filtering = tokens.length > 0
  let matched = 0
  let total = 0

  for (const group of container.querySelectorAll<HTMLElement>(GROUP_SELECTOR)) {
    const cards = group.querySelectorAll<HTMLElement>(CARD_SELECTOR)
    let groupMatched = 0
    for (const card of cards) {
      total += 1
      const visible = !filtering || tokens.every(token => cardSearchText(card).includes(token))
      if (card.hidden !== !visible) card.hidden = !visible
      if (visible) {
        groupMatched += 1
        matched += 1
      }
    }
    const hideGroup = filtering && cards.length > 0 && groupMatched === 0
    if (group.hidden !== hideGroup) group.hidden = hideGroup
  }

  return { matched, total }
}

const restoreAll = (container: HTMLElement): void => {
  for (const group of container.querySelectorAll<HTMLElement>(GROUP_SELECTOR)) {
    if (group.hidden) group.hidden = false
    for (const card of group.querySelectorAll<HTMLElement>(CARD_SELECTOR)) {
      if (card.hidden) card.hidden = false
    }
  }
}

const isOwnHostMutation = (records: readonly MutationRecord[]): boolean =>
  records.length > 0 &&
  records.every(record => {
    const nodes = [...record.addedNodes, ...record.removedNodes]
    return nodes.length > 0 && nodes.every(node => node instanceof Element && node.hasAttribute(HOST_ATTRIBUTE))
  })

const stopTypingPropagation = (event: KeyboardEvent): void => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  event.stopPropagation()
}

export interface InstalledPluginsFilterProps {
  readonly t: ShellTranslate
  readonly root?: ParentNode | undefined
}

/**
 * Mounts a quick text filter at the top of DSH core's native Plugins tab (`Installed` and `More` lists) via a portal,
 * letting users narrow installed plugins by name, package id, status or description without patching DSH core.
 */
export const InstalledPluginsFilter = (props: InstalledPluginsFilterProps): ReactNode => {
  const { t } = props
  const [query, setQuery] = useState('')
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [listRevision, setListRevision] = useState(0)
  const [count, setCount] = useState<InstalledPluginsFilterCount>({ matched: 0, total: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const rootNode = props.root ?? document.body
    let frameId: number | null = null

    const sync = (): void => {
      const nextContainer = findInstalledContainer(rootNode)
      if (nextContainer === null) {
        if (containerRef.current !== null) {
          restoreAll(containerRef.current)
          containerRef.current = null
        }
        if (hostRef.current !== null) {
          hostRef.current.remove()
          hostRef.current = null
          setHost(null)
        }
        setContainer(current => (current === null ? current : null))
        return
      }

      if (containerRef.current !== nextContainer) {
        if (containerRef.current !== null) restoreAll(containerRef.current)
        containerRef.current = nextContainer
        setContainer(nextContainer)
      }

      const existingHost = nextContainer.querySelector<HTMLDivElement>(`:scope > [${HOST_ATTRIBUTE}]`)
      if (existingHost !== null) {
        if (hostRef.current !== existingHost) {
          hostRef.current = existingHost
          setHost(existingHost)
        }
      } else {
        const nextHost = document.createElement('div')
        nextHost.setAttribute(HOST_ATTRIBUTE, '')
        nextContainer.prepend(nextHost)
        hostRef.current = nextHost
        setHost(nextHost)
      }

      setListRevision(revision => revision + 1)
    }

    const scheduleSync = (): void => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        sync()
      })
    }

    sync()

    const observer = new MutationObserver(records => {
      if (isOwnHostMutation(records)) return
      scheduleSync()
    })
    observer.observe(rootNode, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      if (containerRef.current !== null) {
        restoreAll(containerRef.current)
        containerRef.current = null
      }
      if (hostRef.current !== null) {
        hostRef.current.remove()
        hostRef.current = null
      }
    }
  }, [props.root])

  useEffect(() => {
    if (container === null) return
    const next = applyInstalledPluginsFilter(container, query)
    setCount(current => (current.matched === next.matched && current.total === next.total ? current : next))
  }, [container, query, listRevision])

  if (host === null) return null

  const filtering = query.trim() !== ''
  const empty = filtering && count.total > 0 && count.matched === 0

  return createPortal(
    <div className="dshx-root dshx:-mb-3 dshx:flex dshx:flex-col dshx:gap-2.5" data-installed-plugins-filter="">
      <div className="dshx:flex dshx:items-center dshx:gap-2.5">
        <InputGroup className="dshx:h-9 dshx:min-w-0 dshx:flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('installedFilter.label')}
            autoComplete="off"
            onChange={event => setQuery(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault()
                event.stopPropagation()
                event.nativeEvent.stopImmediatePropagation()
                setQuery('')
                return
              }
              stopTypingPropagation(event)
            }}
            placeholder={t('installedFilter.placeholder')}
            ref={inputRef}
            role="searchbox"
            spellCheck={false}
            type="text"
            value={query}
          />
          {query !== '' && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={t('installedFilter.clear')}
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                size="icon-xs"
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {filtering && count.total > 0 && (
          <span
            aria-live="polite"
            className="dshx:shrink-0 dshx:text-xs dshx:font-medium dshx:text-muted-foreground dshx:tabular-nums"
            data-installed-plugins-count=""
            role="status"
          >
            {t('installedFilter.matches', { matched: count.matched, total: count.total })}
          </span>
        )}
      </div>
      {empty && (
        <div
          className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2.5 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:px-4 dshx:py-6 dshx:text-center"
          data-installed-plugins-empty=""
          role="status"
        >
          <p className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">{t('installedFilter.empty', { query: query.trim() })}</p>
          <Button
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            size="sm"
            variant="outline"
          >
            {t('installedFilter.reset')}
          </Button>
        </div>
      )}
    </div>,
    host,
  )
}

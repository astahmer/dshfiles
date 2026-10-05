import type { SidebarPanelMetadata, SidebarRootComponentProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconEllipsisOutlineRegular,
  IconNewChatOutlineRegular,
  IconSearchOutlineRegular,
  IconSettingsOutlineRegular,
  Input,
  Switch,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  orderSidebarEntries,
  reorderSidebarEntry,
  SIDEBAR_HEADER_MIN_HEIGHT,
  SIDEBAR_SPLITTER_HEIGHT,
  SIDEBAR_THREAD_MIN_HEIGHT,
  type OrderedSidebarEntry,
} from './organization.js'
import { SidebarStateProvider, useSidebarState } from './sidebar-state.js'
import styles from './sidebar-shell.module.css'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'

interface FooterRegistration {
  id: string
  order: number
  label: string
}

export interface FooterSnapshot {
  settingsId: string | null
  actions: FooterRegistration[]
}

interface SidebarShellExtras {
  readFooterSnapshot: () => FooterSnapshot
  subscribeFooterSnapshot: (listener: () => void) => () => void
}

type SidebarShellTranslate = TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
export type SidebarShellBaseProps = Omit<SidebarRootComponentProps, 't'> & {
  t: SidebarShellTranslate
}
type SidebarShellProps = SidebarShellBaseProps & SidebarShellExtras

interface HeaderEntry extends OrderedSidebarEntry {
  label: string
  kind: 'new-thread' | 'search' | 'panel'
  panelId?: SidebarPanelMetadata['id']
}

interface FooterEntry extends OrderedSidebarEntry {
  key: string
  label: string
  kind: 'settings' | 'action'
  registrationId: string | null
}

interface SidebarSplitBounds {
  value: number
  minimum: number
  maximum: number
}

const text = (translate: SidebarShellTranslate, key: Parameters<SidebarShellTranslate>[0]): string => translate(key)

const toggleHidden = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])

const readSidebarSplitBounds = (elements: {
  shell: HTMLDivElement | null
  headerRegion: HTMLDivElement | null
  threadRegion: HTMLDivElement | null
  footer: HTMLElement | null
  splitter: HTMLButtonElement | null
}): SidebarSplitBounds | null => {
  const { shell, headerRegion, threadRegion, footer, splitter } = elements
  if (shell === null || headerRegion === null || threadRegion === null) return null

  const footerHeight = footer?.getBoundingClientRect().height ?? 0
  const splitterHeight = splitter?.getBoundingClientRect().height ?? SIDEBAR_SPLITTER_HEIGHT
  const availableMaximum = shell.clientHeight - footerHeight - splitterHeight - SIDEBAR_THREAD_MIN_HEIGHT
  const maximum = Math.max(SIDEBAR_HEADER_MIN_HEIGHT, Math.floor(availableMaximum))
  const value = headerRegion.getBoundingClientRect().height
  return {
    value: Math.round(Math.min(maximum, Math.max(SIDEBAR_HEADER_MIN_HEIGHT, value))),
    minimum: SIDEBAR_HEADER_MIN_HEIGHT,
    maximum,
  }
}

const SidebarRootContent = (props: SidebarShellProps): JSX.Element => {
  const panels = props.usePanels(items => items)
  const activePanelId = props.usePanelInfo(info => info.activePanelId)
  const { preferences, updatePreferences, threadQuery, setThreadQuery } = useSidebarState()
  const [previewHeaderHeight, setPreviewHeaderHeight] = useState<number | null>(null)
  const [splitBounds, setSplitBounds] = useState<SidebarSplitBounds>({
    value: SIDEBAR_HEADER_MIN_HEIGHT,
    minimum: SIDEBAR_HEADER_MIN_HEIGHT,
    maximum: SIDEBAR_HEADER_MIN_HEIGHT,
  })
  const [footerSnapshot, setFooterSnapshot] = useState(props.readFooterSnapshot)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const headerRegionRef = useRef<HTMLDivElement>(null)
  const threadRegionRef = useRef<HTMLDivElement>(null)
  const footerRegionRef = useRef<HTMLElement>(null)
  const splitterRef = useRef<HTMLButtonElement>(null)
  const resizeDragRef = useRef<{
    pointerId: number
    startY: number
    startHeight: number
    currentHeight: number
    minimum: number
    maximum: number
  } | null>(null)
  const headerRegionId = `thread-sidebar-header-${useId()}`
  const threadRegionId = `thread-sidebar-threads-${useId()}`
  const wide = !props.collapsed
  const effectiveHeaderHeight = previewHeaderHeight ?? preferences.headerRegionHeight

  useEffect(() => {
    const measure = (): void => {
      const bounds = readSidebarSplitBounds({
        shell: shellRef.current,
        headerRegion: headerRegionRef.current,
        threadRegion: threadRegionRef.current,
        footer: footerRegionRef.current,
        splitter: splitterRef.current,
      })
      if (bounds === null) return
      setSplitBounds(current =>
        current.value === bounds.value && current.minimum === bounds.minimum && current.maximum === bounds.maximum ? current : bounds,
      )
    }
    measure()
    window.addEventListener('resize', measure)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', measure)

    const observer = new ResizeObserver(measure)
    if (shellRef.current !== null) observer.observe(shellRef.current)
    if (headerRegionRef.current !== null) observer.observe(headerRegionRef.current)
    if (threadRegionRef.current !== null) observer.observe(threadRegionRef.current)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [wide])

  useEffect(() => {
    if (previewHeaderHeight !== null) return
    const bounds = readSidebarSplitBounds({
      shell: shellRef.current,
      headerRegion: headerRegionRef.current,
      threadRegion: threadRegionRef.current,
      footer: footerRegionRef.current,
      splitter: splitterRef.current,
    })
    if (bounds !== null) setSplitBounds(bounds)
  }, [preferences.headerRegionHeight, previewHeaderHeight, wide])

  const resizeHeaderRegion = (height: number): void => {
    const bounds = readSidebarSplitBounds({
      shell: shellRef.current,
      headerRegion: headerRegionRef.current,
      threadRegion: threadRegionRef.current,
      footer: footerRegionRef.current,
      splitter: splitterRef.current,
    })
    if (bounds === null) return
    const nextHeight = Math.round(Math.min(bounds.maximum, Math.max(bounds.minimum, height)))
    setSplitBounds({ ...bounds, value: nextHeight })
    setPreviewHeaderHeight(null)
    updatePreferences({ headerRegionHeight: nextHeight })
  }

  const pointerHeightAt = (clientY: number): number | null => {
    const drag = resizeDragRef.current
    if (drag === null) return null
    return Math.min(drag.maximum, Math.max(drag.minimum, drag.startHeight + clientY - drag.startY))
  }

  const moveSplitter = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = resizeDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const height = pointerHeightAt(event.clientY)
    if (height === null) return
    drag.currentHeight = height
    setPreviewHeaderHeight(height)
  }

  const startSplitterDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const bounds = readSidebarSplitBounds({
      shell: shellRef.current,
      headerRegion: headerRegionRef.current,
      threadRegion: threadRegionRef.current,
      footer: footerRegionRef.current,
      splitter: splitterRef.current,
    })
    if (bounds === null) return
    event.preventDefault()
    resizeDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: bounds.value,
      currentHeight: bounds.value,
      minimum: bounds.minimum,
      maximum: bounds.maximum,
    }
    setPreviewHeaderHeight(bounds.value)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const finishSplitterDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = resizeDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const height = pointerHeightAt(event.clientY) ?? drag.currentHeight
    drag.currentHeight = height
    resizeDragRef.current = null
    resizeHeaderRegion(height)
  }

  const cancelSplitterDrag = (): void => {
    if (resizeDragRef.current === null) return
    resizeDragRef.current = null
    setPreviewHeaderHeight(null)
  }

  const resizeSplitterFromKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === '0') {
      event.preventDefault()
      setPreviewHeaderHeight(null)
      updatePreferences({ headerRegionHeight: null })
      return
    }
    let nextHeight: number | null = null
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextHeight = splitBounds.value - 24
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextHeight = splitBounds.value + 24
    if (event.key === 'Home') nextHeight = splitBounds.minimum
    if (event.key === 'End') nextHeight = splitBounds.maximum
    if (nextHeight === null) return
    event.preventDefault()
    resizeHeaderRegion(nextHeight)
  }

  useEffect(() => {
    const sync = (): void => setFooterSnapshot(props.readFooterSnapshot())
    const unsubscribe = props.subscribeFooterSnapshot(sync)
    sync()
    return unsubscribe
  }, [props.readFooterSnapshot, props.subscribeFooterSnapshot])

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus()
  }, [searchOpen])

  const headerEntries = useMemo<HeaderEntry[]>(
    () => [
      { id: 'new-thread', label: text(props.t, 'threadSidebarNewThread'), kind: 'new-thread', order: -2 },
      { id: 'search', label: text(props.t, 'threadSidebarSearch'), kind: 'search', order: -1 },
      ...panels.map(panel => ({
        id: 'panel:' + panel.id,
        label: panel.label,
        kind: 'panel' as const,
        panelId: panel.id,
        order: panel.order,
      })),
    ],
    [panels, props.t],
  )

  const orderedHeaderEntries = useMemo(() => orderSidebarEntries(headerEntries, preferences.headerOrder), [headerEntries, preferences.headerOrder])
  const visibleHeaderEntries = orderedHeaderEntries.filter(entry => !preferences.hiddenHeaderIds.includes(entry.id))

  const footerEntries = useMemo<FooterEntry[]>(
    () => [
      ...(footerSnapshot.settingsId === null
        ? []
        : [
            {
              key: 'settings',
              id: 'settings',
              label: text(props.t, 'threadSidebarHostSettings'),
              kind: 'settings' as const,
              registrationId: null,
              order: -1,
            },
          ]),
      ...footerSnapshot.actions.map(action => ({
        key: 'footer:' + action.id,
        id: 'footer:' + action.id,
        label: action.label,
        kind: 'action' as const,
        registrationId: action.id,
        order: action.order,
      })),
    ],
    [footerSnapshot, props.t],
  )

  const orderedFooterEntries = useMemo(() => orderSidebarEntries(footerEntries, preferences.footerOrder), [footerEntries, preferences.footerOrder])
  const visibleFooterEntries = orderedFooterEntries.filter(entry => !preferences.hiddenFooterIds.includes(entry.id))
  const hiddenFooterEntries = orderedFooterEntries.filter(entry => preferences.hiddenFooterIds.includes(entry.id))

  const renderFooterEntry = (entry: FooterEntry, renderWide: boolean): ReactNode => {
    if (entry.kind === 'settings') {
      return props.renderSlot('sidebar.settings', { wide: renderWide })
    }
    if (entry.registrationId === null) return null
    return props.renderSlot('sidebar.footer.action', { wide: renderWide }, { only: entry.registrationId })
  }

  const activateHeaderEntry = (entry: HeaderEntry): void => {
    if (entry.kind === 'new-thread') {
      props.startSession()
      return
    }
    if (entry.kind === 'search') {
      if (props.collapsed) props.toggleSidebar()
      setSearchOpen(true)
      return
    }
    if (entry.panelId !== undefined) props.selectPanel(entry.panelId)
  }

  /**
   * One customizable row, shaped like the reference: a drag handle, the entry's
   * own icon, its label, and a switch. Arrow buttons and a bare checkbox cannot
   * express the same affordance, so reordering is by pointer drag and visibility
   * is by the switch.
   */
  const renderCustomizeRow = (
    entry: { id: string; label: string },
    index: number,
    icon: ReactNode,
    hidden: boolean,
    onReorder: (from: number, to: number) => void,
    onToggle: () => void,
    className: string,
  ): JSX.Element => (
    <div
      className={className}
      key={entry.id}
      draggable
      onDragStart={event => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', String(index))
      }}
      onDragOver={event => event.preventDefault()}
      onDrop={event => {
        event.preventDefault()
        const from = Number(event.dataTransfer.getData('text/plain'))
        if (Number.isInteger(from)) onReorder(from, index)
      }}
    >
      <span className={styles.dragHandle} aria-hidden="true">
        ⠿
      </span>
      <span className={styles.customizeIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.customizeLabel}>{entry.label}</span>
      <Switch checked={!hidden} label={`${text(props.t, 'threadSidebarVisibility')}: ${entry.label}`} onChange={onToggle} />
    </div>
  )

  const headerIconFor = (entry: HeaderEntry, size: number): ReactNode => {
    if (entry.kind === 'new-thread')
      return (
        <span aria-hidden="true">
          <IconNewChatOutlineRegular size={size} />
        </span>
      )
    if (entry.kind === 'search')
      return (
        <span aria-hidden="true">
          <IconSearchOutlineRegular size={size} />
        </span>
      )
    if (entry.panelId === undefined) return null
    return props.renderSlot('sidebar.panellist', { size, active: activePanelId === entry.panelId }, { only: entry.panelId })
  }

  const renderHeaderCustomizeRows = (): JSX.Element[] =>
    orderedHeaderEntries.map((entry, index) =>
      renderCustomizeRow(
        entry,
        index,
        headerIconFor(entry, 18),
        preferences.hiddenHeaderIds.includes(entry.id),
        (from, to) =>
          updatePreferences({
            headerOrder: reorderSidebarEntry(
              orderSidebarEntries(headerEntries, preferences.headerOrder).map(item => item.id),
              from,
              to,
            ),
          }),
        () => updatePreferences({ hiddenHeaderIds: toggleHidden(preferences.hiddenHeaderIds, entry.id) }),
        `${styles.customizeRow} ${styles.headerRows}`,
      ),
    )

  const renderFooterCustomizeRows = (): JSX.Element[] =>
    orderedFooterEntries.map((entry, index) =>
      renderCustomizeRow(
        entry,
        index,
        entry.kind === 'settings' ? (
          <IconSettingsOutlineRegular size={18} />
        ) : (
          props.renderSlot('sidebar.footer.action', { wide: false }, { only: entry.registrationId ?? undefined })
        ),
        preferences.hiddenFooterIds.includes(entry.id),
        (from, to) =>
          updatePreferences({
            footerOrder: reorderSidebarEntry(
              orderSidebarEntries(footerEntries, preferences.footerOrder).map(item => item.id),
              from,
              to,
            ),
          }),
        () => updatePreferences({ hiddenFooterIds: toggleHidden(preferences.hiddenFooterIds, entry.id) }),
        `${styles.customizeRow} ${styles.footerRows}`,
      ),
    )

  const compactHeader = props.collapsed || preferences.headerMode === 'compact'

  return (
    <div ref={shellRef} className={props.collapsed ? styles.shell + ' ' + styles.rail : styles.shell} style={{ width: props.width }}>
      <div
        ref={headerRegionRef}
        className={styles.headerRegion}
        id={headerRegionId}
        style={wide && effectiveHeaderHeight !== null ? { height: `${effectiveHeaderHeight}px` } : undefined}
      >
        <div className={styles.brandRow}>
        <button
          className={styles.brandButton}
          type="button"
          aria-label={text(props.t, props.collapsed ? 'threadSidebarExpand' : 'threadSidebarCollapse')}
          onClick={props.toggleSidebar}
        >
          {props.renderSlot('sidebar.brand.mark', { size: 24 }) ?? <span aria-hidden="true">◈</span>}
        </button>
        {wide ? <span className={styles.brandName}>{props.renderSlot('sidebar.brand.name', {}) ?? 'DSH'}</span> : null}
        {props.collapsed ? props.renderSlot('sidebar.toggle.badge', {}) : null}
      </div>

      <nav className={compactHeader ? styles.headerCompact : styles.headerExpanded} aria-label={text(props.t, 'threadSidebarHeaderNavigation')}>
        {visibleHeaderEntries.map(entry => {
          const active = entry.kind === 'panel' && activePanelId === entry.panelId
          return (
            <Tooltip key={entry.id} label={entry.label} side={props.collapsed ? 'right' : 'bottom'} delayMs={500} disabled={!compactHeader} portal>
              <button
                type="button"
                className={active ? styles.selectedLink : styles.headerLink}
                aria-label={entry.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => activateHeaderEntry(entry)}
              >
                {headerIconFor(entry, 22)}
                {!compactHeader ? <span>{entry.label}</span> : null}
              </button>
            </Tooltip>
          )
        })}
      </nav>

      {wide ? (
        <div className={styles.headerTools}>
          {searchOpen ? (
            <Input
              ref={searchInput}
              className={styles.searchInput}
              icon={<IconSearchOutlineRegular size={16} />}
              type="search"
              aria-label={text(props.t, 'threadSidebarSearch')}
              placeholder={text(props.t, 'threadSidebarSearchPlaceholder')}
              value={threadQuery}
              onChange={event => setThreadQuery(event.currentTarget.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  setThreadQuery('')
                  setSearchOpen(false)
                }
              }}
            />
          ) : null}
          <Button variant="outline" size="sm" aria-expanded={customizeOpen} onClick={() => setCustomizeOpen(value => !value)}>
            {text(props.t, 'threadSidebarCustomize')}
          </Button>
        </div>
      ) : null}

      </div>

      {customizeOpen && wide ? (
        <section className={styles.customizePanel} aria-label={text(props.t, 'threadSidebarCustomize')}>
          <div className={styles.customizeTitle}>
            <h2>{text(props.t, 'threadSidebarCustomize')}</h2>
            <Button variant="ghost" size="sm" onClick={() => setCustomizeOpen(false)}>
              {text(props.t, 'threadSidebarDone')}
            </Button>
          </div>
          <fieldset className={styles.modeField}>
            <legend>{text(props.t, 'threadSidebarHeaderStyle')}</legend>
            <label>
              <input
                type="radio"
                name="thread-sidebar-header-mode"
                value="compact"
                checked={preferences.headerMode === 'compact'}
                onChange={() => updatePreferences({ headerMode: 'compact' })}
              />
              {text(props.t, 'threadSidebarCompact')}
            </label>
            <label>
              <input
                type="radio"
                name="thread-sidebar-header-mode"
                value="expanded"
                checked={preferences.headerMode === 'expanded'}
                onChange={() => updatePreferences({ headerMode: 'expanded' })}
              />
              {text(props.t, 'threadSidebarExpanded')}
            </label>
          </fieldset>
          <section className={styles.customizeSection}>
            <h3>{text(props.t, 'threadSidebarHeaderLinks')}</h3>
            {renderHeaderCustomizeRows()}
          </section>
          <section className={styles.customizeSection}>
            <h3>{text(props.t, 'threadSidebarFooterLinks')}</h3>
            <p>{text(props.t, 'threadSidebarFooterHint')}</p>
            {renderFooterCustomizeRows()}
          </section>
        </section>
      ) : null}

      {wide ? (
        <button
          ref={splitterRef}
          type="button"
          className={styles.splitter}
          role="separator"
          aria-label={text(props.t, 'threadSidebarResize')}
          aria-orientation="horizontal"
          aria-controls={`${headerRegionId} ${threadRegionId}`}
          aria-valuemin={splitBounds.minimum}
          aria-valuemax={splitBounds.maximum}
          aria-valuenow={previewHeaderHeight === null ? splitBounds.value : Math.round(previewHeaderHeight)}
          title={text(props.t, 'threadSidebarResizeHint')}
          onPointerDown={startSplitterDrag}
          onPointerMove={moveSplitter}
          onPointerUp={finishSplitterDrag}
          onPointerCancel={cancelSplitterDrag}
          onLostPointerCapture={cancelSplitterDrag}
          onKeyDown={resizeSplitterFromKeyboard}
          onDoubleClick={() => updatePreferences({ headerRegionHeight: null })}
        />
      ) : null}

      <div ref={threadRegionRef} className={styles.regionArea} id={threadRegionId}>
        {wide
          ? props.renderSlot('sidebar.workspaces', {
              wide,
              expandSidebar: () => {
                if (props.collapsed) props.toggleSidebar()
              },
            })
          : null}
      </div>

      <footer ref={footerRegionRef} className={styles.footer}>
        {visibleFooterEntries.map(entry => (
          <Tooltip key={entry.id} label={entry.label} side={props.collapsed ? 'right' : 'top'} delayMs={500} portal>
            <div className={styles.footerItem}>{renderFooterEntry(entry, wide)}</div>
          </Tooltip>
        ))}
        {hiddenFooterEntries.length > 0 ? (
          <div className={styles.moreContainer}>
            <button
              type="button"
              className={styles.moreButton}
              aria-label={text(props.t, 'threadSidebarMore')}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(value => !value)}
            >
              <IconEllipsisOutlineRegular size={18} />
              {wide ? <span>{text(props.t, 'threadSidebarMore')}</span> : null}
            </button>
            {moreOpen ? (
              <div className={styles.moreMenu} role="menu" aria-label={text(props.t, 'threadSidebarMore')}>
                {hiddenFooterEntries.map(entry => (
                  <div className={styles.moreItem} role="none" key={entry.id}>
                    {renderFooterEntry(entry, true)}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </footer>
    </div>
  )
}

export const SidebarRoot = (props: SidebarShellProps): JSX.Element => (
  <SidebarStateProvider>
    <SidebarRootContent {...props} />
  </SidebarStateProvider>
)

import type { SidebarPanelMetadata, SidebarRootComponentProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { moveSidebarEntry, orderSidebarEntries, type OrderedSidebarEntry } from './organization.js'
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

const text = (translate: SidebarShellTranslate, key: Parameters<SidebarShellTranslate>[0]): string => translate(key)

const updateOrder = (entries: readonly OrderedSidebarEntry[], savedOrder: readonly string[], id: string, direction: -1 | 1): string[] =>
  moveSidebarEntry(
    orderSidebarEntries(entries, savedOrder).map(entry => entry.id),
    id,
    direction,
  )

const toggleHidden = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])

const SidebarRootContent = (props: SidebarShellProps): JSX.Element => {
  const panels = props.usePanels(items => items)
  const activePanelId = props.usePanelInfo(info => info.activePanelId)
  const { preferences, updatePreferences, threadQuery, setThreadQuery } = useSidebarState()
  const [footerSnapshot, setFooterSnapshot] = useState(props.readFooterSnapshot)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const wide = !props.collapsed

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

  const updateHeaderOrder = (id: string, direction: -1 | 1): void => {
    updatePreferences({ headerOrder: updateOrder(headerEntries, preferences.headerOrder, id, direction) })
  }
  const updateFooterOrder = (id: string, direction: -1 | 1): void => {
    updatePreferences({ footerOrder: updateOrder(footerEntries, preferences.footerOrder, id, direction) })
  }
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

  const renderHeaderCustomizeRows = (): JSX.Element[] =>
    orderedHeaderEntries.map((entry, index) => (
      <div className={styles.customizeRow} key={entry.id}>
        <span className={styles.customizeLabel}>{entry.label}</span>
        <button type="button" aria-label={text(props.t, 'threadSidebarMoveUp')} disabled={index === 0} onClick={() => updateHeaderOrder(entry.id, -1)}>
          ↑
        </button>
        <button
          type="button"
          aria-label={text(props.t, 'threadSidebarMoveDown')}
          disabled={index === orderedHeaderEntries.length - 1}
          onClick={() => updateHeaderOrder(entry.id, 1)}
        >
          ↓
        </button>
        <input
          type="checkbox"
          aria-label={text(props.t, 'threadSidebarVisibility') + ': ' + entry.label}
          checked={!preferences.hiddenHeaderIds.includes(entry.id)}
          onChange={() => updatePreferences({ hiddenHeaderIds: toggleHidden(preferences.hiddenHeaderIds, entry.id) })}
        />
      </div>
    ))

  const renderFooterCustomizeRows = (): JSX.Element[] =>
    orderedFooterEntries.map((entry, index) => (
      <div className={styles.customizeRow} key={entry.id}>
        <span className={styles.customizeLabel}>{entry.label}</span>
        <button type="button" aria-label={text(props.t, 'threadSidebarMoveUp')} disabled={index === 0} onClick={() => updateFooterOrder(entry.id, -1)}>
          ↑
        </button>
        <button
          type="button"
          aria-label={text(props.t, 'threadSidebarMoveDown')}
          disabled={index === orderedFooterEntries.length - 1}
          onClick={() => updateFooterOrder(entry.id, 1)}
        >
          ↓
        </button>
        <input
          type="checkbox"
          aria-label={text(props.t, 'threadSidebarVisibility') + ': ' + entry.label}
          checked={!preferences.hiddenFooterIds.includes(entry.id)}
          onChange={() => updatePreferences({ hiddenFooterIds: toggleHidden(preferences.hiddenFooterIds, entry.id) })}
        />
      </div>
    ))

  const compactHeader = props.collapsed || preferences.headerMode === 'compact'

  return (
    <div className={props.collapsed ? styles.shell + ' ' + styles.rail : styles.shell} style={{ width: props.width }}>
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
          const icon =
            entry.kind === 'new-thread' ? (
              <span aria-hidden="true">＋</span>
            ) : entry.kind === 'search' ? (
              <span aria-hidden="true">⌕</span>
            ) : entry.panelId === undefined ? null : (
              props.renderSlot('sidebar.panellist', { size: 22, active }, { only: entry.panelId })
            )
          return (
            <button
              key={entry.id}
              type="button"
              className={active ? styles.selectedLink : styles.headerLink}
              aria-label={entry.label}
              title={entry.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => activateHeaderEntry(entry)}
            >
              {icon}
              {!compactHeader ? <span>{entry.label}</span> : null}
            </button>
          )
        })}
      </nav>

      {wide ? (
        <div className={styles.headerTools}>
          {searchOpen ? (
            <input
              ref={searchInput}
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
          <button type="button" onClick={() => setCustomizeOpen(value => !value)}>
            {text(props.t, 'threadSidebarCustomize')}
          </button>
        </div>
      ) : null}

      {customizeOpen && wide ? (
        <section className={styles.customizePanel} aria-label={text(props.t, 'threadSidebarCustomize')}>
          <div className={styles.customizeTitle}>
            <h2>{text(props.t, 'threadSidebarCustomize')}</h2>
            <button type="button" onClick={() => setCustomizeOpen(false)}>
              {text(props.t, 'threadSidebarDone')}
            </button>
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

      <div className={styles.regionArea}>
        {wide
          ? props.renderSlot('sidebar.workspaces', {
              wide,
              expandSidebar: () => {
                if (props.collapsed) props.toggleSidebar()
              },
            })
          : null}
      </div>

      <footer className={styles.footer}>
        {visibleFooterEntries.map(entry => (
          <div className={styles.footerItem} key={entry.id} title={entry.label}>
            {renderFooterEntry(entry, wide)}
          </div>
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
              <span aria-hidden="true">···</span>
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

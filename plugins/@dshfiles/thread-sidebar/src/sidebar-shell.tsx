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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { orderSidebarEntries, reorderSidebarEntry, type OrderedSidebarEntry } from './organization.js'
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

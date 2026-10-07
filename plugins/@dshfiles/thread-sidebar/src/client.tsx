import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Checkbox,
  IconArchiveOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconPauseOutlineRegular,
  IconPinFillRegular,
  IconPinOutlineRegular,
  IconPlayOutlineRegular,
  IconSettingsOutlineRegular,
  IconUnarchiveOutlineRegular,
  Input,
  Menu,
  MenuItemButton,
  StateDot,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { EmptyState, Field, Notice, TextArea, VisuallyHidden, type NoticeTone } from '@dshfiles/plugin-ui'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  isAutoArchiveCandidate,
  parseSessionIds,
  sessionLineage,
  sectionForSession,
  type SessionActivity,
  type SidebarPreferences,
  type SidebarSection,
  workspaceForLineage,
} from './organization.js'
import { toggleCollapsedSection } from './preferences.js'
import { useSidebarState } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { buildThreadUrl, clearThreadUrl, readThreadUrl } from './thread-url.js'
import styles from './thread-sidebar.module.css'

type InjectedActions = {
  archiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  unarchiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  pinSession: (sessionId: SessionSummary['id']) => Promise<void>
  unpinSession: (sessionId: SessionSummary['id']) => Promise<void>
  markRead: (sessionId: SessionSummary['id']) => Promise<boolean>
  setSnoozed: (sessionId: SessionSummary['id'], snoozed: boolean) => Promise<boolean>
}

type ThreadSidebarProps = Pick<WorkspaceBrowserProps, 'open' | 'useSessions' | 'useWorkspaces'> &
  InjectedActions & {
    tSidebar: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
  }

type ThreadSidebarTranslate = ThreadSidebarProps['tSidebar']

interface ThreadContextMenuState {
  sessionId: string
  workspaceId?: string
  x: number
  y: number
}

interface SidebarNotice {
  tone: NoticeTone
  message: string
}

const ALL_PROJECTS = '__all__'
const UNASSIGNED_PROJECT = '__unassigned__'

const sections: readonly SidebarSection[] = ['pinned', 'active', 'parked', 'inactive', 'archived']

const sectionLabels: Record<SidebarSection, Parameters<ThreadSidebarTranslate>[0]> = {
  pinned: 'threadSidebarPinned',
  active: 'threadSidebarActive',
  parked: 'threadSidebarParked',
  inactive: 'threadSidebarInactive',
  archived: 'threadSidebarArchived',
}

const setIncludes = (values: readonly string[]): ReadonlySet<string> => new Set(values)

const sessionsForAutoArchive = (ids: readonly SessionSummary['id'][], byId: Readonly<Record<string, SessionSummary>>): SessionSummary[] =>
  ids.flatMap(sessionId => {
    const session = byId[sessionId]
    return session === undefined ? [] : [session]
  })

const workspaceForSessions = (workspaces: readonly WorkspaceView[]): Map<string, string> => {
  const map = new Map<string, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) map.set(sessionId, workspace.workspaceId)
  }
  return map
}

/**
 * The reference carries the age of a thread on the right of its row ("22h"), so it
 * is read off updatedAt rather than repeated as an absolute date the row already
 * exposes in its title. Units stay inside the reference's own scale: nothing below
 * a minute, and nothing long enough to push the title off its line.
 */
const relativeTime = (updatedAt: number): string => {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - updatedAt) / 60000))
  if (elapsedMinutes < 1) return 'now'
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  const hours = Math.round(elapsedMinutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return days < 100 ? `${days}d` : `${Math.round(days / 30)}mo`
}

export const ThreadSidebar = (props: ThreadSidebarProps): JSX.Element => {
  const sessionState = props.useSessions(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const { preferences, updatePreferences, storageWarning, threadQuery } = useSidebarState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState<SidebarNotice | null>(null)
  const [contextMenu, setContextMenu] = useState<ThreadContextMenuState | null>(null)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [routeRequest, setRouteRequest] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : (readThreadUrl(window.location.href)?.sessionId ?? null),
  )
  const archiveInFlight = useRef(false)
  const legacyParkMigrationAttempts = useRef(new Set<SessionSummary['id']>())
  const readMarkAttempts = useRef(new Map<SessionSummary['id'], number>())
  const openedRouteId = useRef<string | null>(null)
  const suppressUrlForSession = useRef<string | null>(null)
  const latestAutoArchive = useRef<{
    sessions: SessionSummary[]
    workspaceBySession: Map<string, string>
    preferences: SidebarPreferences
    archived: ReadonlySet<string>
    pinned: ReadonlySet<string>
    archive: ThreadSidebarProps['archiveSession']
    announce: (notice: SidebarNotice) => void
  } | null>(null)

  const workspaceBySession = useMemo(() => workspaceForSessions(workspaceState.items), [workspaceState.items])
  const archivedSessionIds = useMemo(() => setIncludes(workspaceState.archivedSessionIds), [workspaceState.archivedSessionIds])
  const pinnedSessionIds = useMemo(() => setIncludes(workspaceState.pinnedSessionIds), [workspaceState.pinnedSessionIds])
  const displayWorkspaces = useMemo(
    () =>
      workspaceState.items.map(workspace => ({
        id: workspace.workspaceId,
        title: workspace.title.length > 0 ? workspace.title : props.tSidebar('threadSidebarDefaultProject'),
      })),
    [props.tSidebar, workspaceState.items],
  )
  const sessions = useMemo(() => sessionsForAutoArchive(sessionState.ids, sessionState.byId), [sessionState.byId, sessionState.ids])
  const parkedSessionIds = useMemo(() => {
    const localFallback = setIncludes(preferences.parkedSessionIds)
    return new Set(
      sessions.flatMap(session => {
        const parked = session.attention === null || session.attention === undefined ? localFallback.has(session.id) : session.attention.snoozed
        return parked ? [session.id] : []
      }),
    )
  }, [preferences.parkedSessionIds, sessions])
  const selectedSession = useMemo(() => Object.values(sessionState.byId).find(session => (session.retainedBy.mainView ?? 0) > 0), [sessionState.byId])

  useEffect(() => {
    if (sessionState.phase !== 'ready') return
    const legacyParked = setIncludes(preferences.parkedSessionIds)
    for (const session of sessions) {
      if (
        !legacyParked.has(session.id) ||
        (session.attention !== null && session.attention !== undefined) ||
        legacyParkMigrationAttempts.current.has(session.id)
      )
        continue
      legacyParkMigrationAttempts.current.add(session.id)
      void props
        .setSnoozed(session.id, true)
        .then(success => {
          if (!success) {
            legacyParkMigrationAttempts.current.delete(session.id)
            setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
          }
        })
        .catch(() => {
          legacyParkMigrationAttempts.current.delete(session.id)
          setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
        })
    }
  }, [preferences.parkedSessionIds, props.setSnoozed, props.tSidebar, sessionState.phase, sessions])

  useEffect(() => {
    const attention = selectedSession?.attention
    if (selectedSession === undefined || attention === null || attention === undefined || !attention.unread) return
    if (readMarkAttempts.current.get(selectedSession.id) === attention.lastPromptSeq) return
    readMarkAttempts.current.set(selectedSession.id, attention.lastPromptSeq ?? -1)
    void props
      .markRead(selectedSession.id)
      .then(success => {
        if (!success) {
          readMarkAttempts.current.delete(selectedSession.id)
          setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
        }
      })
      .catch(() => {
        readMarkAttempts.current.delete(selectedSession.id)
        setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
      })
  }, [props.markRead, props.tSidebar, selectedSession])

  useEffect(() => {
    const onPopState = (): void => {
      const requested = readThreadUrl(window.location.href)?.sessionId ?? null
      suppressUrlForSession.current = requested === null ? (selectedSession?.id ?? null) : null
      openedRouteId.current = null
      setRouteRequest(requested)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [selectedSession?.id])

  useEffect(() => {
    if (routeRequest === null || sessionState.phase !== 'ready') return
    const target = Object.values(sessionState.byId).find(session => session.id === routeRequest)
    if (target === undefined) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarLinkNotFound') })
      window.history.replaceState(window.history.state, '', clearThreadUrl(window.location.href))
      setRouteRequest(null)
      return
    }
    if ((target.retainedBy.mainView ?? 0) > 0) {
      openedRouteId.current = routeRequest
      setRouteRequest(null)
      return
    }
    if (openedRouteId.current === routeRequest) return
    openedRouteId.current = routeRequest
    props.open(target.id)
  }, [props.open, props.tSidebar, routeRequest, sessionState.byId, sessionState.phase])

  useEffect(() => {
    const selected = selectedSession
    if (selected === undefined || routeRequest !== null) return
    if (suppressUrlForSession.current === selected.id) return
    suppressUrlForSession.current = null
    const workspaceId = workspaceForLineage(selected, sessionState.byId, workspaceBySession)
    const next = buildThreadUrl(window.location.href, selected.id, workspaceId)
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next)
  }, [routeRequest, selectedSession, sessionState.byId, workspaceBySession])

  const changePreferences = (patch: Partial<SidebarPreferences>): void => {
    updatePreferences(patch)
  }

  const mutateSession = async (sessionId: SessionSummary['id'], operation: (sessionId: SessionSummary['id']) => Promise<void>): Promise<void> => {
    try {
      await operation(sessionId)
      setNotice(null)
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarArchiveFailure') })
    }
  }

  const openThread = (sessionId: SessionSummary['id']): void => {
    setRouteRequest(null)
    openedRouteId.current = sessionId
    suppressUrlForSession.current = null
    const session = sessionState.byId[sessionId]
    const workspaceId = session === undefined ? undefined : workspaceForLineage(session, sessionState.byId, workspaceBySession)
    window.history.replaceState(window.history.state, '', buildThreadUrl(window.location.href, sessionId, workspaceId))
    props.open(sessionId)
  }

  const copyContextValue = async (value: string, successMessage: string): Promise<void> => {
    setContextMenu(null)
    try {
      await navigator.clipboard.writeText(value)
      setNotice({ tone: 'success', message: successMessage })
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarClipboardFailure') })
    }
  }

  const toggleParked = (sessionId: SessionSummary['id']): void => {
    void props
      .setSnoozed(sessionId, !parkedSessionIds.has(sessionId))
      .then(success => {
        if (!success) setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
        else setNotice(null)
      })
      .catch(() => {
        setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
      })
  }

  const toggleSection = (section: SidebarSection): void => {
    changePreferences({
      collapsedSections: toggleCollapsedSection(preferences.collapsedSections, section),
    })
  }

  const runAutoArchive = async (): Promise<void> => {
    const latest = latestAutoArchive.current
    if (archiveInFlight.current || latest === null || !latest.preferences.autoArchiveEnabled) return
    archiveInFlight.current = true
    let failed = false
    try {
      const now = Date.now()
      for (const session of latest.sessions) {
        const activity: SessionActivity = session
        if (
          !isAutoArchiveCandidate({
            session: activity,
            workspaceId: latest.workspaceBySession.get(session.id),
            now,
            preferences: latest.preferences,
            archivedSessionIds: latest.archived,
            pinnedSessionIds: latest.pinned,
          })
        )
          continue
        try {
          await latest.archive(session.id)
        } catch {
          failed = true
        }
      }
    } finally {
      archiveInFlight.current = false
    }
    if (failed) latest.announce({ tone: 'danger', message: props.tSidebar('threadSidebarArchiveFailure') })
  }

  latestAutoArchive.current = {
    sessions,
    workspaceBySession,
    preferences,
    archived: archivedSessionIds,
    pinned: pinnedSessionIds,
    archive: props.archiveSession,
    announce: setNotice,
  }

  useEffect(() => {
    if (!preferences.autoArchiveEnabled) return
    if (sessionState.phase !== 'ready' || workspaceState.phase !== 'ready') return
    void runAutoArchive()
    const timer = window.setInterval(() => void runAutoArchive(), preferences.scanIntervalMinutes * 60_000)
    return () => window.clearInterval(timer)
  }, [preferences.autoArchiveEnabled, preferences.scanIntervalMinutes, sessionState.phase, workspaceState.phase])

  const rowsBySection = useMemo(() => {
    const rows = new Map<SidebarSection, SessionSummary[]>(sections.map(section => [section, []]))
    const normalizedQuery = threadQuery.trim().toLocaleLowerCase()
    for (const sessionId of sessionState.ids) {
      const session = sessionState.byId[sessionId]
      if (session === undefined || session.blank) continue
      const workspaceId = workspaceForLineage(session, sessionState.byId, workspaceBySession)
      if (preferences.workspaceFilter !== null && (workspaceId ?? '') !== preferences.workspaceFilter) continue
      if (normalizedQuery.length > 0) {
        const workspaceTitle = displayWorkspaces.find(workspace => workspace.id === workspaceId)?.title ?? ''
        const searchable = (session.displayTitle + ' ' + workspaceTitle).toLocaleLowerCase()
        if (!searchable.includes(normalizedQuery)) continue
      }
      const section = sectionForSession(session, archivedSessionIds, pinnedSessionIds, parkedSessionIds)
      rows.get(section)?.push(session)
    }
    for (const entries of rows.values()) entries.sort((left, right) => right.updatedAt - left.updatedAt)
    rows.set(
      'pinned',
      rows.get('pinned')?.sort((left, right) => workspaceState.pinnedSessionIds.indexOf(left.id) - workspaceState.pinnedSessionIds.indexOf(right.id)) ?? [],
    )
    return rows
  }, [
    archivedSessionIds,
    displayWorkspaces,
    parkedSessionIds,
    pinnedSessionIds,
    preferences.workspaceFilter,
    sessionState.byId,
    sessionState.ids,
    threadQuery,
    workspaceBySession,
    workspaceState.pinnedSessionIds,
  ])

  const projectFilterValue =
    preferences.workspaceFilter === null ? ALL_PROJECTS : preferences.workspaceFilter.length === 0 ? UNASSIGNED_PROJECT : preferences.workspaceFilter

  const selectProject = (value: string): void => {
    setProjectMenuOpen(false)
    if (value === ALL_PROJECTS) changePreferences({ workspaceFilter: null })
    else if (value === UNASSIGNED_PROJECT) changePreferences({ workspaceFilter: '' })
    else changePreferences({ workspaceFilter: value })
  }

  const projectMenuItems = [
    { id: ALL_PROJECTS, label: props.tSidebar('threadSidebarAllProjects') },
    { id: UNASSIGNED_PROJECT, label: props.tSidebar('threadSidebarUnassigned') },
    ...displayWorkspaces.map(workspace => ({ id: workspace.id, label: workspace.title })),
  ]

  const projectFilterLabel = projectMenuItems.find(item => item.id === projectFilterValue)?.label ?? props.tSidebar('threadSidebarAllProjects')

  const contextMenuAnchorRect = useCallback(
    (): DOMRect | null => (contextMenu === null ? null : new DOMRect(contextMenu.x, contextMenu.y, 0, 0)),
    [contextMenu],
  )

  const withTooltip = (label: string, anchor: ReactElement): JSX.Element => (
    <Tooltip label={label} side="top" delayMs={500} portal>
      {anchor}
    </Tooltip>
  )

  return (
    <section className={styles.sidebar} aria-label={props.tSidebar('threadSidebarTitle')}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{props.tSidebar('threadSidebarTitle')}</h2>
          {withTooltip(
            props.tSidebar('threadSidebarSettings'),
            <button
              type="button"
              className={styles.iconButton}
              aria-label={props.tSidebar('threadSidebarSettings')}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(value => !value)}
            >
              <IconSettingsOutlineRegular size={18} />
            </button>,
          )}
        </div>
        {/* The reference shows one plain label with a chevron, not a doubled
            label plus a boxed <select>, so the trigger is the label itself. */}
        <Menu
          className={styles.projectFilter}
          open={projectMenuOpen}
          portal
          items={projectMenuItems}
          selectedId={projectFilterValue}
          onSelect={selectProject}
          onClose={() => setProjectMenuOpen(false)}
          anchor={
            <button
              type="button"
              className={styles.projectFilterTrigger}
              aria-haspopup="menu"
              aria-expanded={projectMenuOpen}
              onClick={() => setProjectMenuOpen(value => !value)}
            >
              {projectFilterLabel}
            </button>
          }
        />
      </header>

      {settingsOpen ? (
        <section className={styles.settings} aria-label={props.tSidebar('threadSidebarSettings')}>
          <Checkbox
            checked={preferences.autoArchiveEnabled}
            label={props.tSidebar('threadSidebarAutoArchive')}
            onChange={checked => changePreferences({ autoArchiveEnabled: checked })}
          />
          <Field label={props.tSidebar('threadSidebarIdleAfter')}>
            {control => (
              <Input
                {...control}
                type="number"
                min={15}
                max={10080}
                value={preferences.idleMinutes}
                onChange={event => {
                  const value = Number(event.currentTarget.value)
                  if (Number.isInteger(value) && value >= 15 && value <= 10080) changePreferences({ idleMinutes: value })
                }}
              />
            )}
          </Field>
          <Field label={props.tSidebar('threadSidebarScanEvery')}>
            {control => (
              <Input
                {...control}
                type="number"
                min={1}
                max={120}
                value={preferences.scanIntervalMinutes}
                onChange={event => {
                  const value = Number(event.currentTarget.value)
                  if (Number.isInteger(value) && value >= 1 && value <= 120) changePreferences({ scanIntervalMinutes: value })
                }}
              />
            )}
          </Field>
          <fieldset className={styles.exclusions}>
            <legend>{props.tSidebar('threadSidebarExcludedProjects')}</legend>
            {displayWorkspaces.map(workspace => (
              <Checkbox
                key={workspace.id}
                checked={preferences.excludedWorkspaceIds.includes(workspace.id)}
                label={workspace.title}
                onChange={checked => {
                  const next = checked
                    ? [...preferences.excludedWorkspaceIds, workspace.id]
                    : preferences.excludedWorkspaceIds.filter(id => id !== workspace.id)
                  changePreferences({ excludedWorkspaceIds: next })
                }}
              />
            ))}
          </fieldset>
          <Field label={props.tSidebar('threadSidebarExcludedSessions')} description={props.tSidebar('threadSidebarExclusionHint')}>
            {control => (
              <TextArea
                {...control}
                rows={3}
                value={preferences.excludedSessionIds.join('\n')}
                onChange={event => changePreferences({ excludedSessionIds: parseSessionIds(event.currentTarget.value) })}
              />
            )}
          </Field>
          <p className={styles.note}>{props.tSidebar('threadSidebarTimestampNote')}</p>
        </section>
      ) : null}

      {notice !== null ? (
        <Notice className={styles.notice} tone={notice.tone}>
          {notice.message}
        </Notice>
      ) : null}
      {storageWarning ? (
        <Notice className={styles.notice} tone="warning">
          {props.tSidebar('threadSidebarStorageFailure')}
        </Notice>
      ) : null}

      <div className={styles.sections}>
        {sessionState.phase !== 'ready' || workspaceState.phase !== 'ready' ? <EmptyState compact title={props.tSidebar('threadSidebarLoading')} /> : null}
        {sections.map(section => {
          const rows = rowsBySection.get(section) ?? []
          if (rows.length === 0 && section !== 'active') return null
          const collapsed = preferences.collapsedSections.includes(section)
          return (
            <section className={styles.group} key={section}>
              <button type="button" className={styles.groupHeader} aria-expanded={!collapsed} onClick={() => toggleSection(section)}>
                <span>{props.tSidebar(sectionLabels[section])}</span>
                <span className={styles.count}>({rows.length})</span>
                {collapsed ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronUpOutlineRegular size={12} />}
              </button>
              {!collapsed
                ? rows.map(session => {
                    const archived = archivedSessionIds.has(session.id)
                    const pinned = pinnedSessionIds.has(session.id)
                    const parked = parkedSessionIds.has(session.id)
                    const lineage = sessionLineage(session, sessionState.byId)
                    const workspaceId = workspaceForLineage(session, sessionState.byId, workspaceBySession)
                    const workspaceTitle = displayWorkspaces.find(workspace => workspace.id === workspaceId)?.title
                    return (
                      <article
                        className={styles.row}
                        data-lineage-depth={lineage.depth}
                        key={session.id}
                        onContextMenu={event => {
                          event.preventDefault()
                          setContextMenu({ sessionId: session.id, workspaceId, x: event.clientX, y: event.clientY })
                        }}
                        style={{ marginInlineStart: lineage.depth * 12 }}
                      >
                        <button
                          type="button"
                          className={styles.openButton}
                          disabled={archived}
                          title={new Date(session.updatedAt).toLocaleString()}
                          onClick={() => openThread(session.id)}
                        >
                          {/*
                            The reference leads each row with its title, then a
                            single dimmer line of context beneath it. A project
                            name stacked above the title made the title the
                            second line and pushed the row past the reference
                            height, so the project and the run state now share
                            one trailing line.
                          */}
                          <span className={styles.rowTitle}>
                            {session.attention?.unread ? (
                              <span className={styles.unreadDot} role="img" aria-label={props.tSidebar('threadSidebarUnread')}>
                                ●
                              </span>
                            ) : null}
                            {session.running ? (
                              <span className={styles.runningDot} title={props.tSidebar('threadSidebarWorking')}>
                                <StateDot state="ongoing" size={12} />
                                <VisuallyHidden>{props.tSidebar('threadSidebarWorking')}</VisuallyHidden>
                              </span>
                            ) : null}
                            {session.displayTitle}
                          </span>
                          <span className={styles.rowProject}>
                            {workspaceTitle ?? props.tSidebar('threadSidebarUnassigned')}
                            {lineage.parentTitle === undefined ? null : (
                              <span className={styles.parentLabel}>
                                {' · '}
                                {props.tSidebar('threadSidebarChildOf')} {lineage.parentTitle}
                              </span>
                            )}
                          </span>
                        </button>
                        <span className={styles.rowTime} aria-hidden="true">
                          {relativeTime(session.updatedAt)}
                        </span>
                        <div className={styles.actions}>
                          {!archived ? (
                            <>
                              {withTooltip(
                                props.tSidebar(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin'),
                                <button
                                  type="button"
                                  aria-label={props.tSidebar(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')}
                                  onClick={() => void mutateSession(session.id, pinned ? props.unpinSession : props.pinSession)}
                                >
                                  {pinned ? <IconPinFillRegular size={16} /> : <IconPinOutlineRegular size={16} />}
                                </button>,
                              )}
                              {withTooltip(
                                props.tSidebar(parked ? 'threadSidebarUnpark' : 'threadSidebarPark'),
                                <button
                                  type="button"
                                  aria-label={props.tSidebar(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')}
                                  disabled={session.running}
                                  onClick={() => toggleParked(session.id)}
                                >
                                  {parked ? <IconPlayOutlineRegular size={16} /> : <IconPauseOutlineRegular size={16} />}
                                </button>,
                              )}
                              {withTooltip(
                                props.tSidebar(session.running ? 'threadSidebarRunningNotice' : 'threadSidebarArchive'),
                                <button
                                  type="button"
                                  aria-label={props.tSidebar('threadSidebarArchive')}
                                  disabled={session.running}
                                  onClick={() => void mutateSession(session.id, props.archiveSession)}
                                >
                                  <IconArchiveOutlineRegular size={16} />
                                </button>,
                              )}
                            </>
                          ) : (
                            withTooltip(
                              props.tSidebar('threadSidebarRestore'),
                              <button
                                type="button"
                                aria-label={props.tSidebar('threadSidebarRestore')}
                                onClick={() => void mutateSession(session.id, props.unarchiveSession)}
                              >
                                <IconUnarchiveOutlineRegular size={16} />
                              </button>,
                            )
                          )}
                        </div>
                      </article>
                    )
                  })
                : null}
            </section>
          )
        })}
        {sessionState.phase === 'ready' && [...rowsBySection.values()].every(rows => rows.length === 0) ? (
          <EmptyState compact title={props.tSidebar('threadSidebarEmpty')} />
        ) : null}
      </div>
      <Menu open={contextMenu !== null} anchor={<span />} portal autoFocus getAnchorRect={contextMenuAnchorRect} onClose={() => setContextMenu(null)}>
        {contextMenu === null ? null : (
          <>
            <MenuItemButton onSelect={() => void copyContextValue(contextMenu.sessionId, props.tSidebar('threadSidebarIdCopied'))}>
              {props.tSidebar('threadSidebarCopyId')}
            </MenuItemButton>
            <MenuItemButton
              onSelect={() =>
                void copyContextValue(
                  buildThreadUrl(window.location.href, contextMenu.sessionId, contextMenu.workspaceId),
                  props.tSidebar('threadSidebarLinkCopied'),
                )
              }
            >
              {props.tSidebar('threadSidebarCopyLink')}
            </MenuItemButton>
          </>
        )}
      </Menu>
    </section>
  )
}

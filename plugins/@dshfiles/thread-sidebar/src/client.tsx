import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useMemo, useRef, useState } from 'react'
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

export const ThreadSidebar = (props: ThreadSidebarProps): JSX.Element => {
  const sessionState = props.useSessions(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const { preferences, updatePreferences, storageWarning, threadQuery } = useSidebarState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ThreadContextMenuState | null>(null)
  const [routeRequest, setRouteRequest] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : (readThreadUrl(window.location.href)?.sessionId ?? null),
  )
  const archiveInFlight = useRef(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const openedRouteId = useRef<string | null>(null)
  const suppressUrlForSession = useRef<string | null>(null)
  const latestAutoArchive = useRef<{
    sessions: SessionSummary[]
    workspaceBySession: Map<string, string>
    preferences: SidebarPreferences
    archived: ReadonlySet<string>
    pinned: ReadonlySet<string>
    archive: ThreadSidebarProps['archiveSession']
    announce: (message: string) => void
  } | null>(null)

  const workspaceBySession = useMemo(() => workspaceForSessions(workspaceState.items), [workspaceState.items])
  const archivedSessionIds = useMemo(() => setIncludes(workspaceState.archivedSessionIds), [workspaceState.archivedSessionIds])
  const pinnedSessionIds = useMemo(() => setIncludes(workspaceState.pinnedSessionIds), [workspaceState.pinnedSessionIds])
  const parkedSessionIds = useMemo(() => setIncludes(preferences.parkedSessionIds), [preferences.parkedSessionIds])
  const displayWorkspaces = useMemo(
    () =>
      workspaceState.items.map(workspace => ({
        id: workspace.workspaceId,
        title: workspace.title.length > 0 ? workspace.title : props.tSidebar('threadSidebarDefaultProject'),
      })),
    [props.tSidebar, workspaceState.items],
  )
  const sessions = useMemo(() => sessionsForAutoArchive(sessionState.ids, sessionState.byId), [sessionState.byId, sessionState.ids])
  const selectedSession = useMemo(() => Object.values(sessionState.byId).find(session => (session.retainedBy.mainView ?? 0) > 0), [sessionState.byId])

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
      setNotice(props.tSidebar('threadSidebarLinkNotFound'))
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

  useEffect(() => {
    if (contextMenu === null) return
    contextMenuRef.current?.querySelector('button')?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return
      setContextMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setContextMenu(null)
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const items = [...(contextMenuRef.current?.querySelectorAll('button') ?? [])]
      if (items.length === 0) return
      event.preventDefault()
      const currentIndex = items.findIndex(item => item === document.activeElement)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = (currentIndex + direction + items.length) % items.length
      items[nextIndex]?.focus()
    }
    const close = (): void => setContextMenu(null)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  const changePreferences = (patch: Partial<SidebarPreferences>): void => {
    updatePreferences(patch)
  }

  const mutateSession = async (sessionId: SessionSummary['id'], operation: (sessionId: SessionSummary['id']) => Promise<void>): Promise<void> => {
    try {
      await operation(sessionId)
      setNotice(null)
    } catch {
      setNotice(props.tSidebar('threadSidebarArchiveFailure'))
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
      setNotice(successMessage)
    } catch {
      setNotice(props.tSidebar('threadSidebarClipboardFailure'))
    }
  }

  const toggleParked = (sessionId: SessionSummary['id']): void => {
    const next = preferences.parkedSessionIds.includes(sessionId)
      ? preferences.parkedSessionIds.filter(id => id !== sessionId)
      : [...preferences.parkedSessionIds, sessionId]
    changePreferences({ parkedSessionIds: next })
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
    if (failed) latest.announce(props.tSidebar('threadSidebarArchiveFailure'))
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
    preferences.workspaceFilter === null ? '__all__' : preferences.workspaceFilter.length === 0 ? '__unassigned__' : preferences.workspaceFilter

  const selectProject = (value: string): void => {
    if (value === '__all__') changePreferences({ workspaceFilter: null })
    else if (value === '__unassigned__') changePreferences({ workspaceFilter: '' })
    else changePreferences({ workspaceFilter: value })
  }

  const projectFilterLabel =
    projectFilterValue === '__all__'
      ? props.tSidebar('threadSidebarAllProjects')
      : projectFilterValue === '__unassigned__'
        ? props.tSidebar('threadSidebarUnassigned')
        : (displayWorkspaces.find(workspace => workspace.id === projectFilterValue)?.title ?? props.tSidebar('threadSidebarAllProjects'))

  return (
    <section className={styles.sidebar} aria-label={props.tSidebar('threadSidebarTitle')}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{props.tSidebar('threadSidebarTitle')}</h2>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={props.tSidebar('threadSidebarSettings')}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(value => !value)}
          >
            ⚙
          </button>
        </div>
        {/* The reference shows one plain label with a chevron, not a doubled
            label plus a boxed <select>, so the control is a disclosure whose
            summary carries the label and the native marker carries the arrow. */}
        <details className={styles.projectFilter}>
          <summary>{projectFilterLabel}</summary>
          <div className={styles.projectMenu} role="group">
            <button type="button" aria-pressed={projectFilterValue === '__all__'} onClick={() => selectProject('__all__')}>
              {props.tSidebar('threadSidebarAllProjects')}
            </button>
            <button type="button" aria-pressed={projectFilterValue === '__unassigned__'} onClick={() => selectProject('__unassigned__')}>
              {props.tSidebar('threadSidebarUnassigned')}
            </button>
            {displayWorkspaces.map(workspace => (
              <button key={workspace.id} type="button" aria-pressed={projectFilterValue === workspace.id} onClick={() => selectProject(workspace.id)}>
                {workspace.title}
              </button>
            ))}
          </div>
        </details>
      </header>

      {settingsOpen ? (
        <section className={styles.settings} aria-label={props.tSidebar('threadSidebarSettings')}>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={preferences.autoArchiveEnabled}
              onChange={event => changePreferences({ autoArchiveEnabled: event.currentTarget.checked })}
            />
            <span>{props.tSidebar('threadSidebarAutoArchive')}</span>
          </label>
          <label className={styles.field}>
            <span>{props.tSidebar('threadSidebarIdleAfter')}</span>
            <input
              type="number"
              min={15}
              max={10080}
              value={preferences.idleMinutes}
              onChange={event => {
                const value = Number(event.currentTarget.value)
                if (Number.isInteger(value) && value >= 15 && value <= 10080) changePreferences({ idleMinutes: value })
              }}
            />
          </label>
          <label className={styles.field}>
            <span>{props.tSidebar('threadSidebarScanEvery')}</span>
            <input
              type="number"
              min={1}
              max={120}
              value={preferences.scanIntervalMinutes}
              onChange={event => {
                const value = Number(event.currentTarget.value)
                if (Number.isInteger(value) && value >= 1 && value <= 120) changePreferences({ scanIntervalMinutes: value })
              }}
            />
          </label>
          <fieldset className={styles.exclusions}>
            <legend>{props.tSidebar('threadSidebarExcludedProjects')}</legend>
            {displayWorkspaces.map(workspace => (
              <label className={styles.checkRow} key={workspace.id}>
                <input
                  type="checkbox"
                  checked={preferences.excludedWorkspaceIds.includes(workspace.id)}
                  onChange={event => {
                    const next = event.currentTarget.checked
                      ? [...preferences.excludedWorkspaceIds, workspace.id]
                      : preferences.excludedWorkspaceIds.filter(id => id !== workspace.id)
                    changePreferences({ excludedWorkspaceIds: next })
                  }}
                />
                <span>{workspace.title}</span>
              </label>
            ))}
          </fieldset>
          <label className={styles.field}>
            <span>{props.tSidebar('threadSidebarExcludedSessions')}</span>
            <textarea
              rows={3}
              value={preferences.excludedSessionIds.join('\n')}
              onChange={event => changePreferences({ excludedSessionIds: parseSessionIds(event.currentTarget.value) })}
            />
            <small>{props.tSidebar('threadSidebarExclusionHint')}</small>
          </label>
          <p className={styles.note}>{props.tSidebar('threadSidebarTimestampNote')}</p>
        </section>
      ) : null}

      {notice !== null ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      {storageWarning ? (
        <p role="status" className={styles.notice}>
          {props.tSidebar('threadSidebarStorageFailure')}
        </p>
      ) : null}

      <div className={styles.sections}>
        {sessionState.phase !== 'ready' || workspaceState.phase !== 'ready' ? <p className={styles.empty}>{props.tSidebar('threadSidebarLoading')}</p> : null}
        {sections.map(section => {
          const rows = rowsBySection.get(section) ?? []
          if (rows.length === 0 && section !== 'active') return null
          const collapsed = preferences.collapsedSections.includes(section)
          return (
            <section className={styles.group} key={section}>
              <button type="button" className={styles.groupHeader} aria-expanded={!collapsed} onClick={() => toggleSection(section)}>
                <span>{props.tSidebar(sectionLabels[section])}</span>
                <span className={styles.count}>{rows.length}</span>
                <span aria-hidden="true">{collapsed ? '⌄' : '⌃'}</span>
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
                          const width = 210
                          const height = 88
                          setContextMenu({
                            sessionId: session.id,
                            workspaceId,
                            x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
                            y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
                          })
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
                          <span className={styles.rowProject}>
                            {workspaceTitle ?? props.tSidebar('threadSidebarUnassigned')}
                            {lineage.parentTitle === undefined ? null : (
                              <span className={styles.parentLabel}>
                                {' · '}
                                {props.tSidebar('threadSidebarChildOf')} {lineage.parentTitle}
                              </span>
                            )}
                          </span>
                          <span className={styles.rowTitle}>{session.displayTitle}</span>
                          {session.running ? <span className={styles.running}>{props.tSidebar('threadSidebarWorking')}</span> : null}
                        </button>
                        <div className={styles.actions}>
                          {!archived ? (
                            <>
                              <button
                                type="button"
                                aria-label={props.tSidebar(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')}
                                title={props.tSidebar(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')}
                                onClick={() => void mutateSession(session.id, pinned ? props.unpinSession : props.pinSession)}
                              >
                                {pinned ? '◆' : '◇'}
                              </button>
                              <button
                                type="button"
                                aria-label={props.tSidebar(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')}
                                title={props.tSidebar(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')}
                                disabled={session.running}
                                onClick={() => toggleParked(session.id)}
                              >
                                {parked ? '▰' : '▱'}
                              </button>
                              <button
                                type="button"
                                aria-label={props.tSidebar('threadSidebarArchive')}
                                title={props.tSidebar(session.running ? 'threadSidebarRunningNotice' : 'threadSidebarArchive')}
                                disabled={session.running}
                                onClick={() => void mutateSession(session.id, props.archiveSession)}
                              >
                                ↓
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              aria-label={props.tSidebar('threadSidebarRestore')}
                              title={props.tSidebar('threadSidebarRestore')}
                              onClick={() => void mutateSession(session.id, props.unarchiveSession)}
                            >
                              ↩
                            </button>
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
          <p className={styles.empty}>{props.tSidebar('threadSidebarEmpty')}</p>
        ) : null}
      </div>
      {contextMenu === null ? null : (
        <div
          ref={contextMenuRef}
          className={styles.contextMenu}
          role="menu"
          aria-label={props.tSidebar('threadSidebarContextMenu')}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button type="button" role="menuitem" onClick={() => void copyContextValue(contextMenu.sessionId, props.tSidebar('threadSidebarIdCopied'))}>
            {props.tSidebar('threadSidebarCopyId')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void copyContextValue(
                buildThreadUrl(window.location.href, contextMenu.sessionId, contextMenu.workspaceId),
                props.tSidebar('threadSidebarLinkCopied'),
              )
            }
          >
            {props.tSidebar('threadSidebarCopyLink')}
          </button>
        </div>
      )}
    </section>
  )
}

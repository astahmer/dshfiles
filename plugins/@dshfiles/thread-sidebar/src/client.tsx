import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  isAutoArchiveCandidate,
  parseSessionIds,
  sectionForSession,
  type SessionActivity,
  type SidebarPreferences,
  type SidebarSection,
} from './organization.js'
import { toggleCollapsedSection } from './preferences.js'
import { useSidebarState } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import styles from './thread-sidebar.module.css'

type InjectedActions = {
  archiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  unarchiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  pinSession: (sessionId: SessionSummary['id']) => Promise<void>
  unpinSession: (sessionId: SessionSummary['id']) => Promise<void>
}

type ThreadSidebarProps = Pick<WorkspaceBrowserProps, 'open' | 'useSessions' | 'useWorkspaces'> & InjectedActions & {
  tSidebar: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
}

type ThreadSidebarTranslate = ThreadSidebarProps['tSidebar']

const sections: readonly SidebarSection[] = ['pinned', 'active', 'parked', 'inactive', 'archived']

const sectionLabels: Record<SidebarSection, Parameters<ThreadSidebarTranslate>[0]> = {
  pinned: 'threadSidebarPinned',
  active: 'threadSidebarActive',
  parked: 'threadSidebarParked',
  inactive: 'threadSidebarInactive',
  archived: 'threadSidebarArchived',
}

const setIncludes = (values: readonly string[]): ReadonlySet<string> => new Set(values)

const sessionsForAutoArchive = (
  ids: readonly SessionSummary['id'][],
  byId: Readonly<Record<string, SessionSummary>>,
): SessionSummary[] => ids.flatMap(sessionId => {
  const session = byId[sessionId]
  return session === undefined ? [] : [session]
})

const workspaceForSessions = (
  workspaces: readonly WorkspaceView[],
): Map<string, string> => {
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
  const archiveInFlight = useRef(false)
  const latestAutoArchive = useRef<{
    sessions: SessionSummary[]
    workspaceBySession: Map<string, string>
    preferences: SidebarPreferences
    archived: ReadonlySet<string>
    pinned: ReadonlySet<string>
    archive: ThreadSidebarProps['archiveSession']
    announce: (message: string) => void
  } | null>(null)

  const workspaceBySession = useMemo(
    () => workspaceForSessions(workspaceState.items),
    [workspaceState.items],
  )
  const archivedSessionIds = useMemo(() => setIncludes(workspaceState.archivedSessionIds), [workspaceState.archivedSessionIds])
  const pinnedSessionIds = useMemo(() => setIncludes(workspaceState.pinnedSessionIds), [workspaceState.pinnedSessionIds])
  const parkedSessionIds = useMemo(() => setIncludes(preferences.parkedSessionIds), [preferences.parkedSessionIds])
  const displayWorkspaces = useMemo(
    () => workspaceState.items.map(workspace => ({
      id: workspace.workspaceId,
      title: workspace.title.length > 0 ? workspace.title : props.tSidebar('threadSidebarDefaultProject'),
    })),
    [props.tSidebar, workspaceState.items],
  )
  const sessions = useMemo(
    () => sessionsForAutoArchive(sessionState.ids, sessionState.byId),
    [sessionState.byId, sessionState.ids],
  )

  const changePreferences = (patch: Partial<SidebarPreferences>): void => {
    updatePreferences(patch)
  }

  const mutateSession = async (
    sessionId: SessionSummary['id'],
    operation: (sessionId: SessionSummary['id']) => Promise<void>,
  ): Promise<void> => {
    try {
      await operation(sessionId)
      setNotice(null)
    } catch {
      setNotice(props.tSidebar('threadSidebarArchiveFailure'))
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
        if (!isAutoArchiveCandidate({
          session: activity,
          workspaceId: latest.workspaceBySession.get(session.id),
          now,
          preferences: latest.preferences,
          archivedSessionIds: latest.archived,
          pinnedSessionIds: latest.pinned,
        })) continue
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
    const timer = window.setInterval(
      () => void runAutoArchive(),
      preferences.scanIntervalMinutes * 60_000,
    )
    return () => window.clearInterval(timer)
  }, [preferences.autoArchiveEnabled, preferences.scanIntervalMinutes, sessionState.phase, workspaceState.phase])

  const rowsBySection = useMemo(() => {
    const rows = new Map<SidebarSection, SessionSummary[]>(sections.map(section => [section, []]))
    const normalizedQuery = threadQuery.trim().toLocaleLowerCase()
    for (const sessionId of sessionState.ids) {
      const session = sessionState.byId[sessionId]
      if (session === undefined || session.blank) continue
      const workspaceId = workspaceBySession.get(session.id)
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
    rows.set('pinned', rows.get('pinned')?.sort((left, right) =>
      workspaceState.pinnedSessionIds.indexOf(left.id) - workspaceState.pinnedSessionIds.indexOf(right.id),
    ) ?? [])
    return rows
  }, [archivedSessionIds, displayWorkspaces, parkedSessionIds, pinnedSessionIds, preferences.workspaceFilter, sessionState.byId, sessionState.ids, threadQuery, workspaceBySession, workspaceState.pinnedSessionIds])

  const projectFilterValue = preferences.workspaceFilter === null
    ? '__all__'
    : preferences.workspaceFilter.length === 0
      ? '__unassigned__'
      : preferences.workspaceFilter

  const selectProject = (value: string): void => {
    if (value === '__all__') changePreferences({ workspaceFilter: null })
    else if (value === '__unassigned__') changePreferences({ workspaceFilter: '' })
    else changePreferences({ workspaceFilter: value })
  }

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
        <label className={styles.projectFilter}>
          <span>{props.tSidebar('threadSidebarAllProjects')}</span>
          <select value={projectFilterValue} onChange={event => selectProject(event.currentTarget.value)}>
            <option value="__all__">{props.tSidebar('threadSidebarAllProjects')}</option>
            <option value="__unassigned__">{props.tSidebar('threadSidebarUnassigned')}</option>
            {displayWorkspaces.map(workspace => (
              <option key={workspace.id} value={workspace.id}>{workspace.title}</option>
            ))}
          </select>
        </label>
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

      {notice !== null ? <p role="status" className={styles.notice}>{notice}</p> : null}
      {storageWarning ? <p role="status" className={styles.notice}>{props.tSidebar('threadSidebarStorageFailure')}</p> : null}

      <div className={styles.sections}>
        {sessionState.phase !== 'ready' || workspaceState.phase !== 'ready' ? (
          <p className={styles.empty}>{props.tSidebar('threadSidebarLoading')}</p>
        ) : null}
        {sections.map(section => {
          const rows = rowsBySection.get(section) ?? []
          if (rows.length === 0 && section !== 'active') return null
          const collapsed = preferences.collapsedSections.includes(section)
          return (
            <section className={styles.group} key={section}>
              <button
                type="button"
                className={styles.groupHeader}
                aria-expanded={!collapsed}
                onClick={() => toggleSection(section)}
              >
                <span>{props.tSidebar(sectionLabels[section])}</span>
                <span className={styles.count}>{rows.length}</span>
                <span aria-hidden="true">{collapsed ? '⌄' : '⌃'}</span>
              </button>
              {!collapsed ? rows.map(session => {
                const archived = archivedSessionIds.has(session.id)
                const pinned = pinnedSessionIds.has(session.id)
                const parked = parkedSessionIds.has(session.id)
                const workspaceId = workspaceBySession.get(session.id)
                const workspaceTitle = displayWorkspaces.find(workspace => workspace.id === workspaceId)?.title
                return (
                  <article className={styles.row} key={session.id}>
                    <button
                      type="button"
                      className={styles.openButton}
                      disabled={archived}
                      title={new Date(session.updatedAt).toLocaleString()}
                      onClick={() => props.open(session.id)}
                    >
                      <span className={styles.rowProject}>{workspaceTitle ?? props.tSidebar('threadSidebarUnassigned')}</span>
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
                          >{pinned ? '◆' : '◇'}</button>
                          <button
                            type="button"
                            aria-label={props.tSidebar(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')}
                            title={props.tSidebar(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')}
                            disabled={session.running}
                            onClick={() => toggleParked(session.id)}
                          >{parked ? '▰' : '▱'}</button>
                          <button
                            type="button"
                            aria-label={props.tSidebar('threadSidebarArchive')}
                            title={props.tSidebar(session.running ? 'threadSidebarRunningNotice' : 'threadSidebarArchive')}
                            disabled={session.running}
                            onClick={() => void mutateSession(session.id, props.archiveSession)}
                          >↓</button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={props.tSidebar('threadSidebarRestore')}
                          title={props.tSidebar('threadSidebarRestore')}
                          onClick={() => void mutateSession(session.id, props.unarchiveSession)}
                        >↩</button>
                      )}
                    </div>
                  </article>
                )
              }) : null}
            </section>
          )
        })}
        {sessionState.phase === 'ready' && [...rowsBySection.values()].every(rows => rows.length === 0) ? (
          <p className={styles.empty}>{props.tSidebar('threadSidebarEmpty')}</p>
        ) : null}
      </div>
    </section>
  )
}

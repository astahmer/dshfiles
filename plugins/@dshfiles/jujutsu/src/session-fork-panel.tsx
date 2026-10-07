import type { ISessions, SessionEventWindow, SessionReference, SessionSnapshot, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { durableForkBoundaries } from './fork-boundaries.js'
import styles from './jujutsu.module.css'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    jujutsuHistory: unknown
  }
}

interface SessionForkPanelProps {
  readonly sessions: ISessions
  readonly openSession: (sessionId: SessionSummary['id']) => void
}

interface HistoryWindow {
  readonly sessionId: SessionSummary['id']
  readonly window: SessionEventWindow
}

interface SessionStatus {
  readonly sessionId: SessionSummary['id']
  readonly snapshot: SessionSnapshot
}

interface SessionError {
  readonly sessionId: SessionSummary['id']
  readonly message: string
}

interface SelectedBoundary {
  readonly sessionId: SessionSummary['id']
  readonly seq: number
}

export const SessionForkPanel = (props: SessionForkPanelProps): JSX.Element => {
  const [selectedSessionId, setSelectedSessionId] = useState<SessionSummary['id'] | ''>('')
  const [reference, setReference] = useState<SessionReference | null>(null)
  const [historyWindow, setHistoryWindow] = useState<HistoryWindow | null>(null)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null)
  const [historyError, setHistoryError] = useState<SessionError | null>(null)
  const [selectedBoundary, setSelectedBoundary] = useState<SelectedBoundary | null>(null)
  const [loadingOlderSessionId, setLoadingOlderSessionId] = useState<SessionSummary['id'] | null>(null)
  const [forkingSessionId, setForkingSessionId] = useState<SessionSummary['id'] | null>(null)
  const [forkError, setForkError] = useState<string | null>(null)
  const [forkedSessionId, setForkedSessionId] = useState<SessionSummary['id'] | null>(null)

  const subscribeSessions = useCallback((listener: () => void) => props.sessions.list.subscribe(listener), [props.sessions])
  const readSessions = useCallback(() => props.sessions.list.getSnapshot(), [props.sessions])
  const sessionList = useSyncExternalStore(subscribeSessions, readSessions, readSessions)

  useEffect(() => {
    if (selectedSessionId === '') return
    const sessionId = selectedSessionId
    const retained = props.sessions.retain(sessionId, { source: 'jujutsuHistory' })
    let active = true
    const sync = (): void => {
      if (!active) return
      setHistoryWindow({ sessionId, window: retained.binding.eventSource.getSnapshot() })
      setSessionStatus({ sessionId, snapshot: retained.binding.session.getSnapshot() })
    }
    const unsubscribe = [retained.binding.eventSource.subscribe(sync), retained.binding.session.subscribe(sync)]
    setReference(retained)
    setHistoryError(null)
    sync()
    void retained.ready.then(sync).catch(reason => {
      if (active) setHistoryError({ sessionId, message: reason instanceof Error ? reason.message : 'Could not load Session history.' })
    })
    return () => {
      active = false
      unsubscribe.forEach(stop => stop())
      retained.release()
    }
  }, [props.sessions, selectedSessionId])

  const activeReference = reference?.sessionId === selectedSessionId ? reference : null
  const activeWindow = historyWindow !== null && historyWindow.sessionId === selectedSessionId ? historyWindow.window : null
  const activeStatus = sessionStatus !== null && sessionStatus.sessionId === selectedSessionId ? sessionStatus.snapshot : null
  const activeError = historyError !== null && historyError.sessionId === selectedSessionId ? historyError.message : null
  const boundaries = useMemo(() => durableForkBoundaries(activeWindow?.entries ?? []), [activeWindow?.entries])
  const selectedBoundarySeq =
    selectedBoundary !== null && selectedBoundary.sessionId === selectedSessionId && boundaries.some(boundary => boundary.seq === selectedBoundary.seq)
      ? selectedBoundary.seq
      : boundaries.at(-1)?.seq
  const selectedSession = selectedSessionId === '' ? undefined : sessionList.byId[selectedSessionId]

  const loadOlder = async (): Promise<void> => {
    const sessionId = selectedSessionId
    if (activeReference === null || sessionId === '') return
    setLoadingOlderSessionId(sessionId)
    setHistoryError(null)
    try {
      await activeReference.binding.session.loadOlder()
    } catch (reason) {
      setHistoryError({ sessionId, message: reason instanceof Error ? reason.message : 'Could not load older Session history.' })
    } finally {
      setLoadingOlderSessionId(null)
    }
  }

  const forkAtBoundary = async (): Promise<void> => {
    const sessionId = selectedSessionId
    if (sessionId === '' || selectedBoundarySeq === undefined) return
    setForkingSessionId(sessionId)
    setForkError(null)
    setForkedSessionId(null)
    try {
      const childId = await props.sessions.fork({ sessionId, atSeq: selectedBoundarySeq })
      setForkedSessionId(childId)
      props.openSession(childId)
    } catch (reason) {
      setForkError(reason instanceof Error ? reason.message : 'Could not fork this Session boundary.')
    } finally {
      setForkingSessionId(null)
    }
  }

  return (
    <section className={styles.sessionTools} aria-labelledby="jj-session-fork-title">
      <h2 id="jj-session-fork-title">Fork a Session at a history boundary</h2>
      <p className={styles.muted}>
        Choose a listed Session and a durable event sequence. Message contents and transient stream chunks stay out of this history control.
      </p>
      <div className={styles.sessionToolGrid}>
        <label>
          Session
          <select
            aria-label="Session to fork"
            value={selectedSessionId}
            onChange={event => setSelectedSessionId(sessionList.ids.find(id => id === event.target.value) ?? '')}
          >
            <option value="">Choose a Session</option>
            {sessionList.ids.map(id => {
              const summary = sessionList.byId[id]
              return summary === undefined ? null : (
                <option key={summary.id} value={summary.id}>
                  {summary.displayTitle} — {summary.cwd ?? 'no working directory'}
                </option>
              )
            })}
          </select>
        </label>
        <label>
          Durable boundary
          <select
            aria-label="Fork boundary sequence"
            value={selectedBoundarySeq ?? ''}
            onChange={event => {
              const next = boundaries.find(boundary => String(boundary.seq) === event.target.value)
              if (next !== undefined && selectedSessionId !== '') setSelectedBoundary({ sessionId: selectedSessionId, seq: next.seq })
            }}
            disabled={boundaries.length === 0}
          >
            {boundaries.length === 0 && <option value="">No loaded durable events</option>}
            {boundaries.map(boundary => (
              <option key={boundary.seq} value={boundary.seq}>
                {boundary.seq} · {boundary.eventType}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.secondary}
          disabled={selectedSessionId === '' || selectedBoundarySeq === undefined || forkingSessionId !== null}
          onClick={() => void forkAtBoundary()}
        >
          {forkingSessionId === selectedSessionId ? 'Forking…' : 'Fork and open'}
        </button>
      </div>
      {selectedSession !== undefined && activeStatus !== null && (
        <div className={styles.statusLine}>
          {activeStatus.openState === 'open'
            ? `${boundaries.length} durable boundaries loaded${activeWindow?.hasMore ? ' · older history available' : ''}`
            : `Session history ${activeStatus.openState}`}
        </div>
      )}
      {activeWindow?.hasMore && (
        <button
          type="button"
          className={styles.secondary}
          disabled={activeReference === null || loadingOlderSessionId === selectedSessionId}
          onClick={() => void loadOlder()}
        >
          {loadingOlderSessionId === selectedSessionId ? 'Loading older history…' : 'Load older boundaries'}
        </button>
      )}
      {activeError !== null && (
        <p className={styles.sessionToolError} role="alert">
          {activeError}
        </p>
      )}
      {forkError !== null && (
        <p className={styles.sessionToolError} role="alert">
          {forkError}
        </p>
      )}
      {forkedSessionId !== null && <p className={styles.statusLine}>Fork created and opened: {forkedSessionId}</p>}
      <p className={styles.muted}>
        The Host balances a cut inside an open turn. The fork keeps its source history lineage; choosing it grants no added authority over parent or sibling
        Sessions.
      </p>
    </section>
  )
}

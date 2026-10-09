import type { ISessions, SessionEventWindow, SessionReference, SessionSnapshot, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { durableForkBoundaries } from './fork-boundaries.js'

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
  const loadOlderMutation = useMutation({ mutationFn: (reference: SessionReference) => reference.binding.session.loadOlder() })
  const forkMutation = useMutation({
    mutationFn: (variables: { readonly sessionId: SessionSummary['id']; readonly atSeq: number }) => props.sessions.fork(variables),
    onSuccess: childId => props.openSession(childId),
  })

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
  const loadOlderFailed = loadOlderMutation.isError && loadOlderMutation.variables.sessionId === selectedSessionId
  const activeError =
    historyError !== null && historyError.sessionId === selectedSessionId
      ? historyError.message
      : loadOlderFailed
        ? errorMessage(loadOlderMutation.error, 'Could not load older Session history.')
        : null
  const loadingOlderSessionId = loadOlderMutation.isPending ? loadOlderMutation.variables.sessionId : null
  const forkingSessionId = forkMutation.isPending ? forkMutation.variables.sessionId : null
  const forkError = forkMutation.isError ? errorMessage(forkMutation.error, 'Could not fork this Session boundary.') : null
  const forkedSessionId = forkMutation.data ?? null
  const boundaries = useMemo(() => durableForkBoundaries(activeWindow?.entries ?? []), [activeWindow?.entries])
  const selectedBoundarySeq =
    selectedBoundary !== null && selectedBoundary.sessionId === selectedSessionId && boundaries.some(boundary => boundary.seq === selectedBoundary.seq)
      ? selectedBoundary.seq
      : boundaries.at(-1)?.seq
  const selectedSession = selectedSessionId === '' ? undefined : sessionList.byId[selectedSessionId]

  const loadOlder = (): void => {
    if (activeReference !== null) loadOlderMutation.mutate(activeReference)
  }

  const forkAtBoundary = (): void => {
    if (selectedSessionId === '' || selectedBoundarySeq === undefined) return
    forkMutation.mutate({ sessionId: selectedSessionId, atSeq: selectedBoundarySeq })
  }

  return (
    <Card aria-labelledby="jj-session-fork-title" className="dshx:gap-3" role="region">
      <CardHeader>
        <CardTitle className="dshx:text-sm" id="jj-session-fork-title">
          Fork a Session at a history boundary
        </CardTitle>
        <CardDescription className="dshx:text-xs">
          Choose a listed Session and a durable event sequence. Message contents and transient stream chunks stay out of this history control.
        </CardDescription>
      </CardHeader>
      <CardContent className="dshx:flex dshx:flex-col dshx:gap-2.5">
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label className="dshx:text-xs dshx:text-muted-foreground">Session</Label>
          <Select onValueChange={value => setSelectedSessionId(sessionList.ids.find(id => id === value) ?? '')} value={selectedSessionId}>
            <SelectTrigger aria-label="Session to fork" className="dshx:w-full dshx:text-xs" size="sm">
              <SelectValue placeholder="Choose a Session" />
            </SelectTrigger>
            <SelectContent>
              {sessionList.ids.map(id => {
                const summary = sessionList.byId[id]
                return summary === undefined ? null : (
                  <SelectItem key={summary.id} value={summary.id}>
                    {summary.displayTitle} — {summary.cwd ?? 'no working directory'}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label className="dshx:text-xs dshx:text-muted-foreground">Durable boundary</Label>
          <Select
            disabled={boundaries.length === 0}
            onValueChange={value => {
              const next = boundaries.find(boundary => String(boundary.seq) === value)
              if (next !== undefined && selectedSessionId !== '') setSelectedBoundary({ sessionId: selectedSessionId, seq: next.seq })
            }}
            value={selectedBoundarySeq === undefined ? '' : String(selectedBoundarySeq)}
          >
            <SelectTrigger aria-label="Fork boundary sequence" className="dshx:w-full dshx:font-mono! dshx:text-xs" size="sm">
              <SelectValue placeholder="No loaded durable events" />
            </SelectTrigger>
            <SelectContent>
              {boundaries.map(boundary => (
                <SelectItem className="dshx:font-mono dshx:text-xs" key={boundary.seq} value={String(boundary.seq)}>
                  {boundary.seq} · {boundary.eventType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedSession !== undefined && activeStatus !== null && (
          <p className="dshx:text-xs dshx:text-muted-foreground">
            {activeStatus.openState === 'open'
              ? `${boundaries.length} durable boundaries loaded${activeWindow?.hasMore ? ' · older history available' : ''}`
              : `Session history ${activeStatus.openState}`}
          </p>
        )}
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5">
          <Button
            disabled={selectedSessionId === '' || selectedBoundarySeq === undefined || forkingSessionId !== null}
            onClick={forkAtBoundary}
            size="sm"
            type="button"
          >
            {forkingSessionId === selectedSessionId ? 'Forking…' : 'Fork and open'}
          </Button>
          {activeWindow?.hasMore && (
            <Button
              disabled={activeReference === null || loadingOlderSessionId === selectedSessionId}
              onClick={loadOlder}
              size="sm"
              type="button"
              variant="outline"
            >
              {loadingOlderSessionId === selectedSessionId ? 'Loading older history…' : 'Load older boundaries'}
            </Button>
          )}
        </div>
        {[activeError, forkError].map(
          message =>
            message !== null && (
              <Alert className="dshx:px-3 dshx:py-2" key={message} role="alert" variant="destructive">
                <AlertDescription className="dshx:text-xs">{message}</AlertDescription>
              </Alert>
            ),
        )}
        {forkedSessionId !== null && <p className="dshx:text-xs dshx:text-muted-foreground">Fork created and opened: {forkedSessionId}</p>}
        <p className="dshx:text-xs dshx:text-muted-foreground">
          The Host balances a cut inside an open turn. The fork keeps its source history lineage; choosing it grants no added authority over parent or sibling
          Sessions.
        </p>
      </CardContent>
    </Card>
  )
}

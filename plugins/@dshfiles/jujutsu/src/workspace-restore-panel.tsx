import type { ISessions, SessionSummary, SessionWorkspaceRestorePreview, SessionWorkspaceRestoreReceipt } from '@deepseek-ai/dsh-api-session-controller/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

interface WorkspaceRestorePanelProps {
  readonly sessions: ISessions
  readonly workspacePath: string
  readonly targetCommitId: string | null
  readonly onRestored: () => void
}

type RestoreAction = SessionWorkspaceRestorePreview['action']

export const WorkspaceRestorePanel = (props: WorkspaceRestorePanelProps): JSX.Element => {
  const [selectedSessionId, setSelectedSessionId] = useState<SessionSummary['id'] | ''>('')
  const [preview, setPreview] = useState<SessionWorkspaceRestorePreview | null>(null)
  const [receipt, setReceipt] = useState<SessionWorkspaceRestoreReceipt | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const operation = useRef<{ readonly controller: AbortController } | null>(null)

  const subscribeSessions = useCallback((listener: () => void) => props.sessions.list.subscribe(listener), [props.sessions])
  const readSessions = useCallback(() => props.sessions.list.getSnapshot(), [props.sessions])
  const sessionList = useSyncExternalStore(subscribeSessions, readSessions, readSessions)
  const selectedSession = selectedSessionId === '' ? undefined : sessionList.byId[selectedSessionId]

  useEffect(() => {
    if (sessionList.phase === 'pending') void props.sessions.refresh()
  }, [props.sessions, sessionList.phase])

  useEffect(() => {
    operation.current?.controller.abort()
    operation.current = null
    setBusy(false)
    setPreview(null)
    setReceipt(null)
    setError(null)
    return () => operation.current?.controller.abort()
  }, [props.targetCommitId, props.workspacePath, selectedSessionId])

  const prepare = async (action: RestoreAction): Promise<void> => {
    if (selectedSessionId === '') return
    if (action === 'restore' && props.targetCommitId === null) return
    operation.current?.controller.abort()
    const currentOperation = { controller: new AbortController() }
    operation.current = currentOperation
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const result = await props.sessions.prepareWorkspaceRestore(
        {
          sessionId: selectedSessionId,
          action,
          ...(action === 'restore' ? { targetCommitId: props.targetCommitId ?? undefined } : {}),
        },
        currentOperation.controller.signal,
      )
      if (operation.current !== currentOperation) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      if (result.value.workspacePath !== props.workspacePath) {
        setError(`The selected Session belongs to ${result.value.workspacePath}; this repository is ${props.workspacePath}.`)
        return
      }
      setReceipt(null)
      setPreview(result.value)
    } catch (reason) {
      if (operation.current === currentOperation) {
        setError(reason instanceof Error ? reason.message : 'Could not prepare the filesystem restore.')
      }
    } finally {
      if (operation.current === currentOperation) {
        operation.current = null
        setBusy(false)
      }
    }
  }

  const confirm = async (): Promise<void> => {
    if (preview === null) return
    operation.current?.controller.abort()
    const currentOperation = { controller: new AbortController() }
    operation.current = currentOperation
    setBusy(true)
    setError(null)
    try {
      const result = await props.sessions.confirmWorkspaceRestore({ previewId: preview.previewId }, currentOperation.controller.signal)
      if (operation.current !== currentOperation) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setReceipt(result.value)
      setPreview(null)
      props.onRestored()
    } catch (reason) {
      if (operation.current === currentOperation) {
        setError(reason instanceof Error ? reason.message : 'Could not confirm the filesystem restore.')
      }
    } finally {
      if (operation.current === currentOperation) {
        operation.current = null
        setBusy(false)
      }
    }
  }

  const inspectStatus = async (): Promise<void> => {
    if (selectedSessionId === '') return
    operation.current?.controller.abort()
    const currentOperation = { controller: new AbortController() }
    operation.current = currentOperation
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const result = await props.sessions.workspaceRestoreStatus({ sessionId: selectedSessionId }, currentOperation.controller.signal)
      if (operation.current !== currentOperation) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setReceipt(result.value)
      if (result.value !== null) props.onRestored()
    } catch (reason) {
      if (operation.current === currentOperation) {
        setError(reason instanceof Error ? reason.message : 'Could not inspect the latest filesystem restore.')
      }
    } finally {
      if (operation.current === currentOperation) {
        operation.current = null
        setBusy(false)
      }
    }
  }

  const chooseSession = (value: string): void => {
    operation.current?.controller.abort()
    operation.current = null
    setBusy(false)
    setSelectedSessionId(sessionList.ids.find(sessionId => sessionId === value) ?? '')
  }

  const changedPathList =
    preview === null ? null : (
      <ul className="dshx:max-h-48 dshx:overflow-auto dshx:rounded-md dshx:border dshx:bg-muted/40 dshx:p-2 dshx:font-mono dshx:text-[11px] dshx:leading-snug">
        {preview.changedPaths.map(changedPath => (
          <li className="dshx:flex dshx:gap-2" key={`${changedPath.status}:${changedPath.path}`}>
            <span className="dshx:w-16 dshx:flex-none dshx:text-muted-foreground">{changedPath.status}</span>
            <span className="dshx:min-w-0 dshx:truncate" title={changedPath.path}>
              {changedPath.path}
            </span>
          </li>
        ))}
      </ul>
    )

  return (
    <Card aria-labelledby="jj-workspace-restore-title" className="dshx:gap-3" role="region">
      <CardHeader>
        <CardTitle className="dshx:text-sm" id="jj-workspace-restore-title">
          Restore workspace files to a revision
        </CardTitle>
        <CardDescription className="dshx:text-xs">
          This changes files in the selected JJ workspace. It does not change conversation history. Review the exact path preview before confirming.
        </CardDescription>
      </CardHeader>
      <CardContent className="dshx:flex dshx:flex-col dshx:gap-2.5">
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label className="dshx:text-xs dshx:text-muted-foreground">Session in this workspace</Label>
          <Select onValueChange={chooseSession} value={selectedSessionId}>
            <SelectTrigger aria-label="Session for filesystem restore" className="dshx:w-full dshx:text-xs" size="sm">
              <SelectValue placeholder="Choose a Session" />
            </SelectTrigger>
            <SelectContent>
              {sessionList.ids.map(sessionId => {
                const summary = sessionList.byId[sessionId]
                return summary === undefined ? null : (
                  <SelectItem key={summary.id} value={summary.id}>
                    {summary.displayTitle} — {summary.cwd ?? 'no working directory'}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <span className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground" title={props.workspacePath}>
            {props.workspacePath}
          </span>
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
          <Button
            disabled={selectedSessionId === '' || props.targetCommitId === null || busy}
            onClick={() => void prepare('restore')}
            size="sm"
            type="button"
            variant="outline"
          >
            Preview file restore
          </Button>
          <Button disabled={selectedSessionId === '' || busy} onClick={() => void inspectStatus()} size="sm" type="button" variant="ghost">
            Inspect latest restore status
          </Button>
        </div>
        {selectedSession !== undefined && <p className="dshx:text-xs dshx:text-muted-foreground">Selected: {selectedSession.displayTitle}</p>}
        {error !== null && (
          <Alert className="dshx:px-3 dshx:py-2" role="alert" variant="destructive">
            <AlertDescription className="dshx:text-xs">{error}</AlertDescription>
          </Alert>
        )}
        {receipt !== null && (
          <Alert className="dshx:px-3 dshx:py-2" role="status" variant={receipt.state === 'uncertain' ? 'warning' : 'info'}>
            <AlertDescription className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:text-xs">
              <span className="dshx:text-foreground">
                Restore <span className="dshx:font-mono">{receipt.operationId}</span>: {receipt.state}
                {receipt.failure === undefined ? '' : ` · ${receipt.failure}`}
              </span>
              {receipt.state === 'uncertain' && <span>Outcome is uncertain; inspect status again after the Host can verify the JJ process has stopped.</span>}
              {(receipt.canRetry || receipt.canRollback) && (
                <span className="dshx:flex dshx:gap-1.5">
                  {receipt.canRetry && (
                    <Button disabled={busy} onClick={() => void prepare('retry')} size="xs" type="button" variant="outline">
                      Preview retry
                    </Button>
                  )}
                  {receipt.canRollback && (
                    <Button disabled={busy} onClick={() => void prepare('rollback')} size="xs" type="button" variant="outline">
                      Preview rollback
                    </Button>
                  )}
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}
        {busy && (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground" role="status">
            <Spinner className="dshx:size-3" />
            Checking workspace state…
          </p>
        )}
        {preview !== null && preview.changedPathsTruncated && (
          <Alert className="dshx:px-3 dshx:py-2" role="alert" variant="destructive">
            <AlertDescription className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-1.5 dshx:text-xs">
              <p>The path list is truncated. The Host will not apply a restore unless every changed path is shown.</p>
              <p>Inspect the complete diff from this workspace:</p>
              <code className="dshx:w-full dshx:rounded-sm dshx:bg-muted dshx:px-1.5 dshx:py-1 dshx:font-mono dshx:text-[11px] dshx:break-all dshx:text-foreground">
                jj diff --from {preview.currentCommitId} --to {preview.targetCommitId}
              </code>
              <div className="dshx:w-full dshx:text-foreground">{changedPathList}</div>
              <Button onClick={() => setPreview(null)} size="xs" type="button" variant="outline">
                Close path preview
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <AlertDialog
          onOpenChange={open => {
            if (!open) setPreview(null)
          }}
          open={preview !== null && !preview.changedPathsTruncated}
        >
          {preview !== null && !preview.changedPathsTruncated && (
            <AlertDialogContent className="dshx-root">
              <AlertDialogHeader className="dshx:place-items-start dshx:text-left">
                <AlertDialogTitle className="dshx:text-base">Confirm filesystem restore</AlertDialogTitle>
                <AlertDialogDescription className="dshx:font-mono dshx:text-xs dshx:text-foreground">
                  {preview.action}: {preview.currentCommitId.slice(0, 12)} → {preview.targetCommitId.slice(0, 12)}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
                <p>
                  Workspace: <span className="dshx:font-mono">{preview.workspacePath}</span>
                </p>
                <p>Conversation history remains unchanged. An interrupted JJ restore may need explicit recovery.</p>
              </div>
              {preview.changedPaths.length === 0 ? (
                <p className="dshx:text-xs dshx:text-muted-foreground">This restore has no tracked file changes.</p>
              ) : (
                changedPathList
              )}
              <AlertDialogFooter>
                <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  onClick={event => {
                    event.preventDefault()
                    void confirm()
                  }}
                  size="sm"
                >
                  Confirm file restore
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

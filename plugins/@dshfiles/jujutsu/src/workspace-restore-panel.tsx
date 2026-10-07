import type {
  ISessions,
  SessionSummary,
  SessionWorkspaceRestorePreview,
  SessionWorkspaceRestoreReceipt,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { ConfirmDialog } from '@dshfiles/plugin-ui'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import styles from './jujutsu.module.css'

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
      const result = await props.sessions.prepareWorkspaceRestore({
        sessionId: selectedSessionId,
        action,
        ...(action === 'restore' ? { targetCommitId: props.targetCommitId ?? undefined } : {}),
      }, currentOperation.controller.signal)
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
      const result = await props.sessions.confirmWorkspaceRestore(
        { previewId: preview.previewId },
        currentOperation.controller.signal,
      )
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
      const result = await props.sessions.workspaceRestoreStatus(
        { sessionId: selectedSessionId },
        currentOperation.controller.signal,
      )
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

  return (
    <section className={styles.sessionTools} aria-labelledby="jj-workspace-restore-title">
      <h2 id="jj-workspace-restore-title">Restore workspace files to a revision</h2>
      <p className={styles.muted}>
        This changes files in the selected JJ workspace. It does not change conversation history. Review the exact path preview before confirming.
      </p>
      <div className={styles.sessionToolGrid}>
        <label>
          Session in this workspace
          <select aria-label="Session for filesystem restore" value={selectedSessionId} onChange={event => chooseSession(event.target.value)}>
            <option value="">Choose a Session</option>
            {sessionList.ids.map(sessionId => {
              const summary = sessionList.byId[sessionId]
              return summary === undefined ? null : (
                <option key={summary.id} value={summary.id}>
                  {summary.displayTitle} — {summary.cwd ?? 'no working directory'}
                </option>
              )
            })}
          </select>
        </label>
        <span className={styles.sessionPath} title={props.workspacePath}>{props.workspacePath}</span>
        <button
          className={styles.secondary}
          disabled={selectedSessionId === '' || props.targetCommitId === null || busy}
          onClick={() => void prepare('restore')}
          type="button"
        >
          Preview file restore
        </button>
        <button
          className={styles.secondary}
          disabled={selectedSessionId === '' || busy}
          onClick={() => void inspectStatus()}
          type="button"
        >
          Inspect latest restore status
        </button>
      </div>
      {selectedSession !== undefined && <p className={styles.muted}>Selected: {selectedSession.displayTitle}</p>}
      {error !== null && <p className={styles.sessionToolError} role="alert">{error}</p>}
      {receipt !== null && (
        <div className={styles.sessionToolAction} role="status">
          <span>
            Restore {receipt.operationId}: {receipt.state}
            {receipt.failure === undefined ? '' : ` · ${receipt.failure}`}
          </span>
          {receipt.canRetry && (
            <button className={styles.secondary} disabled={busy} onClick={() => void prepare('retry')} type="button">
              Preview retry
            </button>
          )}
          {receipt.canRollback && (
            <button className={styles.secondary} disabled={busy} onClick={() => void prepare('rollback')} type="button">
              Preview rollback
            </button>
          )}
          {receipt.state === 'uncertain' && <span>Outcome is uncertain; inspect status again after the Host can verify the JJ process has stopped.</span>}
        </div>
      )}
      {busy && <p className={styles.muted} role="status">Checking workspace state…</p>}
      {preview !== null && (
        <ConfirmDialog
          busy={busy}
          cancelLabel="Cancel"
          closeLabel="Close"
          confirmLabel="Confirm file restore"
          onCancel={() => setPreview(null)}
          onConfirm={() => void confirm()}
          open
          title="Confirm filesystem restore"
        >
          <strong className={styles.previewSummary}>
            {preview.action}: {preview.currentCommitId.slice(0, 12)} → {preview.targetCommitId.slice(0, 12)}
          </strong>
          <p className={styles.muted}>Workspace: {preview.workspacePath}</p>
          <p className={styles.muted}>Conversation history remains unchanged. An interrupted JJ restore may need explicit recovery.</p>
          <ul className={styles.previewDetail}>
            {preview.changedPaths.map(changedPath => (
              <li key={`${changedPath.status}:${changedPath.path}`}>{changedPath.status} · {changedPath.path}</li>
            ))}
          </ul>
          {preview.changedPathsTruncated && <p className={styles.muted}>Path list is truncated; inspect the complete JJ diff before confirming.</p>}
        </ConfirmDialog>
      )}
    </section>
  )
}

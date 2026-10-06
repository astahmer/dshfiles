import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { projectChecksApi, type ProjectActionView, type ProjectCheckReceipt, type ProjectHookEvent } from './api.js'
import styles from './project-checks.module.css'

type Listener = () => void

class SessionPanel {
  private isOpen = false
  private readonly listeners = new Set<Listener>()

  readonly getSnapshot = (): boolean => this.isOpen

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  open(): void {
    if (this.isOpen) return
    this.isOpen = true
    for (const listener of this.listeners) listener()
  }

  close(): void {
    if (!this.isOpen) return
    this.isOpen = false
    for (const listener of this.listeners) listener()
  }
}

class SessionPanels {
  private readonly panels = new Map<string, SessionPanel>()

  forSession(sessionId: string): SessionPanel {
    let panel = this.panels.get(sessionId)
    if (panel === undefined) {
      panel = new SessionPanel()
      this.panels.set(sessionId, panel)
    }
    return panel
  }

  open(sessionId: string): void {
    this.forSession(sessionId).open()
  }
}

export default defineClient({
  name: '@dshfiles/project-checks',
  inject: ['commandUi', 'slots'],
  setup(ctx, decorate) {
    const panels = new SessionPanels()
    ctx.slots.inject('conversation.input.overlay', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.overlay',
          id: 'project-checks-panel',
          order: 4,
          inject: sessionId => ({ sessionId, panel: panels.forSession(sessionId) }),
        },
        decorate(ProjectChecksPanel),
      ),
    )
    ctx.effect(
      () =>
        ctx.commandUi.register({
          name: 'project-checks',
          label: () => 'Project checks',
          description: () => 'Run trusted project actions and inspect check and hook receipts.',
          available: () => true,
          ui: {
            kind: 'action',
            run: session => panels.open(session.sessionId),
          },
        }),
      'Project checks composer command',
    )
  },
})

const formatTime = (timestamp: number): string => new Date(timestamp).toLocaleTimeString()

const freshnessLabel = (receipt: ProjectCheckReceipt): string => {
  if (receipt.freshness === 'stale') return 'Stale: working copy changed after this check.'
  if (receipt.freshness === 'unknown') return 'Working-copy revision could not be checked.'
  return receipt.sourceRevision === null ? 'Revision not recorded.' : `Working copy ${receipt.sourceRevision.slice(0, 12)}`
}

function ProjectChecksPanel(props: { readonly sessionId: string; readonly panel: SessionPanel }): JSX.Element | null {
  const api = useApi(projectChecksApi)
  const open = useSyncExternalStore(props.panel.subscribe, props.panel.getSnapshot)
  const [actions, setActions] = useState<readonly ProjectActionView[]>([])
  const [receipts, setReceipts] = useState<readonly ProjectCheckReceipt[]>([])
  const [hooks, setHooks] = useState<readonly ProjectHookEvent[]>([])
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)

  const refresh = useCallback(async () => {
    setNotice('')
    try {
      const [nextActions, nextReceipts, nextHooks] = await Promise.all([
        api.actions({ sessionId: props.sessionId }),
        api.receipts({ sessionId: props.sessionId }),
        api.hookEvents({ sessionId: props.sessionId }),
      ])
      setActions(nextActions)
      setReceipts(nextReceipts)
      setHooks(nextHooks)
    } catch {
      setNotice('Project checks could not load this session. Refresh and try again.')
    }
  }, [api, props.sessionId])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh, reload])

  const run = async (action: ProjectActionView): Promise<void> => {
    setBusyAction(action.id)
    setNotice('')
    try {
      const receipt = await api.run({ sessionId: props.sessionId, actionId: action.id })
      setReceipts(current => [receipt, ...current.filter(item => item.id !== receipt.id)].slice(0, 30))
      await refresh()
    } catch {
      setNotice('The action did not start. Confirm the session directory and trusted project root.')
    } finally {
      setBusyAction(null)
    }
  }

  if (!open) return null

  return (
    <section className={styles.panel} role="dialog" aria-label="Project checks">
      <header className={styles.header}>
        <div>
          <h2>Project checks</h2>
          <p>Profile-trusted commands run with argv in this session’s project directory.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" onClick={() => setReload(value => value + 1)} aria-label="Refresh project checks">
            Refresh
          </button>
          <button type="button" onClick={() => props.panel.close()} aria-label="Close project checks">
            Close
          </button>
        </div>
      </header>

      {notice.length > 0 && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <section className={styles.section} aria-labelledby="project-action-title">
        <h3 id="project-action-title">Actions</h3>
        {actions.length === 0 ? <p className={styles.empty}>No trusted actions are configured for this session directory.</p> : null}
        <ul className={styles.actionList}>
          {actions.map(action => (
            <li className={styles.action} key={action.id}>
              <div className={styles.actionCopy}>
                <strong>{action.label}</strong>
                <span>
                  {action.description || (action.verifyBeforeComplete ? 'Runs before the agent completes a turn.' : 'One-shot trusted project action.')}
                </span>
              </div>
              <button type="button" disabled={busyAction !== null} onClick={() => void run(action)}>
                {busyAction === action.id ? 'Running…' : 'Run'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="project-receipts-title">
        <h3 id="project-receipts-title">Recent check receipts</h3>
        {receipts.length === 0 ? <p className={styles.empty}>No checks have run in this session.</p> : null}
        <ul className={styles.receiptList}>
          {receipts.map(receipt => (
            <li className={styles.receipt} key={receipt.id}>
              <div className={styles.receiptHeading}>
                <strong>{receipt.label}</strong>
                <span data-status={receipt.status}>{receipt.status}</span>
              </div>
              <span>
                {formatTime(receipt.finishedAt)} · {receipt.durationMs} ms{receipt.exitCode === null ? '' : ` · exit ${receipt.exitCode}`}
              </span>
              <span>{freshnessLabel(receipt)}</span>
              {receipt.failure !== null ? <span>Runner state: {receipt.failure}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="project-hooks-title">
        <h3 id="project-hooks-title">Native hook results</h3>
        <p className={styles.note}>
          The Host records hooks that ran. It has no durable skipped-hook event, so skipped and unsupported hooks cannot be attributed here.
        </p>
        {hooks.length === 0 ? <p className={styles.empty}>No native hook records are available for this session.</p> : null}
        <ul className={styles.hookList}>
          {hooks.map(event => (
            <li className={styles.hook} key={`${event.seq}-${event.kind}`}>
              <strong>{event.point}</strong>
              <span>
                Turn {event.turn} · {event.kind}
                {event.dialect === null ? '' : ` · ${event.dialect}`}
              </span>
              {event.kind === 'result' ? (
                <span>
                  {event.decision ?? 'no decision'} · exit {event.exitCode ?? 'unknown'} · {event.durationMs ?? 0} ms
                  {event.stderrPresent ? ' · stderr summary present' : ''}
                </span>
              ) : null}
              <time dateTime={new Date(event.time).toISOString()}>{formatTime(event.time)}</time>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}

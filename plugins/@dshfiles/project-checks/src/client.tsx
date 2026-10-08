import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { projectChecksApi, type ProjectActionView, type ProjectCheckReceipt, type ProjectHookEvent } from './api.js'
import { PlayIcon, RefreshCwIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@dshfiles/plugin-ui/components/ui/item'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import './client.css'

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

const receiptBadgeVariant = (status: ProjectCheckReceipt['status']): 'success' | 'destructive' | 'warning' | 'muted' => {
  if (status === 'passed') return 'success'
  if (status === 'failed') return 'destructive'
  if (status === 'timed-out') return 'warning'
  return 'muted'
}

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
    <Card
      className="dshx-root dshx:absolute dshx:inset-x-0 dshx:bottom-[calc(100%+8px)] dshx:z-40 dshx:max-h-[min(72vh,680px)] dshx:w-[min(620px,calc(100vw-24px))] dshx:gap-0 dshx:overflow-y-auto dshx:py-0 dshx:shadow-lg"
      role="dialog"
      aria-label="Project checks"
    >
      <CardHeader className="dshx:gap-1 dshx:border-b dshx:px-4 dshx:py-3 dshx:[.border-b]:pb-3">
        <CardTitle className="dshx:text-sm">
          <h2>Project checks</h2>
        </CardTitle>
        <CardDescription className="dshx:text-xs">Profile-trusted commands run with argv in this session’s project directory.</CardDescription>
        <CardAction className="dshx:flex dshx:items-center dshx:gap-1">
          <Button type="button" variant="ghost" size="xs" onClick={() => setReload(value => value + 1)} aria-label="Refresh project checks">
            <RefreshCwIcon />
            Refresh
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => props.panel.close()} aria-label="Close project checks">
            <XIcon />
            Close
          </Button>
        </CardAction>
      </CardHeader>

      {notice.length > 0 && (
        <p className="dshx:mx-4 dshx:mt-3 dshx:rounded-md dshx:bg-destructive/10 dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-destructive" role="status">
          {notice}
        </p>
      )}

      <section className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:px-4 dshx:pt-3" aria-labelledby="project-action-title">
        <h3 id="project-action-title" className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">
          Actions
        </h3>
        {actions.length === 0 ? <p className="dshx:py-2 dshx:text-xs dshx:text-muted-foreground">No trusted actions are configured for this session directory.</p> : null}
        <ItemGroup className="dshx:gap-1">
          {actions.map(action => (
            <Item role="listitem" variant="outline" size="sm" className="dshx:gap-3 dshx:px-3 dshx:py-2" key={action.id}>
              <ItemContent className="dshx:min-w-0 dshx:gap-0.5">
                <ItemTitle className="dshx:gap-1.5">
                  {action.label}
                  {action.verifyBeforeComplete ? <Badge variant="info">verify</Badge> : null}
                </ItemTitle>
                <ItemDescription className="dshx:line-clamp-1 dshx:text-xs">
                  {action.description || (action.verifyBeforeComplete ? 'Runs before the agent completes a turn.' : 'One-shot trusted project action.')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button type="button" variant="outline" size="xs" disabled={busyAction !== null} onClick={() => void run(action)}>
                  {busyAction === action.id ? <Spinner aria-hidden /> : <PlayIcon />}
                  {busyAction === action.id ? 'Running…' : 'Run'}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </section>

      <section className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:px-4 dshx:pt-4" aria-labelledby="project-receipts-title">
        <h3 id="project-receipts-title" className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">
          Recent check receipts
        </h3>
        {receipts.length === 0 ? <p className="dshx:py-2 dshx:text-xs dshx:text-muted-foreground">No checks have run in this session.</p> : null}
        <ItemGroup className="dshx:divide-y dshx:rounded-md dshx:border">
          {receipts.map(receipt => (
            <Item role="listitem" size="sm" className="dshx:gap-3 dshx:rounded-none dshx:px-3 dshx:py-2" key={receipt.id}>
              <ItemContent className="dshx:min-w-0 dshx:gap-0.5">
                <ItemTitle>{receipt.label}</ItemTitle>
                <ItemDescription className="dshx:line-clamp-none dshx:font-mono dshx:text-xs">
                  {formatTime(receipt.finishedAt)} · {receipt.durationMs} ms{receipt.exitCode === null ? '' : ` · exit ${receipt.exitCode}`}
                </ItemDescription>
                <ItemDescription className={receipt.freshness === 'stale' ? 'dshx:text-xs dshx:text-warning' : 'dshx:text-xs'}>{freshnessLabel(receipt)}</ItemDescription>
                {receipt.failure !== null ? <ItemDescription className="dshx:text-xs dshx:text-destructive">Runner state: {receipt.failure}</ItemDescription> : null}
              </ItemContent>
              <ItemActions className="dshx:self-start">
                <Badge variant={receiptBadgeVariant(receipt.status)} data-status={receipt.status}>
                  {receipt.status}
                </Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </section>

      <section className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:px-4 dshx:pt-4 dshx:pb-4" aria-labelledby="project-hooks-title">
        <h3 id="project-hooks-title" className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">
          Native hook results
        </h3>
        <p className="dshx:text-xs dshx:text-muted-foreground">
          The Host records hooks that ran. It has no durable skipped-hook event, so skipped and unsupported hooks cannot be attributed here.
        </p>
        {hooks.length === 0 ? <p className="dshx:py-2 dshx:text-xs dshx:text-muted-foreground">No native hook records are available for this session.</p> : null}
        <ItemGroup className="dshx:divide-y dshx:rounded-md dshx:border dshx:empty:hidden">
          {hooks.map(event => (
            <Item role="listitem" size="sm" className="dshx:gap-3 dshx:rounded-none dshx:px-3 dshx:py-2" key={`${event.seq}-${event.kind}`}>
              <ItemContent className="dshx:min-w-0 dshx:gap-0.5">
                <ItemTitle className="dshx:font-mono dshx:text-xs">{event.point}</ItemTitle>
                <ItemDescription className="dshx:text-xs">
                  Turn {event.turn}
                  {event.dialect === null ? '' : ` · ${event.dialect}`}
                </ItemDescription>
                {event.kind === 'result' ? (
                  <ItemDescription className="dshx:line-clamp-none dshx:font-mono dshx:text-xs">
                    {event.decision ?? 'no decision'} · exit {event.exitCode ?? 'unknown'} · {event.durationMs ?? 0} ms
                    {event.stderrPresent ? ' · stderr summary present' : ''}
                  </ItemDescription>
                ) : null}
              </ItemContent>
              <ItemActions className="dshx:flex-col dshx:items-end dshx:gap-1 dshx:self-start">
                <Badge variant={event.kind === 'result' ? 'secondary' : 'muted'}>{event.kind}</Badge>
                <time className="dshx:text-xs dshx:text-muted-foreground" dateTime={new Date(event.time).toISOString()}>
                  {formatTime(event.time)}
                </time>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </section>
    </Card>
  )
}

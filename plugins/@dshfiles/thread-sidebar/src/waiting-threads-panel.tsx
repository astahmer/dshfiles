import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState, Page } from '@dshfiles/plugin-ui/components/page'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { useMemo, useState } from 'react'
import { useInboxThreadSignals } from './inbox-signals.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { formatAge } from './relative-age.js'
import type { InboxThreadSignal } from './thread-status.js'
import { WAITING_THREAD_TABS, WaitingThreads, type WaitingThreadTab } from './waiting-threads.js'

const statusOf = (severity: InboxThreadSignal['severity']): WorkStatus => (severity === 'blocking' ? 'needs-you' : severity)

/**
 * Inbox › Waiting threads: one row per thread whose newest open inbox item asks something of the user. The Inbox page
 * lists items, mixed with backlog and host work; this page answers "which threads are waiting on me" and opens them.
 */
export const WaitingThreadsPanel = (props: {
  readonly t: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
  readonly sessions: ISessions
  readonly openThread: (sessionId: string) => void
}): JSX.Element => {
  const t = props.t
  const [tab, setTab] = useState<WaitingThreadTab>('needs-you')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ readonly tone: 'ok' | 'error'; readonly text: string } | null>(null)
  const inbox = useInboxThreadSignals({ enabled: true })
  const sessionLabel = EntityLabels.useSessionLabel(props.sessions)
  const rows = useMemo(() => WaitingThreads.rows(inbox.signals), [inbox.signals])
  const counts = WaitingThreads.countsOf(rows)
  const visible = WaitingThreads.inTab(rows, tab)
  const labels = { 'needs-you': t('waitingThreadsNeedsYou'), review: t('waitingThreadsReady') } satisfies Record<WaitingThreadTab, string>
  const severityLabels = { blocking: t('waitingThreadsNeedsYou'), failed: t('waitingThreadsFailed'), ready: t('waitingThreadsReady') } as const
  const settle = async (run: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      await run()
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error, t('waitingThreadsActionFailed')) })
    } finally {
      setBusy(false)
    }
  }
  const act = (itemId: string, verb: NonNullable<InboxThreadSignal['verb']>): void => {
    void settle(async () => {
      const outcome = await inbox.act(itemId, verb)
      if (!outcome.ok) setNotice({ tone: 'error', text: outcome.message })
    })
  }
  return (
    <Page
      scroll
      heading={t('waitingThreadsTitle')}
      description={t('waitingThreadsDescription')}
      className="dshx:mx-auto dshx:w-full dshx:max-w-3xl"
      tabs={{
        label: t('waitingThreadsTitle'),
        value: tab,
        onValueChange: value => setTab(WAITING_THREAD_TABS.find(candidate => candidate === value) ?? 'needs-you'),
        items: WAITING_THREAD_TABS.map(candidate => ({
          value: candidate,
          label: labels[candidate],
          ...(counts[candidate] > 0 && { count: counts[candidate] }),
        })),
      }}
    >
      {notice === null ? null : (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={notice.tone === 'error' ? 'dshx:text-sm dshx:text-destructive' : 'dshx:text-sm dshx:text-muted-foreground'}
        >
          {notice.text}
        </p>
      )}
      {inbox.loaded && visible.length === 0 ? (
        <EmptyState>{tab === 'needs-you' ? t('waitingThreadsEmptyNeedsYou') : t('waitingThreadsEmptyReview')}</EmptyState>
      ) : null}
      {visible.length === 0 ? null : (
        <EntityList aria-label={labels[tab]}>
          {visible.map(({ sessionId, signal }) => {
            const verb = signal.verb
            return (
              <EntityRow
                key={sessionId}
                role="listitem"
                data-waiting-thread={sessionId}
                status={statusOf(signal.severity)}
                statusLabel={severityLabels[signal.severity]}
                heading={sessionLabel(sessionId)}
                description={signal.reason}
                meta={<span>{formatAge(signal.openedAt)}</span>}
              >
                <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:px-3 dshx:pb-2 dshx:pl-9">
                  <Button size="sm" onClick={() => props.openThread(sessionId)}>
                    {t('waitingThreadsOpen')}
                  </Button>
                  {verb === undefined ? null : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => act(signal.itemId, verb)}>
                      {verb}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void settle(async () => {
                        await inbox.done(signal.itemId)
                      })
                    }
                  >
                    {t('waitingThreadsDone')}
                  </Button>
                </div>
              </EntityRow>
            )
          })}
        </EntityList>
      )}
    </Page>
  )
}

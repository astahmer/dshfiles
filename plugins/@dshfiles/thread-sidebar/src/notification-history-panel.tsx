import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { useApi } from '@dshfiles/dshx/client'
import { EmptyState, Page } from '@dshfiles/plugin-ui/components/page'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StatusGlyphState } from '@dshfiles/plugin-ui/components/work-status'
import { CheckCheckIcon, RefreshCwIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { notificationHistoryApi, type NotificationHistoryEntry } from './notification-history-api.js'
import type { NotificationHistoryTranslate } from './notification-history-locales.js'

const historyKey = ['thread-sidebar', 'notification-history'] as const
const noEntries: readonly NotificationHistoryEntry[] = []

type HistoryView = 'all' | 'unread' | 'dismissed'

const isHistoryView = (value: string): value is HistoryView => value === 'all' || value === 'unread' || value === 'dismissed'

type HistoryAction =
  | { readonly kind: 'read'; readonly ids: readonly string[]; readonly read: boolean }
  | { readonly kind: 'dismiss'; readonly id: string; readonly dismissed: boolean }

/**
 * b:ysaj: an unread entry reads with the glyph of what it asked for (an approval or a question is Needs you, a failure
 * is Failed, the rest Ready); a read one is Idle, seen with nothing pending.
 */
const statusOf = (entry: NotificationHistoryEntry): StatusGlyphState => {
  if (entry.read) return 'idle'
  if (entry.category === 'approval-needed' || entry.category === 'input-needed') return 'needs-you'
  if (entry.category === 'failed') return 'failed'
  return 'ready'
}

/** "5m ago", the way the other pages say it; the full date and time stay in the accessible name. */
const ago = (at: number, now: number, t: NotificationHistoryTranslate): string => {
  const age = relativeTime(at, now)
  return age.unit === 'now' ? t('justNow') : t(`ago.${age.unit}`, { n: age.n })
}

export const NotificationHistoryPanel = (props: {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly openThread: (sessionId: string) => Promise<boolean>
  readonly t: NotificationHistoryTranslate
}): JSX.Element => {
  const api = useApi(notificationHistoryApi)
  const queryClient = useQueryClient()
  const t = props.t
  const [view, setView] = useState<HistoryView>('all')
  const [clearIds, setClearIds] = useState<readonly string[] | null>(null)
  const [navigationNotice, setNavigationNotice] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const sessions = useSyncExternalStore(
    useCallback(listener => props.sessions.list.subscribe(listener), [props.sessions]),
    () => props.sessions.list.getSnapshot(),
  )
  const workspaces = useSyncExternalStore(
    useCallback(listener => props.workspaces.list.subscribe(listener), [props.workspaces]),
    () => props.workspaces.list.getSnapshot(),
  )
  const history = useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) => api.list({}, { signal }),
    refetchInterval: 5_000,
    retry: 1,
  })
  const transition = useMutation({
    mutationFn: async (action: HistoryAction) => {
      if (action.kind === 'read') return api.setRead({ ids: [...action.ids], read: action.read })
      return api.setDismissed({ id: action.id, dismissed: action.dismissed })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: historyKey }),
  })
  const clear = useMutation({
    mutationFn: (ids: readonly string[]) => api.clear({ ids: [...ids], confirm: true }),
    onSuccess: async () => {
      setClearIds(null)
      await queryClient.invalidateQueries({ queryKey: historyKey })
    },
  })
  const open = useMutation({
    mutationFn: async (entry: NotificationHistoryEntry) => {
      const opened = await props.openThread(entry.sessionId)
      setNavigationNotice(!opened)
      if (opened) await api.setRead({ ids: [entry.id], read: true })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: historyKey }),
  })
  const entries = history.data?.entries ?? noEntries
  const active = entries.filter(entry => !entry.dismissed)
  const unread = active.filter(entry => !entry.read)
  const dismissed = entries.filter(entry => entry.dismissed)
  const visible = view === 'unread' ? unread : view === 'dismissed' ? dismissed : active
  const busy = transition.isPending || open.isPending || clear.isPending
  const failure = transition.error ?? open.error
  const now = Date.now()
  return (
    <Page
      scroll
      heading={t('title')}
      description={t('subtitle')}
      // Fills its pane (DESIGN.md: no centred column); Clear history loses work, so it waits in ⋯ behind a confirmation.
      actions={[
        // Only a refresh the user asked for spins: the 5 s background poll would make the header twitch.
        {
          id: 'refresh',
          label: t('refresh'),
          icon: <RefreshCwIcon aria-hidden />,
          pending: refreshing,
          onSelect: () => {
            setRefreshing(true)
            void history.refetch().finally(() => setRefreshing(false))
          },
        },
        {
          id: 'mark-all-read',
          label: t('markAllRead'),
          icon: <CheckCheckIcon aria-hidden />,
          disabled: busy || entries.every(entry => entry.read),
          onSelect: () => transition.mutate({ kind: 'read', ids: entries.filter(entry => !entry.read).map(entry => entry.id), read: true }),
        },
        {
          id: 'clear',
          label: t('clear'),
          icon: <Trash2Icon aria-hidden />,
          destructive: true,
          placement: 'overflow',
          disabled: busy || entries.length === 0,
          onSelect: () => {
            clear.reset()
            setClearIds(entries.map(entry => entry.id))
          },
        },
      ]}
      tabs={{
        label: t('title'),
        value: view,
        onValueChange: value => {
          if (isHistoryView(value)) setView(value)
        },
        items: [
          { value: 'all', label: t('all'), count: active.length },
          { value: 'unread', label: t('unread'), count: unread.length },
          { value: 'dismissed', label: t('dismissed'), count: dismissed.length },
        ],
      }}
    >
      {history.isPending ? <p role="status">{t('loading')}</p> : null}
      {history.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>
            {t('unavailable')}{' '}
            <Button variant="outline" size="sm" onClick={() => void history.refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {failure === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(failure, t('actionFailed'))}</AlertDescription>
        </Alert>
      )}
      {navigationNotice ? (
        <Alert role="status">
          <AlertDescription>{t('missingHint')}</AlertDescription>
        </Alert>
      ) : null}
      {history.data !== undefined && visible.length === 0 ? <EmptyState>{t('empty')}</EmptyState> : null}
      {visible.length === 0 ? null : (
        <EntityList aria-label={t('title')}>
          {visible.map(entry => {
            const sessionId = sessions.ids.find(id => id === entry.sessionId)
            const session = sessionId === undefined ? undefined : sessions.byId[sessionId]
            const archived = workspaces.archivedSessionIds.some(id => id === entry.sessionId)
            return (
              <EntityRow
                key={entry.id}
                role="listitem"
                data-notification-id={entry.id}
                status={statusOf(entry)}
                statusLabel={t(entry.read ? 'read' : 'unread')}
                heading={t(entry.category)}
                meta={
                  <time className="dshx:tabular-nums" dateTime={new Date(entry.at).toISOString()} aria-label={new Date(entry.at).toLocaleString()}>
                    {ago(entry.at, now, t)}
                  </time>
                }
                description={session?.displayTitle ?? t('missingThread')}
                trailing={
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || session === undefined || workspaces.phase !== 'ready'}
                      onClick={() => open.mutate(entry)}
                    >
                      {t(archived ? 'restoreThread' : 'openThread')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => transition.mutate({ kind: 'read', ids: [entry.id], read: !entry.read })}>
                      {t(entry.read ? 'markUnread' : 'markRead')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => transition.mutate({ kind: 'dismiss', id: entry.id, dismissed: !entry.dismissed })}
                    >
                      {t(entry.dismissed ? 'restore' : 'dismiss')}
                    </Button>
                  </>
                }
              />
            )
          })}
        </EntityList>
      )}
      <AlertDialog
        open={clearIds !== null}
        onOpenChange={isOpen => {
          if (!isOpen && !clear.isPending) setClearIds(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('clearTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('clearDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          {clear.error === null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(clear.error, t('actionFailed'))}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <Button variant="outline" disabled={clear.isPending} onClick={() => setClearIds(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={clear.isPending}
              onClick={() => {
                if (clearIds !== null) clear.mutate(clearIds)
              }}
            >
              {t('clear')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  )
}

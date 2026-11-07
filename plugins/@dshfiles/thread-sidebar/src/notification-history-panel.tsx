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
import { useCallback, useState, useSyncExternalStore } from 'react'
import { notificationHistoryApi, type NotificationHistoryEntry } from './notification-history-api.js'
import type { NotificationHistoryTranslate } from './notification-history-locales.js'

const historyKey = ['thread-sidebar', 'notification-history'] as const
const noEntries: readonly NotificationHistoryEntry[] = []

type HistoryAction =
  | { readonly kind: 'read'; readonly ids: readonly string[]; readonly read: boolean }
  | { readonly kind: 'dismiss'; readonly id: string; readonly dismissed: boolean }
  | { readonly kind: 'clear'; readonly ids: readonly string[] }

export const NotificationHistoryPanel = (props: {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly openThread: (sessionId: string) => Promise<boolean>
  readonly t: NotificationHistoryTranslate
}): JSX.Element => {
  const api = useApi(notificationHistoryApi)
  const queryClient = useQueryClient()
  const t = props.t
  const [view, setView] = useState('all')
  const [clearIds, setClearIds] = useState<readonly string[] | null>(null)
  const [navigationNotice, setNavigationNotice] = useState(false)
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
      if (action.kind === 'dismiss') return api.setDismissed({ id: action.id, dismissed: action.dismissed })
      return api.clear({ ids: [...action.ids], confirm: true })
    },
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
  const busy = transition.isPending || open.isPending
  const failure = transition.error ?? open.error
  return (
    <Page
      scroll
      heading={t('title')}
      description={t('subtitle')}
      className="dshx:mx-auto dshx:w-full dshx:max-w-3xl"
      tabs={{
        label: t('title'),
        value: view,
        onValueChange: setView,
        items: [
          { value: 'all', label: t('all'), count: active.length },
          { value: 'unread', label: t('unread'), count: unread.length },
          { value: 'dismissed', label: t('dismissed'), count: dismissed.length },
        ],
      }}
    >
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2" role="toolbar" aria-label={t('title')}>
        <Button size="sm" variant="outline" disabled={history.isFetching} onClick={() => void history.refetch()}>
          {t('refresh')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || unread.length === 0}
          onClick={() => transition.mutate({ kind: 'read', ids: unread.map(entry => entry.id), read: true })}
        >
          {t('markAllRead')}
        </Button>
        <Button size="sm" variant="destructive" disabled={busy || entries.length === 0} onClick={() => setClearIds(entries.map(entry => entry.id))}>
          {t('clear')}
        </Button>
      </div>
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
          <AlertDescription>
            {errorMessage(failure, t('actionFailed'))} {t('actionFailed')}
          </AlertDescription>
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
                status={entry.read ? 'done' : 'ready'}
                statusLabel={t(entry.read ? 'read' : 'unread')}
                heading={t(entry.category)}
                meta={<time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString()}</time>}
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
          if (!isOpen && !transition.isPending) setClearIds(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('clearTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('clearDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          {transition.error === null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{t('actionFailed')}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <Button variant="outline" disabled={transition.isPending} onClick={() => setClearIds(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={transition.isPending}
              onClick={() => {
                if (clearIds !== null) transition.mutate({ kind: 'clear', ids: clearIds })
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

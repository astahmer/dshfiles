import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { useApi, useApiEvent } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState, Page } from '@dshfiles/plugin-ui/components/page'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { ClockIcon, EllipsisIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { attentionApi, type AttentionItem, type AttentionProviderVerb, type AttentionView } from './attention-api.js'
import { InboxNotifications } from './inbox-notifications.js'
import type { InboxTranslate } from './inbox-locales.js'
import { InboxView, type SnoozeChoice } from './inbox-view.js'

export const inboxKeys = { all: ['activity-timeline', 'attention'] as const, view: (view: AttentionView) => ['activity-timeline', 'attention', view] as const }

const PROVIDER_VERBS: readonly AttentionProviderVerb[] = ['Approve', 'Land', 'Retry', 'Resume']

export interface Navigation {
  readonly sessions: ISessions
  readonly uiWorkspace: UiWorkspace
  readonly workspaces: IWorkspaces
}

/** Open a thread the user can still reach; an archived or missing one reports why instead of reviving it. */
export const openThread = (navigation: Navigation, sessionId: string): boolean => {
  const workspaceList = navigation.workspaces.list.getSnapshot()
  if (workspaceList.phase !== 'ready' || workspaceList.archivedSessionIds.some(archivedId => archivedId === sessionId)) return false
  const sessionList = navigation.sessions.list.getSnapshot()
  const availableId = sessionList.ids.find(candidate => candidate === sessionId)
  if (availableId === undefined || sessionList.byId[availableId] === undefined) return false
  try {
    navigation.uiWorkspace.openSession(availableId)
    return true
  } catch {
    return false
  }
}

/** Plan §4.7: blocking items are Needs you, failed stay Failed, ready is Ready; anything closed reads as Done. */
const statusOf = (item: AttentionItem, view: AttentionView): WorkStatus => {
  if (view === 'closed') return 'done'
  if (item.severity === 'blocking') return 'needs-you'
  if (item.severity === 'failed') return 'failed'
  return 'ready'
}

const InboxRow = (props: {
  readonly item: AttentionItem
  readonly view: AttentionView
  readonly t: InboxTranslate
  readonly now: number
  readonly sessionLabel: (sessionId: string) => string
  readonly busy: boolean
  readonly onOpen: (item: AttentionItem) => void
  readonly onAct: (item: AttentionItem, verb: AttentionProviderVerb, choiceId?: string) => void
  readonly onDone: (item: AttentionItem) => void
  readonly onSnooze: (item: AttentionItem, choice: SnoozeChoice) => void
  readonly onReopen: (item: AttentionItem) => void
  readonly onMute: (source: string, muted: boolean) => void
}): JSX.Element => {
  const { item, t } = props
  const open = props.view !== 'closed' && props.view !== 'muted'
  const undo = InboxView.undoOf(item, props.view)
  const status = statusOf(item, props.view)
  const statusLabel = status === 'needs-you' ? t('severityBlocking') : status === 'failed' ? t('severityFailed') : status === 'ready' ? t('severityReady') : t('closed')
  const subjectLabel = item.subject.kind === 'session' ? props.sessionLabel(item.subject.id) : (item.subject.label ?? item.subject.id)
  return (
    <EntityRow
      role="listitem"
      data-attention-item={item.id}
      data-severity={item.severity}
      status={status}
      statusLabel={statusLabel}
      heading={item.reason}
      meta={
        <>
          <span>{InboxView.sourceLabel(item.source)}</span>
          {item.subject.kind === 'session' ? (
            <button
              type="button"
              className="dshx:min-w-0 dshx:max-w-full dshx:truncate dshx:text-left dshx:underline-offset-2 dshx:hover:underline"
              onClick={() => props.onOpen(item)}
            >
              {subjectLabel}
            </button>
          ) : (
            <span className="dshx:min-w-0 dshx:truncate">{subjectLabel}</span>
          )}
          <span>{InboxView.relativeAge(item.openedAt, props.now)}</span>
          {item.occurrences > 1 ? <Badge variant="outline">{`${String(item.occurrences)} ${t('occurrences')}`}</Badge> : null}
          {item.resolvedAt !== null ? <Badge variant="secondary">{t('resolved')}</Badge> : null}
          {props.view === 'snoozed' ? (
            <Badge variant="outline">
              {item.snoozeUntilChange ? t('snoozedUntilChange') : `${t('snoozedUntil')} ${new Date(item.snoozedUntil ?? 0).toLocaleString()}`}
            </Badge>
          ) : null}
        </>
      }
      {...(item.detail === null ? {} : { description: item.detail })}
    >
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:px-3 dshx:pb-2 dshx:pl-9">
        {open && item.verbs.includes('Answer') && item.choices.length > 0
          ? item.choices.map(choice => (
              <Button
                key={choice.id}
                size="sm"
                variant={choice.recommended === true ? 'default' : 'outline'}
                className="dshx:shrink dshx:max-w-full"
                disabled={props.busy}
                onClick={() => props.onAct(item, 'Answer', choice.id)}
              >
                <span className="dshx:truncate">{choice.label}</span>
                {choice.recommended === true ? <span className="dshx:sr-only"> ({t('recommended')})</span> : null}
              </Button>
            ))
          : null}
        {open
          ? PROVIDER_VERBS.filter(verb => item.verbs.includes(verb)).map(verb => (
              <Button key={verb} size="sm" variant="outline" disabled={props.busy} onClick={() => props.onAct(item, verb)}>
                {verb}
              </Button>
            ))
          : null}
        {item.verbs.includes('Open') && item.subject.kind === 'session' ? (
          <Button size="sm" variant={open && !item.verbs.includes('Answer') ? 'default' : 'ghost'} onClick={() => props.onOpen(item)}>
            {t('open')}
          </Button>
        ) : null}
        {open && item.verbs.includes('Done') ? (
          <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onDone(item)}>
            {t('done')}
          </Button>
        ) : null}
        {open && props.view !== 'snoozed' && item.verbs.includes('Snooze') ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={props.busy}>
                <ClockIcon aria-hidden />
                {t('snooze')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => props.onSnooze(item, 'hour')}>{t('snoozeHour')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onSnooze(item, 'four-hours')}>{t('snoozeFourHours')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onSnooze(item, 'tomorrow')}>{t('snoozeDay')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => props.onSnooze(item, 'change')}>{t('snoozeChange')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {undo === 'reopen' || undo === 'unsnooze' ? (
          <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onReopen(item)}>
            {undo === 'reopen' ? t('reopen') : t('unsnooze')}
          </Button>
        ) : null}
        {undo === 'unmute' ? (
          <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onMute(item.source, false)}>
            {t('unmuteSource')}
          </Button>
        ) : null}
        {open && item.verbs.includes('MuteSource') ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={t('more')}>
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => props.onMute(item.source, true)}>{t('muteSource')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </EntityRow>
  )
}

const emptyCopy = (view: AttentionView, t: InboxTranslate): string => {
  if (view === 'needs-you') return `${t('emptyNeedsYou')} ${t('emptyNeedsYouHint')}`
  if (view === 'other') return t('emptyOther')
  if (view === 'snoozed') return t('emptySnoozed')
  if (view === 'closed') return t('emptyClosed')
  return t('emptyMuted')
}

export const InboxPanel = (props: Navigation & { readonly t: InboxTranslate }): JSX.Element => {
  const api = useApi(attentionApi)
  const t = props.t
  const queryClient = useQueryClient()
  const [view, setView] = useState<AttentionView>('needs-you')
  const [notice, setNotice] = useState<{ readonly tone: 'ok' | 'error'; readonly text: string } | null>(null)
  const sessionLabel = EntityLabels.useSessionLabel(props.sessions)
  const eventStatus = useApiEvent(attentionApi, 'changed', () => void queryClient.invalidateQueries({ queryKey: inboxKeys.all }))
  const listQuery = useQuery({
    queryKey: inboxKeys.view(view),
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.list({ view, limit: 100 }, { signal: hostSignal }) }),
    // The changed event keeps the list current; polling only covers a disconnected event stream.
    refetchInterval: eventStatus === 'live' ? 60_000 : 10_000,
    retry: 1,
  })
  const settle = (outcome: { readonly ok: boolean; readonly message: string } | null): void => {
    if (outcome !== null) setNotice({ tone: outcome.ok ? 'ok' : 'error', text: outcome.message })
    void queryClient.invalidateQueries({ queryKey: inboxKeys.all })
  }
  const failed = (error: unknown): void => setNotice({ tone: 'error', text: errorMessage(error, t('actionFailed')) })
  const transition = useMutation({
    mutationFn: async (
      request:
        | { readonly kind: 'done'; readonly id: string }
        | { readonly kind: 'reopen'; readonly id: string }
        | { readonly kind: 'snooze'; readonly id: string; readonly choice: SnoozeChoice }
        | { readonly kind: 'mute'; readonly source: string; readonly muted: boolean }
        | { readonly kind: 'act'; readonly id: string; readonly verb: AttentionProviderVerb; readonly choiceId?: string },
    ) =>
      runHostRequest({
        request: async signal => {
          if (request.kind === 'done') return void (await api.done({ id: request.id }, { signal }))
          if (request.kind === 'reopen') return void (await api.reopen({ id: request.id }, { signal }))
          if (request.kind === 'snooze') return void (await api.snooze({ id: request.id, ...InboxView.snoozeTarget(request.choice, Date.now()) }, { signal }))
          if (request.kind === 'mute') return void (await api.muteSource({ source: request.source, muted: request.muted }, { signal }))
          return api.act({ id: request.id, verb: request.verb, ...(request.choiceId !== undefined && { choiceId: request.choiceId }) }, { signal })
        },
      }),
    onSuccess: outcome => settle(outcome ?? null),
    onError: failed,
  })
  const openItem = (item: AttentionItem): void => {
    if (item.subject.kind !== 'session') return
    if (openThread(props, item.subject.id)) setNotice(null)
    else setNotice({ tone: 'error', text: t('sessionUnavailable') })
  }
  const data = listQuery.data
  const counts = data?.counts
  // Ages are read against the moment the list arrived, so a render never reads the clock.
  const now = listQuery.dataUpdatedAt
  const tabs: readonly { readonly view: AttentionView; readonly label: string; readonly count: number }[] = [
    { view: 'needs-you', label: t('needsYou'), count: counts?.needsYou ?? 0 },
    { view: 'other', label: t('other'), count: counts?.other ?? 0 },
    { view: 'snoozed', label: t('snoozed'), count: counts?.snoozed ?? 0 },
    { view: 'closed', label: t('closed'), count: counts?.closed ?? 0 },
    { view: 'muted', label: t('muted'), count: counts?.muted ?? 0 },
  ]
  const visibleTabs = tabs.filter(tab => tab.view === 'needs-you' || tab.view === 'other' || tab.count > 0 || tab.view === view)
  return (
    <Page
      scroll
      heading={t('title')}
      description={t('subtitle')}
      className="dshx:mx-auto dshx:w-full dshx:max-w-3xl"
      tabs={{
        label: t('title'),
        value: view,
        onValueChange: value => setView(tabs.find(tab => tab.view === value)?.view ?? 'needs-you'),
        items: visibleTabs.map(tab => ({ value: tab.view, label: tab.label, ...(tab.count > 0 && { count: tab.count }) })),
      }}
    >
      {notice === null ? null : (
        <Alert variant={notice.tone === 'error' ? 'destructive' : 'default'} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}
      {listQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <span>
              {errorMessage(listQuery.error, t('loadFailed'))} {t('loadFailedHint')}
            </span>
            <Button size="sm" variant="outline" onClick={() => void listQuery.refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data !== undefined && data.items.length === 0 ? <EmptyState>{emptyCopy(view, t)}</EmptyState> : null}
      {data === undefined || data.items.length === 0 ? null : (
        <EntityList aria-label={tabs.find(tab => tab.view === view)?.label ?? t('title')}>
          {data.items.map(item => (
            <InboxRow
              key={item.id}
              item={item}
              view={view}
              t={t}
              now={now}
              sessionLabel={sessionLabel}
              busy={transition.isPending}
              onOpen={openItem}
              onAct={(target, verb, choiceId) => transition.mutate({ kind: 'act', id: target.id, verb, ...(choiceId !== undefined && { choiceId }) })}
              onDone={target => transition.mutate({ kind: 'done', id: target.id })}
              onSnooze={(target, choice) => transition.mutate({ kind: 'snooze', id: target.id, choice })}
              onReopen={target => transition.mutate({ kind: 'reopen', id: target.id })}
              onMute={(source, muted) => transition.mutate({ kind: 'mute', source, muted })}
            />
          ))}
        </EntityList>
      )}
      <InboxNotifications.Toggle t={t} />
    </Page>
  )
}

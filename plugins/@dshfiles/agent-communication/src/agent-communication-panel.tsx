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
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { communicationDeliverySchema, type CommunicationDelivery } from '@dshfiles/dshx/communication/types'
import { useState } from 'react'
import { agentCommunicationApi } from './api.js'
import { runHostRequest } from './host-request.js'
import type { AgentCommunicationTranslate } from './locales.js'

const diagnosticsKey = ['agent-communication', 'diagnostics'] as const
const messageRecipientsKey = ['agent-communication', 'message-recipients'] as const
const REPORT_LIMIT = 100

interface AgentCommunicationPanelProps {
  readonly t: AgentCommunicationTranslate
}

type ManagementAction =
  | {
      readonly kind: 'subscription'
      readonly agentId: string
      readonly topic: string
      readonly delivery: CommunicationDelivery
      readonly allowSteerFrom: string[]
    }
  | { readonly kind: 'unsubscribe'; readonly agentId: string; readonly topic: string }
  | { readonly kind: 'rejoin'; readonly agentId: string; readonly topic: string }
  | { readonly kind: 'acknowledge'; readonly agentId: string; readonly messageId: string }

const formatTime = (timestamp: number): string => new Date(timestamp).toLocaleString()

const actionDescription = (action: ManagementAction, t: AgentCommunicationTranslate): string => {
  if (action.kind === 'subscription') return t('confirmSubscription', { agent: action.agentId, topic: action.topic })
  if (action.kind === 'unsubscribe') return t('confirmUnsubscribe', { agent: action.agentId, topic: action.topic })
  if (action.kind === 'rejoin') return t('confirmRejoin', { agent: action.agentId, topic: action.topic })
  return t('confirmAcknowledge', { agent: action.agentId })
}

const Metric = (props: { readonly label: string; readonly value: number }): JSX.Element => (
  <Card>
    <CardContent className="dshx:flex dshx:flex-col dshx:gap-1 dshx:p-4">
      <span className="dshx:text-xs dshx:text-muted-foreground">{props.label}</span>
      <strong className="dshx:text-2xl dshx:font-semibold">{props.value}</strong>
    </CardContent>
  </Card>
)

const ActivityList = (props: {
  readonly events: readonly {
    readonly id: string
    readonly principal: { readonly id: string }
    readonly operation: string
    readonly outcome: 'success' | 'failure'
    readonly occurredAt: number
    readonly durationMs: number
    readonly callId: string
    readonly rootCallId: string | null
    readonly errorCode: string | null
  }[]
  readonly t: AgentCommunicationTranslate
}): JSX.Element => (
  <div className="dshx:flex dshx:flex-col">
    {props.events.length === 0 ? <p className="dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{props.t('noActivity')}</p> : null}
    {props.events.map(event => (
      <div
        key={event.id}
        className="dshx:grid dshx:gap-1 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3 last:dshx:border-b-0 dshx:sm:grid-cols-[11rem_minmax(0,1fr)_auto] dshx:sm:items-center"
      >
        <time className="dshx:text-xs dshx:text-muted-foreground" dateTime={new Date(event.occurredAt).toISOString()}>
          {formatTime(event.occurredAt)}
        </time>
        <div className="dshx:min-w-0">
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <span className="dshx:font-medium">{event.principal.id}</span>
            <code className="dshx:text-xs dshx:text-muted-foreground">{event.operation.replace('dshx_comm_', '')}</code>
            <Badge variant={event.outcome === 'failure' ? 'destructive' : 'secondary'}>{props.t(event.outcome)}</Badge>
          </div>
          <div className="dshx:mt-1 dshx:flex dshx:flex-wrap dshx:gap-x-3 dshx:text-xs dshx:text-muted-foreground">
            <span>{event.durationMs} ms</span>
            <span title={event.rootCallId ?? undefined}>call {event.callId}</span>
            {event.errorCode === null ? null : <span>{event.errorCode}</span>}
          </div>
        </div>
      </div>
    ))}
  </div>
)

const SubscriptionRow = (props: {
  readonly agentId: string
  readonly live: boolean
  readonly topic: string
  readonly delivery: CommunicationDelivery
  readonly allowSteerFromCount: number
  readonly liveAgents: readonly { readonly id: string }[]
  readonly busy: boolean
  readonly t: AgentCommunicationTranslate
  readonly onAction: (action: ManagementAction) => void
}): JSX.Element => {
  const [delivery, setDelivery] = useState<CommunicationDelivery>(props.delivery)
  const [allowSteerFrom, setAllowSteerFrom] = useState<string[]>([])
  const isSteerValid = delivery !== 'steer' || allowSteerFrom.length > 0
  const changed = delivery !== props.delivery || allowSteerFrom.length > 0
  return (
    <div className="dshx:grid dshx:gap-3 dshx:border-b dshx:border-border dshx:p-4 last:dshx:border-b-0">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
        <div className="dshx:min-w-0">
          <div className="dshx:break-all dshx:font-medium">{props.agentId}</div>
          <div className="dshx:break-all dshx:text-xs dshx:text-muted-foreground">{props.topic}</div>
        </div>
        <Badge variant="outline">{props.t(props.delivery)}</Badge>
      </div>
      {props.delivery === 'steer' ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">
          {props.t('steerPolicyCount', { count: props.allowSteerFromCount })} {props.t('senderListReset')}
        </p>
      ) : null}
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <span className="dshx:text-xs dshx:text-muted-foreground">{props.t('delivery')}</span>
        <Select
          value={delivery}
          onValueChange={value => {
            const parsed = communicationDeliverySchema.safeParse(value)
            if (parsed.success) setDelivery(parsed.data)
          }}
        >
          <SelectTrigger className="dshx:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="quiet">{props.t('quiet')}</SelectItem>
            <SelectItem value="queue">{props.t('queue')}</SelectItem>
            <SelectItem value="steer">{props.t('steer')}</SelectItem>
          </SelectContent>
        </Select>
        {!props.live ? <span className="dshx:text-xs dshx:text-muted-foreground">{props.t('notLive')}</span> : null}
      </div>
      {delivery === 'steer' ? (
        <fieldset className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:p-3">
          <legend className="dshx:px-1 dshx:text-xs dshx:font-medium">{props.t('allowedSenders')}</legend>
          {props.liveAgents.map(agent => (
            <label key={agent.id} className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
              <Checkbox
                checked={allowSteerFrom.includes(agent.id)}
                onCheckedChange={checked =>
                  setAllowSteerFrom(current => (checked === true ? [...new Set([...current, agent.id])] : current.filter(id => id !== agent.id)))
                }
              />
              <span className="dshx:break-all">{agent.id}</span>
            </label>
          ))}
          <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('steerHint')}</p>
          {!isSteerValid ? <p className="dshx:text-xs dshx:text-destructive">{props.t('emptySenderList')}</p> : null}
        </fieldset>
      ) : null}
      <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
        <Button
          size="sm"
          disabled={!props.live || props.busy || !isSteerValid || !changed}
          onClick={() => props.onAction({ kind: 'subscription', agentId: props.agentId, topic: props.topic, delivery, allowSteerFrom })}
        >
          {props.t('save')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!props.live || props.busy || props.topic === 'inbox'}
          onClick={() => props.onAction({ kind: 'unsubscribe', agentId: props.agentId, topic: props.topic })}
        >
          {props.t('unsubscribe')}
        </Button>
      </div>
    </div>
  )
}

export const AgentCommunicationPanel = (props: AgentCommunicationPanelProps): JSX.Element => {
  const api = useApi(agentCommunicationApi)
  const queryClient = useQueryClient()
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [action, setAction] = useState<ManagementAction | null>(null)
  const diagnosticsQuery = useQuery({
    queryKey: diagnosticsKey,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.diagnostics({ limit: REPORT_LIMIT }, { signal: hostSignal }) }),
    refetchInterval: 30_000,
    retry: 2,
  })
  const diagnostics = diagnosticsQuery.data
  const liveAgentIds = new Set(diagnostics?.agents.map(agent => agent.id) ?? [])
  const messageRecipientsQuery = useQuery({
    queryKey: [...messageRecipientsKey, selectedMessageId],
    enabled: selectedMessageId !== null,
    queryFn: ({ signal }) => {
      if (selectedMessageId === null) throw new Error('Choose a message before loading its recipients.')
      return runHostRequest({ signal, request: hostSignal => api.messageRecipients({ messageId: selectedMessageId }, { signal: hostSignal }) })
    },
    retry: false,
  })
  const revealMutation = useMutation({
    mutationFn: (messageId: string) => runHostRequest({ request: signal => api.revealMessageBody({ messageId }, { signal }) }),
  })
  const managementMutation = useMutation({
    mutationFn: (request: ManagementAction) =>
      runHostRequest({
        request: async signal => {
          if (request.kind === 'subscription') {
            return api.setSubscription(
              {
                agentId: request.agentId,
                topic: request.topic,
                delivery: request.delivery,
                allowSteerFrom: request.allowSteerFrom,
              },
              { signal },
            )
          }
          if (request.kind === 'unsubscribe') return api.unsubscribe({ agentId: request.agentId, topic: request.topic }, { signal })
          if (request.kind === 'rejoin') {
            return api.setSubscription({ agentId: request.agentId, topic: request.topic, delivery: 'queue', allowSteerFrom: [] }, { signal })
          }
          return api.acknowledge({ agentId: request.agentId, messageId: request.messageId }, { signal })
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: diagnosticsKey })
      await queryClient.invalidateQueries({ queryKey: messageRecipientsKey })
    },
  })
  const confirmAction = async (): Promise<void> => {
    if (action === null) return
    try {
      await managementMutation.mutateAsync(action)
      setAction(null)
    } catch {
      return
    }
  }
  const requestAction = (request: ManagementAction): void => {
    managementMutation.reset()
    setAction(request)
  }
  const t = props.t
  const selectedMessage = diagnostics?.recentMessages.find(message => message.id === selectedMessageId) ?? null
  const revealedBody = revealMutation.data?.messageId === selectedMessageId ? revealMutation.data.text : null
  const liveAgents = diagnostics?.agents.map(agent => ({ id: agent.id })) ?? []

  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-4 dshx:p-4 dshx:sm:p-6">
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3">
        <div>
          <h1 className="dshx:text-xl dshx:font-semibold">{t('title')}</h1>
          {diagnostics === undefined ? null : (
            <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">{t('generatedAt', { time: formatTime(diagnostics.generatedAt) })}</p>
          )}
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <Badge variant={diagnostics !== undefined && !diagnosticsQuery.isError ? 'secondary' : 'destructive'}>
            {diagnostics !== undefined && !diagnosticsQuery.isError ? t('connected') : t('unavailable')}
          </Badge>
          <Button variant="outline" size="sm" disabled={diagnosticsQuery.isFetching} onClick={() => void diagnosticsQuery.refetch()}>
            <RefreshCwIcon aria-hidden /> {t('refresh')}
          </Button>
        </div>
      </header>

      {diagnosticsQuery.isPending ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('loading')}</p> : null}
      {diagnosticsQuery.error !== null ? (
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage(diagnosticsQuery.error, t('loadFailed'))} {t('unavailableHint')}
          </AlertDescription>
        </Alert>
      ) : null}
      {diagnostics === undefined ? null : (
        <>
          <div className="dshx:grid dshx:grid-cols-2 dshx:gap-3 dshx:sm:grid-cols-4">
            <Metric label={t('agents')} value={diagnostics.agentCount} />
            <Metric label={t('topics')} value={diagnostics.topicCount} />
            <Metric label={t('subscriptions')} value={diagnostics.subscriptionCount} />
            <Metric label={t('pendingMessages')} value={diagnostics.pendingMessageCount} />
          </div>
          <p className="dshx:text-xs dshx:text-muted-foreground">
            {t('activityHistory', { count: diagnostics.activity.retainedCount })}{' '}
            {diagnostics.activity.trackingStartedAt === null
              ? t('notTrackedYet')
              : t('trackingStarted', { time: formatTime(diagnostics.activity.trackingStartedAt) })}
          </p>
          <Tabs
            defaultValue="activity"
            onValueChange={value => {
              if (value !== 'messages') revealMutation.reset()
            }}
          >
            <TabsList>
              <TabsTrigger value="activity">{t('activity')}</TabsTrigger>
              <TabsTrigger value="messages">{t('messages')}</TabsTrigger>
              <TabsTrigger value="subscriptions">{t('controls')}</TabsTrigger>
            </TabsList>
            <TabsContent value="activity">
              <Card>
                <CardHeader>
                  <CardTitle>{t('recentActivity')}</CardTitle>
                  <CardDescription>{diagnostics.historyNote}</CardDescription>
                </CardHeader>
                <CardContent className="dshx:p-0">
                  <ActivityList events={diagnostics.activity.events} t={t} />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="messages">
              <div className="dshx:grid dshx:gap-4 dshx:lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('recentMessages')}</CardTitle>
                  </CardHeader>
                  <CardContent className="dshx:p-0">
                    {diagnostics.recentMessages.length === 0 ? <p className="dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{t('noMessages')}</p> : null}
                    {diagnostics.recentMessages.map(message => (
                      <button
                        key={message.id}
                        type="button"
                        className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-1 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3 dshx:text-left last:dshx:border-b-0 dshx:hover:bg-accent"
                        aria-pressed={selectedMessageId === message.id}
                        onClick={() => {
                          setSelectedMessageId(message.id)
                          revealMutation.reset()
                        }}
                      >
                        <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                          <strong>{message.topic ?? 'inbox'}</strong>
                          <Badge variant={message.priority === 'urgent' ? 'destructive' : 'outline'}>{t(message.priority)}</Badge>
                        </span>
                        <span className="dshx:text-xs dshx:text-muted-foreground">
                          {t('sender')}: {message.sender.id} · {t('recipients')}: {message.recipientCount} · {t('pending')}: {message.pendingRecipientCount}
                        </span>
                        <time className="dshx:text-xs dshx:text-muted-foreground" dateTime={new Date(message.createdAt).toISOString()}>
                          {formatTime(message.createdAt)}
                        </time>
                      </button>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{selectedMessage?.topic ?? (selectedMessage === null ? t('message') : 'inbox')}</CardTitle>
                    {selectedMessage === null ? null : (
                      <CardDescription>
                        {t('sender')}: {selectedMessage.sender.id}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="dshx:flex dshx:flex-col dshx:gap-3">
                    {selectedMessage === null ? (
                      <p className="dshx:text-sm dshx:text-muted-foreground">{t('hiddenBody')}</p>
                    ) : (
                      <>
                        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
                          <span className="dshx:text-sm">
                            {t('recipients')} ({selectedMessage.recipientCount})
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={revealMutation.isPending}
                            onClick={() => (revealedBody === null ? revealMutation.mutate(selectedMessage.id) : revealMutation.reset())}
                          >
                            {revealedBody === null ? t('revealBody') : t('hideBody')}
                          </Button>
                        </div>
                        {revealedBody === null ? (
                          <p className="dshx:text-xs dshx:text-muted-foreground">{t('hiddenBody')}</p>
                        ) : (
                          <pre className="dshx:max-h-64 dshx:overflow-auto dshx:whitespace-pre-wrap dshx:rounded-md dshx:bg-muted dshx:p-3 dshx:text-sm">
                            {revealedBody}
                          </pre>
                        )}
                        {revealMutation.error !== null ? (
                          <Alert variant="destructive">
                            <AlertDescription>{errorMessage(revealMutation.error, t('actionFailed'))}</AlertDescription>
                          </Alert>
                        ) : null}
                        {messageRecipientsQuery.isPending ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('loading')}</p> : null}
                        {messageRecipientsQuery.error !== null ? (
                          <Alert variant="destructive">
                            <AlertDescription>{errorMessage(messageRecipientsQuery.error, t('loadFailed'))}</AlertDescription>
                          </Alert>
                        ) : null}
                        {messageRecipientsQuery.data?.recipients.map(recipient => (
                          <div
                            key={`${recipient.principal.kind}:${recipient.principal.id}`}
                            className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2"
                          >
                            <div className="dshx:min-w-0">
                              <span className="dshx:break-all">{recipient.principal.id}</span>
                              <span className="dshx:ml-2 dshx:text-xs dshx:text-muted-foreground">{t(recipient.delivery)}</span>
                            </div>
                            <div className="dshx:flex dshx:items-center dshx:gap-2">
                              <Badge variant={recipient.acknowledgedAt === null ? 'outline' : 'secondary'}>
                                {recipient.acknowledgedAt === null ? t('pending') : t('acknowledged')}
                              </Badge>
                              {recipient.principal.kind !== 'agent' || recipient.acknowledgedAt !== null ? null : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={managementMutation.isPending}
                                  onClick={() => requestAction({ kind: 'acknowledge', agentId: recipient.principal.id, messageId: selectedMessage.id })}
                                >
                                  {t('acknowledge')}
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                        {messageRecipientsQuery.data?.recipients.length === 0 ? (
                          <p className="dshx:text-sm dshx:text-muted-foreground">{t('noRecipientDetails')}</p>
                        ) : null}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="subscriptions">
              <div className="dshx:grid dshx:gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('topics')}</CardTitle>
                  </CardHeader>
                  <CardContent className="dshx:p-0">
                    {diagnostics.topics.length === 0 ? <p className="dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{t('noTopics')}</p> : null}
                    {diagnostics.topics.map(topic => (
                      <div
                        key={topic.topic}
                        className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3 last:dshx:border-b-0"
                      >
                        <code className="dshx:break-all dshx:text-sm">{topic.topic}</code>
                        <Badge variant="secondary">{topic.subscribers}</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('controls')}</CardTitle>
                    <CardDescription>{t('steerHint')}</CardDescription>
                  </CardHeader>
                  <CardContent className="dshx:p-0">
                    {diagnostics.subscriptions.length === 0 ? <p className="dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{t('noSubscriptions')}</p> : null}
                    {diagnostics.subscriptions.map(subscription =>
                      subscription.principal.kind === 'agent' ? (
                        <SubscriptionRow
                          key={`${subscription.principal.id}:${subscription.topic}:${subscription.createdAt}`}
                          agentId={subscription.principal.id}
                          live={liveAgentIds.has(subscription.principal.id)}
                          topic={subscription.topic}
                          delivery={subscription.delivery}
                          allowSteerFromCount={subscription.allowSteerFromCount}
                          liveAgents={liveAgents}
                          busy={managementMutation.isPending}
                          t={t}
                          onAction={requestAction}
                        />
                      ) : (
                        <div
                          key={`${subscription.principal.kind}:${subscription.principal.id}:${subscription.topic}`}
                          className="dshx:border-b dshx:border-border dshx:p-4 last:dshx:border-b-0"
                        >
                          <p className="dshx:break-all dshx:font-medium">{subscription.principal.id}</p>
                          <p className="dshx:break-all dshx:text-xs dshx:text-muted-foreground">{subscription.topic}</p>
                          <Badge className="dshx:mt-2" variant="outline">
                            {t('externalReadOnly')}
                          </Badge>
                        </div>
                      ),
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('agents')}</CardTitle>
                  </CardHeader>
                  <CardContent className="dshx:p-0">
                    {diagnostics.agents.length === 0 ? <p className="dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{t('noAgents')}</p> : null}
                    {diagnostics.agents.map(agent => (
                      <div
                        key={agent.id}
                        className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-b dshx:border-border dshx:p-4 last:dshx:border-b-0"
                      >
                        <div className="dshx:min-w-0">
                          <p className="dshx:break-all dshx:font-medium">{agent.id}</p>
                          <p className="dshx:text-xs dshx:text-muted-foreground">
                            {t('status')}: {t(agent.status ?? 'idle')}
                          </p>
                          <p className="dshx:break-all dshx:text-xs dshx:text-muted-foreground">
                            {t('workspaceTopic')}: {agent.workspaceTopic ?? '—'}
                          </p>
                        </div>
                        {agent.workspaceOptedOut ? (
                          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                            <Badge variant="outline">{t('optedOut')}</Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={agent.workspaceTopic === null || managementMutation.isPending}
                              onClick={() => agent.workspaceTopic !== null && requestAction({ kind: 'rejoin', agentId: agent.id, topic: agent.workspaceTopic })}
                            >
                              {t('rejoin')}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
          {managementMutation.error !== null ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(managementMutation.error, t('actionFailed'))}</AlertDescription>
            </Alert>
          ) : null}
        </>
      )}

      <AlertDialog
        open={action !== null}
        onOpenChange={open => {
          if (!open && !managementMutation.isPending) setAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{action === null ? '' : actionDescription(action, t)}</AlertDialogDescription>
          </AlertDialogHeader>
          <Separator />
          {managementMutation.error === null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(managementMutation.error, t('actionFailed'))}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={managementMutation.isPending} onClick={() => setAction(null)}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={managementMutation.isPending}
              variant={action?.kind === 'unsubscribe' ? 'destructive' : 'default'}
              onClick={event => {
                event.preventDefault()
                void confirmAction()
              }}
            >
              {t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

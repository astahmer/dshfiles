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
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { HashIcon, MessageSquareIcon, RefreshCwIcon, SearchIcon, SendIcon } from '@dshfiles/plugin-ui/icons'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { errorMessage, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import type { CommunicationDiagnosticAgent, CommunicationDiagnostics, CommunicationMessage } from '@dshfiles/dshx/communication'
import { useState } from 'react'
import { agentCommunicationApi, type AgentCommunicationPostInput } from './api.js'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { AgentCommunicationTranslate } from './locales.js'

const diagnosticsKey = ['agent-communication', 'diagnostics'] as const
const browseKey = ['agent-communication', 'browse'] as const
const messageRecipientsKey = ['agent-communication', 'message-recipients'] as const
const REPORT_LIMIT = 100
const PAGE_SIZE = 50

type ConversationSelection =
  | { readonly kind: 'all' }
  | { readonly kind: 'topic'; readonly topic: string }
  | { readonly kind: 'direct'; readonly agentId: string }

type ManagementAction =
  | { readonly kind: 'unsubscribe'; readonly agentId: string; readonly topic: string }
  | { readonly kind: 'rejoin'; readonly agentId: string; readonly topic: string }

interface SendVariables {
  readonly input: AgentCommunicationPostInput
  readonly selection: ConversationSelection
  readonly queryKey: readonly string[]
}

interface AgentCommunicationPanelProps {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly t: AgentCommunicationTranslate
}

/** Agents are Sessions and workspace channels are hashed folders: both render as thread titles and project names. */
interface Labels {
  readonly agent: (agentId: string) => string
  readonly topic: (topic: string) => string
}

const formatTime = (timestamp: number): string => new Date(timestamp).toLocaleString()
const principalLabel = (principal: CommunicationMessage['sender'], labels: Labels, t: AgentCommunicationTranslate): string =>
  principal.kind === 'agent'
    ? labels.agent(principal.id)
    : principal.id === 'communication-browser'
      ? t('browserUser')
      : t('externalPrincipal', { id: principal.id })

const selectionKey = (selection: ConversationSelection): readonly string[] => {
  if (selection.kind === 'topic') return [...browseKey, 'topic', selection.topic]
  if (selection.kind === 'direct') return [...browseKey, 'direct', selection.agentId]
  return [...browseKey, 'all']
}

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
  readonly labels: Labels
  readonly t: AgentCommunicationTranslate
}): JSX.Element => (
  <div className="dshx:flex dshx:flex-col">
    {props.events.length === 0 ? <p className="dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{props.t('noActivity')}</p> : null}
    {props.events.map(event => (
      <div
        key={event.id}
        className="dshx:grid dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3 last:dshx:border-b-0 dshx:sm:grid-cols-[11rem_minmax(0,1fr)_auto] dshx:sm:items-center"
      >
        <time className="dshx:text-xs dshx:text-muted-foreground" dateTime={new Date(event.occurredAt).toISOString()}>
          {formatTime(event.occurredAt)}
        </time>
        <div className="dshx:min-w-0">
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <span className="dshx:break-words dshx:font-medium">{props.labels.agent(event.principal.id)}</span>
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

const MessageRow = (props: {
  readonly message: CommunicationMessage
  readonly selected: boolean
  readonly labels: Labels
  readonly t: AgentCommunicationTranslate
  readonly onSelect: (messageId: string) => void
  readonly onOpenDirect: (agentId: string) => void
  readonly disabled?: boolean
}): JSX.Element => (
  <article
    className={`dshx:rounded-lg dshx:border dshx:border-border dshx:p-3 dshx:sm:p-4 ${props.selected ? 'dshx:border-primary dshx:bg-accent/40' : 'dshx:bg-card'}`}
    aria-current={props.selected ? 'true' : undefined}
  >
    <div className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-2">
      <div className="dshx:min-w-0">
        <p className="dshx:break-all dshx:text-sm dshx:font-semibold">{principalLabel(props.message.sender, props.labels, props.t)}</p>
        <time className="dshx:text-xs dshx:text-muted-foreground" dateTime={new Date(props.message.createdAt).toISOString()}>
          {formatTime(props.message.createdAt)}
        </time>
      </div>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Badge variant={props.message.intent === 'request' ? 'default' : 'outline'}>
          {props.message.intent === 'request' ? props.t('request') : props.t('notice')}
        </Badge>
        <Badge variant="outline">{props.message.priority === 'urgent' ? props.t('urgent') : props.t('normal')}</Badge>
        <Badge variant="secondary">{props.t('recipientCount', { count: props.message.recipients.length })}</Badge>
      </div>
    </div>
    <div className="dshx:mt-3 dshx:rounded-md dshx:bg-muted/60 dshx:p-3">
      <p className="dshx:mb-1 dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">{props.t('untrustedText')}</p>
      <p className="dshx:whitespace-pre-wrap dshx:break-words dshx:text-sm">{props.message.text}</p>
    </div>
    <div className="dshx:mt-3 dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
      <span className="dshx:text-xs dshx:text-muted-foreground">
        {props.t('notReadCount', { count: props.message.recipients.filter(recipient => recipient.readAt === null).length })}
      </span>
      <div className="dshx:flex dshx:gap-2">
        {props.message.sender.kind === 'agent' ? (
          <Button variant="ghost" size="sm" disabled={props.disabled} onClick={() => props.onOpenDirect(props.message.sender.id)}>
            <MessageSquareIcon aria-hidden /> {props.t('directMessages')}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" disabled={props.disabled} aria-pressed={props.selected} onClick={() => props.onSelect(props.message.id)}>
          {props.t('messageContext')}
        </Button>
      </div>
    </div>
  </article>
)

const AgentStatus = (props: { readonly agent: CommunicationDiagnosticAgent; readonly t: AgentCommunicationTranslate }): JSX.Element => (
  <Badge variant={props.agent.status === 'running' ? 'default' : 'secondary'}>{props.agent.status === 'running' ? props.t('running') : props.t('idle')}</Badge>
)

const DiagnosticPanel = (props: {
  readonly data: CommunicationDiagnostics
  readonly labels: Labels
  readonly t: AgentCommunicationTranslate
  readonly onAction: (action: ManagementAction) => void
  readonly busy: boolean
}): JSX.Element => {
  const t = props.t
  const diagnostics = props.data
  const missingWorkspace = diagnostics.agents.filter(agent => agent.workspaceTopic !== null && agent.workspaceSubscribed === false && !agent.workspaceOptedOut)
  const topicMap = new Map(diagnostics.topics.map(topic => [topic.topic, topic.subscribers]))
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-4">
      <div className="dshx:grid dshx:grid-cols-2 dshx:gap-3 dshx:lg:grid-cols-4">
        {[
          { label: t('agents'), value: diagnostics.agentCount },
          { label: t('channels'), value: diagnostics.topicCount },
          { label: t('subscriptions'), value: diagnostics.subscriptionCount },
          { label: t('pending'), value: diagnostics.pendingRecipientCount },
        ].map(metric => (
          <Card key={metric.label}>
            <CardContent className="dshx:p-4">
              <p className="dshx:text-xs dshx:text-muted-foreground">{metric.label}</p>
              <p className="dshx:mt-1 dshx:text-2xl dshx:font-semibold">{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {missingWorkspace.length === 0 ? null : (
        <Alert variant="destructive">
          <AlertDescription>{t('missingWorkspaceSubscriptions', { count: missingWorkspace.length })}</AlertDescription>
        </Alert>
      )}
      <div className="dshx:grid dshx:gap-4 dshx:xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('channels')}</CardTitle>
            <CardDescription>{t('topicSubscribers', { count: diagnostics.topics.reduce((sum, topic) => sum + topic.subscribers, 0) })}</CardDescription>
          </CardHeader>
          <CardContent className="dshx:p-0">
            {diagnostics.topics.length === 0 ? <p className="dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{t('noTopics')}</p> : null}
            {diagnostics.topics.map(topic => (
              <div
                key={topic.topic}
                className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-t dshx:border-border dshx:px-4 dshx:py-3"
              >
                <span className="dshx:min-w-0 dshx:truncate dshx:text-sm" title={topic.topic}>
                  {props.labels.topic(topic.topic)}
                </span>
                <Badge variant="secondary">{topicMap.get(topic.topic) ?? 0}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('agents')}</CardTitle>
            <CardDescription>{t('offlineUnknown')}</CardDescription>
          </CardHeader>
          <CardContent className="dshx:p-0">
            {diagnostics.agents.length === 0 ? <p className="dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{t('noLiveAgents')}</p> : null}
            {diagnostics.agents.map(agent => (
              <div
                key={agent.id}
                className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-t dshx:border-border dshx:p-4"
              >
                <div className="dshx:min-w-0">
                  <p className="dshx:break-words dshx:font-medium" title={agent.id}>
                    {props.labels.agent(agent.id)}
                  </p>
                  <div className="dshx:mt-1 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                    <AgentStatus agent={agent} t={t} />
                    {agent.workspaceTopic === null ? null : (
                      <span className="dshx:text-xs dshx:text-muted-foreground" title={agent.workspaceTopic}>
                        {props.labels.topic(agent.workspaceTopic)}
                      </span>
                    )}
                    {agent.workspaceOptedOut ? <Badge variant="outline">{t('optedOut')}</Badge> : null}
                    {agent.workspaceSubscribed === true ? <Badge variant="secondary">{t('subscribed')}</Badge> : null}
                    {agent.workspaceTopic !== null && agent.workspaceSubscribed === undefined && !agent.workspaceOptedOut ? (
                      <Badge variant="outline">{t('unknownSubscription')}</Badge>
                    ) : null}
                  </div>
                </div>
                {agent.workspaceTopic !== null && (agent.workspaceOptedOut || agent.workspaceSubscribed === false) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={props.busy}
                    onClick={() => props.onAction({ kind: 'rejoin', agentId: agent.id, topic: agent.workspaceTopic ?? '' })}
                  >
                    {t('rejoin')}
                  </Button>
                ) : null}
                {agent.workspaceTopic !== null && !agent.workspaceOptedOut && agent.workspaceSubscribed === true ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={props.busy}
                    onClick={() => props.onAction({ kind: 'unsubscribe', agentId: agent.id, topic: agent.workspaceTopic ?? '' })}
                  >
                    {t('unsubscribe')}
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('recentActivity')}</CardTitle>
          <CardDescription>
            {t('activityHistory', { count: diagnostics.activity.retainedCount })}{' '}
            {diagnostics.activity.trackingStartedAt === null
              ? t('notTrackedYet')
              : t('trackingStarted', { time: formatTime(diagnostics.activity.trackingStartedAt) })}
          </CardDescription>
        </CardHeader>
        <CardContent className="dshx:p-0">
          <ActivityList events={diagnostics.activity.events} labels={props.labels} t={t} />
        </CardContent>
      </Card>
    </div>
  )
}

export const AgentCommunicationPanel = (props: AgentCommunicationPanelProps): JSX.Element => {
  const api = useApi(agentCommunicationApi)
  const queryClient = useQueryClient()
  const [selection, setSelection] = useState<ConversationSelection>({ kind: 'all' })
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [draftIntent, setDraftIntent] = useState<'notice' | 'request'>('notice')
  const [newTopic, setNewTopic] = useState('')
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [action, setAction] = useState<ManagementAction | null>(null)
  const [receiptCount, setReceiptCount] = useState<number | null>(null)
  const debouncedSearch = useDebouncedValue({ value: search.trim(), delayMs: 200 })
  const diagnosticsQuery = useQuery({
    queryKey: diagnosticsKey,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.diagnostics({ limit: REPORT_LIMIT }, { signal: hostSignal }) }),
    refetchInterval: 30_000,
    retry: 1,
  })
  const diagnostics = diagnosticsQuery.data
  const sessionLabel = EntityLabels.useSessionLabel(props.sessions)
  const sessionCwd = EntityLabels.useSessionCwd(props.sessions)
  const projectLabel = EntityLabels.useWorkspaceLabel(props.workspaces)
  const labels: Labels = {
    agent: sessionLabel,
    // A workspace topic hashes its folder on the Host; any agent subscribed to it knows the folder through its Session.
    topic: topic => {
      if (!topic.startsWith('workspace/')) return topic
      const member = diagnostics?.agents.find(agent => agent.workspaceTopic === topic)
      const cwd = member === undefined ? null : sessionCwd(member.id)
      if (cwd === null) return `${props.t('workspace')} · ${topic.slice('workspace/'.length, 'workspace/'.length + 8)}`
      const project = projectLabel({ path: cwd })
      return EntityLabels.isThreadWorkspace(cwd) ? `${project} · ${cwd.replace(/\/+$/u, '').split('/').at(-1) ?? ''}` : project
    },
  }
  const navigationQuery = useQuery({
    queryKey: [...browseKey, 'navigation'],
    enabled: diagnostics !== undefined,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.browseMessages({ limit: 100 }, { signal: hostSignal }) }),
    refetchInterval: 30_000,
    retry: false,
  })
  const threadAgents = new Map<string, CommunicationDiagnosticAgent | undefined>()
  for (const agent of diagnostics?.agents ?? []) threadAgents.set(agent.id, agent)
  for (const message of navigationQuery.data?.items ?? []) {
    if (message.topic !== null) continue
    if (message.sender.kind === 'agent')
      threadAgents.set(
        message.sender.id,
        diagnostics?.agents.find(agent => agent.id === message.sender.id),
      )
    for (const recipient of message.recipients) {
      if (recipient.principal.kind === 'agent')
        threadAgents.set(
          recipient.principal.id,
          diagnostics?.agents.find(agent => agent.id === recipient.principal.id),
        )
    }
  }
  const directThreads = [...threadAgents.entries()].sort(([left], [right]) => sessionLabel(left).localeCompare(sessionLabel(right)))
  const pickableAgents = [...(diagnostics?.agents ?? [])].sort((left, right) => sessionLabel(left.id).localeCompare(sessionLabel(right.id)))
  const topics = new Map<string, number>((diagnostics?.topics ?? []).map(topic => [topic.topic, topic.subscribers]))
  for (const agent of diagnostics?.agents ?? []) {
    if (agent.workspaceTopic !== null && agent.workspaceTopic !== undefined && !topics.has(agent.workspaceTopic)) topics.set(agent.workspaceTopic, 0)
  }
  for (const message of diagnostics?.recentMessages ?? []) {
    if (message.topic !== null && !topics.has(message.topic)) topics.set(message.topic, 0)
  }
  if (selection.kind === 'topic' && !topics.has(selection.topic)) topics.set(selection.topic, 0)
  // Sorted by label so a project's channel sits next to its thread workspaces' channels.
  const topicEntries = [...topics.entries()].sort(([left], [right]) => labels.topic(left).localeCompare(labels.topic(right)))
  const conversationKey = selectionKey(selection)
  const messagesQuery = useInfiniteQuery({
    queryKey: [...conversationKey, debouncedSearch],
    enabled: diagnostics !== undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const browseInput = {
        ...(selection.kind === 'topic' ? { topic: selection.topic } : {}),
        ...(selection.kind === 'direct' ? { agentId: selection.agentId } : {}),
        ...(debouncedSearch.length === 0 ? {} : { search: debouncedSearch }),
        ...(pageParam === null ? {} : { beforeId: pageParam }),
        limit: PAGE_SIZE,
      }
      return runHostRequest({ signal, request: hostSignal => api.browseMessages(browseInput, { signal: hostSignal }) })
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchInterval: 30_000,
    retry: false,
  })
  const messages =
    messagesQuery.data?.pages
      .slice()
      .reverse()
      .flatMap(page => page.items) ?? []
  const selectedMessage = messages.find(message => message.id === selectedMessageId) ?? null
  const recipientQuery = useQuery({
    queryKey: [...messageRecipientsKey, selectedMessageId],
    enabled: selectedMessageId !== null,
    queryFn: ({ signal }) => {
      if (selectedMessageId === null) throw new Error('Choose a message before loading its recipient context.')
      return runHostRequest({ signal, request: hostSignal => api.messageRecipients({ messageId: selectedMessageId }, { signal: hostSignal }) })
    },
    retry: false,
  })
  const sendMutation = useMutation({
    mutationFn: (variables: SendVariables) => runHostRequest({ request: signal => api.postMessage(variables.input, { signal }) }),
    onSuccess: async (receipt, variables) => {
      setDraft('')
      setNewTopic('')
      setReceiptCount(receipt.recipientCount)
      if (receipt.topic !== null && variables.selection.kind === 'all' && selection.kind === 'all') {
        setSelection({ kind: 'topic', topic: receipt.topic })
      }
      await queryClient.invalidateQueries({ queryKey: variables.queryKey })
      await queryClient.invalidateQueries({ queryKey: [...browseKey, 'navigation'] })
      await queryClient.invalidateQueries({ queryKey: diagnosticsKey })
    },
  })
  const managementMutation = useMutation({
    mutationFn: (request: ManagementAction) =>
      runHostRequest({
        request: async signal => {
          if (request.kind === 'unsubscribe') {
            await api.unsubscribe({ agentId: request.agentId, topic: request.topic }, { signal })
            return
          }
          await api.setSubscription({ agentId: request.agentId, topic: request.topic }, { signal })
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: diagnosticsKey })
    },
  })
  const t = props.t
  const currentTopic = selection.kind === 'topic' ? selection.topic : null
  const currentDirectAgent = selection.kind === 'direct' ? selection.agentId : null
  const currentTitle =
    currentTopic === null
      ? currentDirectAgent === null
        ? t('allConversations')
        : t('directThread', { agent: sessionLabel(currentDirectAgent) })
      : labels.topic(currentTopic)
  const legacyHost =
    diagnostics?.unnotifiedRecipientCount !== undefined || diagnostics?.subscriptions.some(subscription => subscription.delivery !== 'passive') === true
  const missingWorkspaceCount =
    diagnostics?.agents.filter(agent => agent.workspaceTopic !== null && agent.workspaceSubscribed === false && !agent.workspaceOptedOut).length ?? 0
  const actionDescription =
    action === null
      ? ''
      : action.kind === 'rejoin'
        ? t('confirmRejoin', { agent: sessionLabel(action.agentId), topic: labels.topic(action.topic) })
        : t('confirmUnsubscribe', { agent: sessionLabel(action.agentId), topic: labels.topic(action.topic) })
  const submitMessage = (): void => {
    if (draft.trim().length === 0 || sendMutation.isPending) return
    let input: AgentCommunicationPostInput
    if (selection.kind === 'topic') input = { topic: selection.topic, text: draft, intent: draftIntent }
    else if (selection.kind === 'direct') input = { agentId: selection.agentId, text: draft, intent: draftIntent }
    else {
      const topic = newTopic.trim()
      if (topic.length === 0) return
      input = { topic, text: draft, intent: draftIntent }
    }
    setReceiptCount(null)
    sendMutation.mutate({ input, selection, queryKey: conversationKey })
  }
  const changeSelection = (next: ConversationSelection): void => {
    setSelection(next)
    setSelectedMessageId(null)
    setDraft('')
    setDraftIntent('notice')
    setNewTopic('')
    setReceiptCount(null)
    sendMutation.reset()
  }

  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-4 dshx:p-3 dshx:sm:p-5">
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3">
        <div>
          <h1 className="dshx:text-xl dshx:font-semibold">{t('title')}</h1>
          <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">{t('noTurnGuarantee')}</p>
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <Badge variant={diagnostics !== undefined && diagnosticsQuery.error === null ? 'secondary' : 'destructive'}>
            {diagnostics !== undefined && diagnosticsQuery.error === null ? t('connected') : t('unavailable')}
          </Badge>
          <Button variant="outline" size="sm" disabled={diagnosticsQuery.isFetching} onClick={() => void diagnosticsQuery.refetch()}>
            <RefreshCwIcon aria-hidden /> {t('refresh')}
          </Button>
        </div>
      </header>

      {diagnosticsQuery.isPending ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('loading')}</p> : null}
      {diagnosticsQuery.error !== null ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(diagnosticsQuery.error, t('loadFailed'))}</AlertDescription>
        </Alert>
      ) : null}
      {diagnostics === undefined ? null : (
        <>
          {legacyHost ? (
            <Alert variant="destructive">
              <AlertDescription>{t('legacyHostWarning')}</AlertDescription>
            </Alert>
          ) : null}
          <Tabs defaultValue="messages">
            <TabsList>
              <TabsTrigger value="messages">{t('messages')}</TabsTrigger>
              <TabsTrigger value="diagnostics">{t('diagnostics')}</TabsTrigger>
            </TabsList>
            <TabsContent value="messages">
              <div className="dshx:grid dshx:gap-3 dshx:xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
                <Card className="dshx:min-w-0">
                  <CardHeader className="dshx:pb-3">
                    <CardTitle className="dshx:flex dshx:items-center dshx:gap-2">
                      <HashIcon aria-hidden /> {t('channels')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="dshx:flex dshx:flex-col dshx:gap-4 dshx:p-3 dshx:pt-0">
                    <Button
                      variant={selection.kind === 'all' ? 'secondary' : 'ghost'}
                      disabled={sendMutation.isPending}
                      className="dshx:justify-start"
                      onClick={() => changeSelection({ kind: 'all' })}
                    >
                      <MessageSquareIcon aria-hidden /> {t('allConversations')}
                    </Button>
                    <div className="dshx:flex dshx:flex-col dshx:gap-1">
                      <p className="dshx:px-2 dshx:text-xs dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">{t('channels')}</p>
                      {topicEntries.length === 0 ? <p className="dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground">{t('noTopics')}</p> : null}
                      {topicEntries.map(([topic, subscribers]) => (
                        <Button
                          key={topic}
                          variant={selection.kind === 'topic' && selection.topic === topic ? 'secondary' : 'ghost'}
                          disabled={sendMutation.isPending}
                          className="dshx:min-w-0 dshx:justify-start"
                          onClick={() => changeSelection({ kind: 'topic', topic })}
                        >
                          <HashIcon aria-hidden />
                          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left" title={topic}>
                            {labels.topic(topic)}
                          </span>
                          <span className="dshx:text-xs dshx:text-muted-foreground">{subscribers}</span>
                        </Button>
                      ))}
                    </div>
                    <Separator />
                    <div className="dshx:flex dshx:flex-col dshx:gap-1">
                      <p className="dshx:px-2 dshx:text-xs dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">
                        {t('directMessages')}
                      </p>
                      <Select
                        disabled={pickableAgents.length === 0 || sendMutation.isPending}
                        onValueChange={agentId => changeSelection({ kind: 'direct', agentId })}
                        value={selection.kind === 'direct' ? selection.agentId : ''}
                      >
                        <SelectTrigger aria-label={t('chooseAgent')} className="dshx:mx-1 dshx:w-[calc(100%-0.5rem)]" size="sm">
                          <SelectValue placeholder={t('chooseAgent')} />
                        </SelectTrigger>
                        <SelectContent>
                          {pickableAgents.map(agent => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {sessionLabel(agent.id)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {directThreads.length === 0 ? (
                        <p className="dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground">{t('noDirectThreads')}</p>
                      ) : null}
                      {directThreads.map(([agentId, agent]) => (
                        <Button
                          key={agentId}
                          variant={selection.kind === 'direct' && selection.agentId === agentId ? 'secondary' : 'ghost'}
                          disabled={sendMutation.isPending}
                          className="dshx:min-w-0 dshx:justify-start"
                          onClick={() => changeSelection({ kind: 'direct', agentId })}
                        >
                          <MessageSquareIcon aria-hidden />
                          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left" title={agentId}>
                            {sessionLabel(agentId)}
                          </span>
                          {/* A dot, not a badge: the 15rem column needs its width for the thread title. */}
                          <span
                            aria-label={agent === undefined ? t('offlineUnknown') : agent.status === 'running' ? t('running') : t('idle')}
                            className={cn(
                              'dshx:size-2 dshx:shrink-0 dshx:rounded-full',
                              agent === undefined
                                ? 'dshx:border dshx:border-muted-foreground'
                                : agent.status === 'running'
                                  ? 'dshx:bg-success'
                                  : 'dshx:bg-muted-foreground/50',
                            )}
                            role="img"
                            title={agent === undefined ? t('offlineUnknown') : agent.status === 'running' ? t('running') : t('idle')}
                          />
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="dshx:min-w-0">
                  <CardHeader className="dshx:gap-3 dshx:sm:flex-row dshx:sm:items-center dshx:sm:justify-between">
                    <div className="dshx:min-w-0">
                      <CardTitle className="dshx:truncate">{currentTitle}</CardTitle>
                      <CardDescription>{t('messageCount', { count: messagesQuery.data?.pages[0]?.totalMatching ?? 0 })}</CardDescription>
                    </div>
                    <div className="dshx:relative dshx:w-full dshx:sm:max-w-xs">
                      <SearchIcon className="dshx:absolute dshx:left-2.5 dshx:top-2.5 dshx:size-4 dshx:text-muted-foreground" aria-hidden />
                      <Input
                        aria-label={t('search')}
                        placeholder={t('searchPlaceholder')}
                        value={search}
                        onChange={event => setSearch(event.currentTarget.value)}
                        className="dshx:pl-8"
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="dshx:flex dshx:flex-col dshx:gap-3 dshx:p-3 dshx:pt-0">
                    {messagesQuery.isPending ? <p className="dshx:p-3 dshx:text-sm dshx:text-muted-foreground">{t('loading')}</p> : null}
                    {messagesQuery.error !== null ? (
                      <Alert variant="destructive">
                        <AlertDescription>
                          {errorMessage(messagesQuery.error, t('browseUnavailable'))} {t('hostRestartHint')}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {messagesQuery.data !== undefined && messages.length === 0 ? (
                      <p className="dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{debouncedSearch.length > 0 ? t('noSearchResults') : t('noMessages')}</p>
                    ) : null}
                    <div className="dshx:flex dshx:max-h-[65vh] dshx:flex-col dshx:gap-3 dshx:overflow-y-auto dshx:p-1">
                      {messages.map(message => (
                        <MessageRow
                          key={message.id}
                          message={message}
                          selected={selectedMessageId === message.id}
                          labels={labels}
                          t={t}
                          onSelect={messageId => setSelectedMessageId(current => (current === messageId ? null : messageId))}
                          onOpenDirect={agentId => changeSelection({ kind: 'direct', agentId })}
                          disabled={sendMutation.isPending}
                        />
                      ))}
                    </div>
                    {messagesQuery.hasNextPage ? (
                      <Button variant="outline" disabled={messagesQuery.isFetchingNextPage} onClick={() => void messagesQuery.fetchNextPage()}>
                        {messagesQuery.isFetchingNextPage ? t('loadingOlder') : t('loadOlder')}
                      </Button>
                    ) : null}
                    <form
                      className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:border-border dshx:pt-3"
                      onSubmit={event => {
                        event.preventDefault()
                        submitMessage()
                      }}
                    >
                      {selection.kind === 'all' ? (
                        <Input
                          aria-label={t('topicName')}
                          placeholder={t('newChannel')}
                          value={newTopic}
                          maxLength={128}
                          disabled={sendMutation.isPending}
                          onChange={event => setNewTopic(event.currentTarget.value)}
                        />
                      ) : null}
                      <Textarea
                        aria-label={t('composePlaceholder')}
                        placeholder={t('composePlaceholder')}
                        value={draft}
                        maxLength={12_000}
                        disabled={sendMutation.isPending}
                        onChange={event => setDraft(event.currentTarget.value)}
                        onKeyDown={event => {
                          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitMessage()
                        }}
                        className="dshx:min-h-24 dshx:resize-y"
                      />
                      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                        <span className="dshx:text-xs dshx:text-muted-foreground">{t('intent')}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant={draftIntent === 'notice' ? 'secondary' : 'outline'}
                          aria-pressed={draftIntent === 'notice'}
                          disabled={sendMutation.isPending}
                          onClick={() => setDraftIntent('notice')}
                        >
                          {t('notice')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={draftIntent === 'request' ? 'secondary' : 'outline'}
                          aria-pressed={draftIntent === 'request'}
                          disabled={sendMutation.isPending}
                          onClick={() => setDraftIntent('request')}
                        >
                          {t('request')}
                        </Button>
                      </div>
                      <p className="dshx:text-xs dshx:text-muted-foreground">{t('intentHint')}</p>
                      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
                        <p className="dshx:text-xs dshx:text-muted-foreground">
                          {selection.kind === 'topic'
                            ? t('sendToTopic', { topic: labels.topic(selection.topic) })
                            : selection.kind === 'direct'
                              ? t('sendToAgent', { agent: sessionLabel(selection.agentId) })
                              : t('newChannel')}
                        </p>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={draft.trim().length === 0 || sendMutation.isPending || (selection.kind === 'all' && newTopic.trim().length === 0)}
                        >
                          <SendIcon aria-hidden /> {sendMutation.isPending ? t('sending') : t('send')}
                        </Button>
                      </div>
                      {sendMutation.error !== null ? (
                        <Alert variant="destructive">
                          <AlertDescription>{errorMessage(sendMutation.error, t('sendFailed'))}</AlertDescription>
                        </Alert>
                      ) : null}
                      {receiptCount === null ? null : (
                        <p role="status" className="dshx:text-xs dshx:text-muted-foreground">
                          {t('sendReceipt', { count: receiptCount })}
                        </p>
                      )}
                    </form>
                  </CardContent>
                </Card>

                <Card className="dshx:min-w-0">
                  <CardHeader>
                    <CardTitle>{t('messageContext')}</CardTitle>
                    <CardDescription>
                      {selectedMessage === null ? currentTitle : `${selectedMessage.id.slice(0, 8)} · ${formatTime(selectedMessage.createdAt)}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="dshx:flex dshx:flex-col dshx:gap-3">
                    {selectedMessage === null ? (
                      <p className="dshx:text-sm dshx:text-muted-foreground">{t('selectConversation')}</p>
                    ) : (
                      <>
                        <div>
                          <p className="dshx:text-xs dshx:text-muted-foreground">{t('sender')}</p>
                          <p className="dshx:break-all dshx:text-sm dshx:font-medium">{principalLabel(selectedMessage.sender, labels, t)}</p>
                        </div>
                        <div>
                          <p className="dshx:text-xs dshx:text-muted-foreground">{t('topic')}</p>
                          <p className="dshx:break-all dshx:text-sm">{selectedMessage.topic ?? t('directMessages')}</p>
                        </div>
                        <div>
                          <p className="dshx:text-xs dshx:text-muted-foreground">{t('intent')}</p>
                          <Badge variant={selectedMessage.intent === 'request' ? 'default' : 'outline'}>
                            {selectedMessage.intent === 'request' ? t('request') : t('notice')}
                          </Badge>
                        </div>
                        <div>
                          <p className="dshx:text-xs dshx:text-muted-foreground">{t('priority')}</p>
                          <Badge variant={selectedMessage.priority === 'urgent' ? 'destructive' : 'outline'}>
                            {selectedMessage.priority === 'urgent' ? t('urgent') : t('normal')}
                          </Badge>
                        </div>
                        <Separator />
                        <p className="dshx:text-sm dshx:font-medium">{t('recipientDetails')}</p>
                        {recipientQuery.isPending ? <p className="dshx:text-xs dshx:text-muted-foreground">{t('loading')}</p> : null}
                        {recipientQuery.error !== null ? (
                          <Alert variant="destructive">
                            <AlertDescription>{errorMessage(recipientQuery.error, t('loadFailed'))}</AlertDescription>
                          </Alert>
                        ) : null}
                        {recipientQuery.data?.recipients.map(recipient => (
                          <div
                            key={`${recipient.principal.kind}:${recipient.principal.id}`}
                            className="dshx:flex dshx:flex-col dshx:gap-1 dshx:border-t dshx:border-border dshx:pt-2"
                          >
                            <span className="dshx:break-all dshx:text-sm">
                              {recipient.principal.kind === 'agent' ? sessionLabel(recipient.principal.id) : recipient.principal.id}
                            </span>
                            <span className="dshx:text-xs dshx:text-muted-foreground">
                              {recipient.readAt === null ? t('notRead') : t('readAt', { time: formatTime(recipient.readAt) })}
                            </span>
                            <Badge className="dshx:w-fit" variant={recipient.acknowledgedAt === null ? 'outline' : 'secondary'}>
                              {recipient.acknowledgedAt === null ? t('pending') : t('acknowledged')}
                            </Badge>
                          </div>
                        ))}
                        {recipientQuery.data?.recipients.length === 0 ? (
                          <p className="dshx:text-xs dshx:text-muted-foreground">{t('noRecipientDetails')}</p>
                        ) : null}
                        {selectedMessage.sender.kind === 'agent' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={sendMutation.isPending}
                            onClick={() => changeSelection({ kind: 'direct', agentId: selectedMessage.sender.id })}
                          >
                            <MessageSquareIcon aria-hidden /> {t('directMessages')}
                          </Button>
                        ) : null}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="diagnostics">
              <div className="dshx:flex dshx:flex-col dshx:gap-3">
                <p className="dshx:text-sm dshx:text-muted-foreground">{t('noTurnGuarantee')}</p>
                {missingWorkspaceCount > 0 ? (
                  <Alert variant="destructive">
                    <AlertDescription>{t('missingWorkspaceSubscriptions', { count: missingWorkspaceCount })}</AlertDescription>
                  </Alert>
                ) : null}
                <DiagnosticPanel
                  data={diagnostics}
                  labels={labels}
                  t={t}
                  busy={managementMutation.isPending}
                  onAction={nextAction => {
                    managementMutation.reset()
                    setAction(nextAction)
                  }}
                />
                {managementMutation.error !== null ? (
                  <Alert variant="destructive">
                    <AlertDescription>{errorMessage(managementMutation.error, t('loadFailed'))}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </TabsContent>
          </Tabs>
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
            <AlertDialogTitle>{t('confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{actionDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <Separator />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={managementMutation.isPending} onClick={() => setAction(null)}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={managementMutation.isPending}
              variant={action?.kind === 'unsubscribe' ? 'destructive' : 'default'}
              onClick={event => {
                event.preventDefault()
                if (action === null) return
                managementMutation.mutate(action, { onSuccess: () => setAction(null) })
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

import { randomUUID } from 'node:crypto'
import * as Schema from 'effect/Schema'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ModelSelection, SessionController, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'

import { SessionId } from '@deepseek-ai/dsh-session'
import { ScheduleId, type ScheduleCatalogEntry, type ScheduleRecord, type ScheduleService } from '@deepseek-ai/dsh-schedule'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { SessionActivity } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import { AiAccountsSchema } from './effect-schema.js'
import { quotaContinuationDomain, type QuotaContinuationTable } from './quota-continuation-store.js'
import type { QuotaContinuationRecord, QuotaContinuationSummary } from './quota-continuation-model.js'
import { QuotaContinuationMessage, type UserActivityIdentity } from './quota-continuation-message.js'
import { isActive, transition } from './quota-continuation-transition.js'
import { quotaRetryAt } from './quota-retry-backoff.js'
import { resetAtFromMessage } from './quota-reset.js'

const MAX_CONTINUATIONS = 500
const CONTINUATION_RETENTION_MS = 30 * 24 * 60 * 60_000
const AUTO_RESUME_DELAY_MS = 60_000
const SCHEDULE_PAGE_SIZE = 500
const SNOOZE_MS = {
  'one-hour': 60 * 60_000,
  'four-hours': 4 * 60 * 60_000,
  'one-day': 24 * 60 * 60_000,
} as const

type QuotaContinuationDomain = Domain<typeof quotaContinuationDomain>
type SchedulePort = Pick<ScheduleService, 'create' | 'edit' | 'list'>
type SessionControllerService = SessionController
type SessionListItems = Awaited<ReturnType<SessionControllerService['list']>>['items']
type SessionWireEvent = Awaited<ReturnType<SessionControllerService['events']>>['records'][number]['event']
type SessionControllerPort = {
  events: SessionControllerService['events']
  prompt: SessionControllerService['prompt']
  list?: SessionControllerService['list']
  selectModel?: SessionControllerService['selectModel']
}
type AgentUserMessage = Agent['inbox']['nextTurn'][number]
type QuotaFailureAgent = {
  readonly id: Agent['id']
  readonly session: {
    readonly seq: number
    readonly header?: { readonly origin?: 'subagent' }
    readonly ownEvents?: () => readonly { readonly type: string; readonly seq: number; readonly data?: unknown }[]
  }
  readonly inbox: Pick<Agent['inbox'], 'nextTurn' | 'nextStep'>
}
type SessionUserActivity = {
  readonly seq: number
  readonly continuationId: string | null
  readonly queueSource: 'manual' | 'schedule' | null
}
type SnoozeDuration = keyof typeof SNOOZE_MS | 'unsnooze'
type ServiceOptions = {
  readonly context: Context
  readonly readResetAt: (accountId: string) => Promise<number | null>
  readonly schedule?: SchedulePort
  readonly sessionController?: SessionControllerPort
  readonly archivedSessionIds?: () => readonly string[]
  readonly now?: () => number
}
type QuotaContinuationService = {
  start(): () => void
  close(): Promise<void>
  list(): Promise<{ scheduleAvailable: boolean; continuations: QuotaContinuationSummary[] }>
  recordFailure(
    agent: QuotaFailureAgent,
    accountId: string,
    autoRetry: boolean,
    failedSelection?: Pick<ModelSelection, 'provider' | 'model'>,
    failureMessage?: string,
  ): Promise<void>
  resume(continuationId: string, selection?: ModelSelection): Promise<{ accepted: boolean }>
  setAutoRetry(continuationId: string, sessionId: string, enabled: boolean): Promise<{ updated: boolean }>
  snooze(continuationId: string, duration: SnoozeDuration): Promise<{ updated: boolean }>
  dismiss(continuationId: string): Promise<{ dismissed: boolean }>
}

declare module '@deepseek-ai/dsh-workspace/types' {
  interface SessionActivityKindMap {
    'quota-continuation': true
  }
}

const isReady = (record: QuotaContinuationRecord, now: number): boolean => {
  const dueAt = record.resetAt ?? record.retryAt
  return dueAt !== null && Math.max(dueAt, record.snoozedUntil ?? 0) <= now
}

const collectUserActivities = <Event extends { readonly seq: number }>(
  events: readonly Event[],
  activityForEvent: (event: Event) => UserActivityIdentity | undefined,
): SessionUserActivity[] => {
  const activities: SessionUserActivity[] = []
  for (const event of events) {
    const activity = activityForEvent(event)
    if (activity !== undefined) activities.push({ seq: event.seq, ...activity })
  }
  return activities
}

const hasNewerUserWork = (record: QuotaContinuationRecord, activities: readonly SessionUserActivity[]): boolean =>
  activities.some(activity => activity.seq >= record.failedSeq && activity.continuationId !== record.continuationId)

const completedTurnEnd = Schema.Struct({ reason: Schema.Struct({ kind: Schema.Literal('completed') }) })

const userMessageData = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })),
  source: Schema.Struct({ kind: Schema.String, rpcId: Schema.optionalKey(Schema.Unknown) }),
})

const wireUserActivity = (event: SessionWireEvent): UserActivityIdentity | undefined => {
  if (event.type !== 'user/message') return undefined
  const message = AiAccountsSchema.decodeResult(userMessageData, event.data)
  return message._tag === 'Success' ? QuotaContinuationMessage.userActivityForMessage(message.success) : undefined
}

/** Reads the Session log backwards until it covers `sinceSeq`, without activating a cold Session. */
const userActivitiesSince = async (
  controller: Pick<SessionControllerPort, 'events'>,
  sessionId: SessionId,
  sinceSeq: number,
  signal: AbortSignal,
): Promise<SessionUserActivity[]> => {
  const activities: SessionUserActivity[] = []
  let beforeSeq: number | undefined
  for (;;) {
    const address = { kind: 'session', sessionId } as const
    const page = await controller.events(beforeSeq === undefined ? { address } : { address, beforeSeq }, signal)
    const events = page.records.map(record => record.event)
    activities.push(...collectUserActivities(events, wireUserActivity))
    const oldest = events[0]
    if (!page.hasMore || oldest === undefined || oldest.seq <= sinceSeq) return activities
    beforeSeq = oldest.seq
  }
}

/** Whether a turn finished normally after `seq`: then the work the recovery stood for is done and it is not taken up again. */
const turnCompletedSince = (agent: Pick<QuotaFailureAgent, 'session'>, seq: number): boolean => {
  const events = agent.session.ownEvents?.()
  if (events === undefined) return true
  return events.some(event => event.type === 'turn/end' && event.seq > seq && AiAccountsSchema.decodeResult(completedTurnEnd, event.data)._tag === 'Success')
}

/**
 * The thread's one recovery a new failure takes up instead of opening another: the pending one, or the latest one
 * newer work overtook while no turn has completed since. A dismissed, stopped or finished recovery is never reused.
 */
const reusableRecovery = (
  agent: Pick<QuotaFailureAgent, 'id' | 'session'>,
  records: readonly QuotaContinuationRecord[],
): QuotaContinuationRecord | undefined => {
  const latest = records.filter(record => record.sessionId === agent.id).sort((left, right) => right.failedAt - left.failedAt)[0]
  if (latest === undefined) return undefined
  if (isActive(latest)) return latest
  if (latest.state === 'invalidated' && latest.overtaken === true && !turnCompletedSince(agent, latest.failedSeq)) return latest
  return undefined
}

/** A subagent's stopped turn is not a recovery the user can resume: its parent thread is the one they continue. */
const isSubagentSession = (agent: Pick<QuotaFailureAgent, 'session'>): boolean => agent.session.header?.origin === 'subagent'

const snoozeUntil = (duration: SnoozeDuration, now: number): number | null => (duration === 'unsnooze' ? null : now + SNOOZE_MS[duration])

const requestIdFor = (continuationId: string): SessionRequestId => {
  // SAFETY: SessionRequestId is a type-only opaque brand; this persisted UUID is its stable identity.
  return continuationId as SessionRequestId
}

const scheduleIdFor = (scheduleId: string): ScheduleRecord['id'] => {
  return ScheduleId(scheduleId)
}

const createQuotaContinuationService = ({
  context,
  readResetAt,
  schedule: scheduleOverride,
  sessionController: sessionControllerOverride,
  archivedSessionIds: readArchivedSessionIds = () => context.workspaceRegistry?.archivedSessionIds.map(String) ?? [],
  now = Date.now,
}: ServiceOptions): QuotaContinuationService => {
  let domainOpening: Promise<QuotaContinuationDomain> | undefined
  const perAgent = new Map<string, () => void>()
  const sessionChains = new Map<string, Promise<void>>()
  let started = false

  const schedule = (): SchedulePort | undefined => scheduleOverride ?? context.get('schedule')
  const sessionController = (): SessionControllerPort | undefined => sessionControllerOverride ?? context.get('sessionController')

  const domain = (): Promise<QuotaContinuationDomain> => {
    if (domainOpening !== undefined) return domainOpening
    const opening = context.storageDomain.open(quotaContinuationDomain)
    domainOpening = opening
    void opening.catch(() => {
      if (domainOpening === opening) domainOpening = undefined
    })
    return opening
  }

  const table = async (): Promise<QuotaContinuationTable> => (await domain()).table('continuations')

  const serialize = <T>(sessionId: string, action: () => Promise<T>): Promise<T> => {
    const previous = sessionChains.get(sessionId) ?? Promise.resolve()
    const current = previous.then(action, action)
    // The chain forgets itself once it settles, unless a later action already extended it.
    const forget = (): void => {
      if (sessionChains.get(sessionId) === settled) sessionChains.delete(sessionId)
    }
    const settled: Promise<void> = current.then(forget, forget)
    sessionChains.set(sessionId, settled)
    return current
  }

  const allRecords = async (): Promise<QuotaContinuationRecord[]> => [...(await table()).entries()].map(([, record]) => record)

  const makeRoom = async (records: readonly QuotaContinuationRecord[], now: number): Promise<boolean> => {
    const storage = await table()
    const expired = records
      .filter(record => !isActive(record) && now - record.failedAt >= CONTINUATION_RETENTION_MS)
      .sort((left, right) => left.failedAt - right.failedAt)
    for (const record of expired) {
      if (storage.size < MAX_CONTINUATIONS) return true
      await storage.delete(record.continuationId)
    }
    if (storage.size < MAX_CONTINUATIONS) return true

    const retired = records.filter(record => !isActive(record)).sort((left, right) => left.failedAt - right.failedAt)
    for (const record of retired) {
      if (storage.size < MAX_CONTINUATIONS) return true
      await storage.delete(record.continuationId)
    }
    return storage.size < MAX_CONTINUATIONS
  }

  const activeSchedules = async (scheduler: SchedulePort): Promise<ScheduleCatalogEntry[]> => {
    const items: ScheduleCatalogEntry[] = []
    for (;;) {
      const page = await scheduler.list({ active: true, limit: SCHEDULE_PAGE_SIZE, offset: items.length })
      items.push(...page.items)
      if (page.shown === 0 || items.length >= page.total) return items
    }
  }

  const scheduleMatches = async (record: QuotaContinuationRecord): Promise<ScheduleCatalogEntry[]> => {
    const scheduler = schedule()
    if (scheduler === undefined) return []
    const prompt = QuotaContinuationMessage.promptFor(record.continuationId)
    return (await activeSchedules(scheduler)).filter(
      task => task.target.kind === 'session' && task.target.sessionId === record.sessionId && task.prompt === prompt,
    )
  }

  const deleteSchedule = async (scheduler: SchedulePort, id: ScheduleRecord['id']): Promise<void> => {
    await scheduler.edit({ id, action: 'delete' })
  }

  const cancelScheduled = async (record: QuotaContinuationRecord): Promise<void> => {
    const scheduler = schedule()
    if (scheduler === undefined) return
    try {
      const matches = await scheduleMatches(record)
      const ids = new Set(matches.map(task => task.id))
      if (record.scheduleId !== null) ids.add(scheduleIdFor(record.scheduleId))
      await Promise.all([...ids].map(id => deleteSchedule(scheduler, id)))
    } catch (error) {
      context.logger.warn(`ai-accounts: could not remove a stale quota recovery schedule: ${String(error)}`)
    }
  }

  const ensureScheduled = async (record: QuotaContinuationRecord): Promise<void> => {
    if (record.state !== 'waiting') return
    const dueAt = record.resetAt ?? record.retryAt
    if (!record.autoRetry || dueAt === null) {
      await cancelScheduled(record)
      if (record.scheduleId !== null) {
        const storage = await table()
        await storage.update(record.continuationId, current => (current.state === 'waiting' ? { ...current, scheduleId: null } : current))
      }
      return
    }
    const scheduler = schedule()
    if (scheduler === undefined) {
      context.logger.warn('ai-accounts: automatic quota recovery has no Schedule service to queue on')
      return
    }
    try {
      const matches = await scheduleMatches(record)
      const existing = matches[0]
      if (existing !== undefined) {
        await Promise.all(matches.slice(1).map(task => deleteSchedule(scheduler, task.id)))
        const storage = await table()
        await storage.update(record.continuationId, current => (current.state === 'waiting' ? { ...current, scheduleId: existing.id } : current))
        return
      }

      // A known reset keeps the one-minute grace the user was promised; a backoff rung is due exactly when it says.
      const marginMs = record.resetAt === null ? 0 : AUTO_RESUME_DELAY_MS
      const scheduledAt = Math.max(dueAt, record.snoozedUntil ?? 0, now()) + marginMs
      const afterSeconds = Math.max(1, Math.ceil((scheduledAt - now()) / 1_000))
      const created = await scheduler.create({
        title: 'Quota recovery',
        prompt: QuotaContinuationMessage.promptFor(record.continuationId),
        timing: { kind: 'after', after_seconds: afterSeconds },
        target: { kind: 'session', sessionId: SessionId(record.sessionId) },
      })
      const storage = await table()
      await storage.update(record.continuationId, current => (current.state === 'waiting' ? { ...current, scheduleId: created.id } : current))
      const current = storage.get(record.continuationId)
      if (current?.state !== 'waiting') await deleteSchedule(scheduler, created.id)
    } catch (error) {
      context.logger.warn(`ai-accounts: automatic quota recovery could not be scheduled: ${String(error)}`)
    }
  }

  const invalidate = async (record: QuotaContinuationRecord, cause: 'newerWork' | 'dropped' = 'dropped'): Promise<void> => {
    if (!isActive(record)) return
    const storage = await table()
    await storage.update(record.continuationId, current => transition(current, { kind: cause }))
    await cancelScheduled(record)
  }

  const summary = (record: QuotaContinuationRecord, now: number, scheduleAvailable: boolean): QuotaContinuationSummary => {
    const value: QuotaContinuationSummary = {
      continuationId: record.continuationId,
      sessionId: record.sessionId,
      accountId: record.accountId,
      failedAt: record.failedAt,
      resetAt: record.resetAt,
      retryAt: record.retryAt,
      retryAttempt: record.retryAttempt,
      autoRetry: record.autoRetry,
      snoozedUntil: record.snoozedUntil,
      state: record.state === 'queued' ? 'queued' : 'waiting',
      scheduled: scheduleAvailable && record.scheduleId !== null,
      ready: isReady(record, now),
    }
    const withProvider = record.failedProvider === undefined ? value : { ...value, failedProvider: record.failedProvider }
    return record.failedModel === undefined ? withProvider : { ...withProvider, failedModel: record.failedModel }
  }

  const activeForSession = async (sessionId: string): Promise<QuotaContinuationRecord[]> =>
    (await allRecords()).filter(record => record.sessionId === sessionId && isActive(record))

  const isQueuedExternalWork = (agent: Pick<QuotaFailureAgent, 'inbox'>): boolean =>
    [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => QuotaContinuationMessage.continuationIdOf(message) === null)

  const reconcileAgent = async (agent: Agent): Promise<void> => {
    const sessionId = agent.id
    await serialize(sessionId, async () => {
      const records = await activeForSession(sessionId)
      const events = agent.session.ownEvents()
      const activities = collectUserActivities(events, event =>
        event.type === 'user/message' ? QuotaContinuationMessage.userActivityForMessage(event.data) : undefined,
      )
      for (const record of records) {
        if (hasNewerUserWork(record, activities) || isQueuedExternalWork(agent)) {
          await invalidate(record, 'newerWork')
          for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
            if (QuotaContinuationMessage.continuationIdOf(message) === record.continuationId) agent.inbox.remove(message.id)
          }
          continue
        }

        const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].filter(
          message => QuotaContinuationMessage.continuationIdOf(message) === record.continuationId,
        )
        for (const message of pending) {
          if (record.queueSource === 'manual' && String(message.source.kind) === 'schedule') agent.inbox.remove(message.id)
        }
        const continuationInInbox = pending.some(message => !(record.queueSource === 'manual' && String(message.source.kind) === 'schedule'))
        const continuationInHistory = activities.find(activity => activity.seq >= record.failedSeq && activity.continuationId === record.continuationId)
        if (continuationInInbox) {
          const queuedMessage = pending.find(message => !(record.queueSource === 'manual' && String(message.source.kind) === 'schedule'))
          const storage = await table()
          await storage.update(record.continuationId, current =>
            transition(current, {
              kind: 'queued',
              queueSource: queuedMessage === undefined ? null : QuotaContinuationMessage.userActivityForMessage(queuedMessage).queueSource,
            }),
          )
          await cancelScheduled(record)
          continue
        }
        if (continuationInHistory !== undefined) {
          const storage = await table()
          await storage.update(record.continuationId, current => transition(current, { kind: 'ranInHistory' }))
          continue
        }
        if (record.state === 'queued') {
          const storage = await table()
          const waiting = await storage.update(record.continuationId, current =>
            current.state === 'queued' ? transition(current, { kind: 'notReady' }) : current,
          )
          await ensureScheduled(waiting)
          continue
        }
        await ensureScheduled(record)
      }
    })
  }

  const handleInserted = (agent: Agent, message: AgentUserMessage): void => {
    void serialize(agent.id, async () => {
      const records = await activeForSession(agent.id)
      const continuationId = QuotaContinuationMessage.continuationIdOf(message)
      if (continuationId !== null) {
        const record = records.find(item => item.continuationId === continuationId)
        const isScheduledMessage = String(message.source.kind) === 'schedule'
        if (record === undefined || record.state === 'invalidated' || record.state === 'completed') {
          if (isScheduledMessage) agent.inbox.remove(message.id)
          return
        }
        const activities = collectUserActivities(agent.session.ownEvents(), event =>
          event.type === 'user/message' ? QuotaContinuationMessage.userActivityForMessage(event.data) : undefined,
        )
        if (hasNewerUserWork(record, activities)) {
          await invalidate(record, 'newerWork')
          if (isScheduledMessage) agent.inbox.remove(message.id)
          return
        }
        if (isScheduledMessage && !isReady(record, now())) {
          agent.inbox.remove(message.id)
          await ensureScheduled(record)
          return
        }
        if (isScheduledMessage && record.queueSource === 'manual') {
          agent.inbox.remove(message.id)
          return
        }
        const storage = await table()
        await storage.update(record.continuationId, current => transition(current, { kind: 'queued', queueSource: isScheduledMessage ? 'schedule' : 'manual' }))
        return
      }

      for (const record of records) {
        await invalidate(record, 'newerWork')
        for (const pending of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
          if (QuotaContinuationMessage.continuationIdOf(pending) === record.continuationId) agent.inbox.remove(pending.id)
        }
      }
    }).catch(() => context.logger.warn('ai-accounts: quota recovery could not reconcile new Session work'))
  }

  const preStep = async (agent: Agent, messages: readonly AgentUserMessage[], next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const originalIds = new Map<AgentUserMessage['id'], string>()
    for (const message of messages) {
      const continuationId = QuotaContinuationMessage.continuationIdOf(message)
      if (continuationId !== null) originalIds.set(message.id, continuationId)
    }
    if (originalIds.size === 0) return decision

    const kept: AgentUserMessage[] = []
    const competingWork = isQueuedExternalWork(agent) || decision.messages.some(message => QuotaContinuationMessage.continuationIdOf(message) === null)
    for (const message of decision.messages) {
      const continuationId = originalIds.get(message.id) ?? QuotaContinuationMessage.continuationIdOf(message)
      if (continuationId === null) {
        kept.push(message)
        continue
      }

      try {
        const storage = await table()
        const record = storage.get(continuationId)
        const isScheduleMessage = String(message.source.kind) === 'schedule'
        if (record === undefined || record.sessionId !== agent.id || !isActive(record)) continue

        const activities = collectUserActivities(agent.session.ownEvents(), event =>
          event.type === 'user/message' ? QuotaContinuationMessage.userActivityForMessage(event.data) : undefined,
        )
        const newerWork = competingWork || hasNewerUserWork(record, activities)
        const notReady = isScheduleMessage && !isReady(record, now())
        const competingManual = isScheduleMessage && record.queueSource === 'manual'
        if (newerWork) await invalidate(record, 'newerWork')
        if (newerWork || notReady || competingManual) {
          if (notReady && !newerWork && !competingManual) {
            const updated = await storage.update(record.continuationId, current => transition(current, { kind: 'notReady' }))
            await ensureScheduled(updated)
          }
          continue
        }

        await storage.update(record.continuationId, current => transition(current, { kind: 'ranInHistory' }))
        kept.push(message)
      } catch (error) {
        context.logger.warn(`ai-accounts: quota recovery failed closed before a Session step: ${String(error)}`)
        continue
      }
    }

    if (kept.length === 0) return { kind: 'reject' }
    return { ...decision, messages: kept }
  }

  const attachAgent = async (agent: Agent, source: 'startup' | 'resume' | 'clear' | 'compact'): Promise<void> => {
    perAgent.get(agent.id)?.()
    const dispose = agent.ctx.effect(() => {
      const offInserted = agent.ctx.on('agent/inbox/inserted', ({ message }) => handleInserted(agent, message))
      const offPreStep = agent.ctx.on('agent/pre-step', ({ messages }, next) => preStep(agent, messages, next))
      return () => {
        offInserted()
        offPreStep()
      }
    })
    perAgent.set(agent.id, dispose)
    try {
      if (source === 'clear' || source === 'compact') await stopSession(agent.id)
      else await reconcileAgent(agent)
    } catch (error) {
      context.logger.warn(`ai-accounts: quota recovery could not reconcile a restored Session: ${String(error)}`)
    }
  }

  const recordFailure = async (
    agent: QuotaFailureAgent,
    accountId: string,
    autoRetry: boolean,
    failedSelection?: Pick<ModelSelection, 'provider' | 'model'>,
    failureMessage?: string,
  ): Promise<void> => {
    try {
      if (isSubagentSession(agent)) return
      const nowAtFailure = now()
      const resetAt = (await readResetAt(accountId).catch(() => null)) ?? resetAtFromMessage(failureMessage ?? '', nowAtFailure)
      await serialize(agent.id, async () => {
        const storage = await table()
        const reused = reusableRecovery(agent, await allRecords())
        const oldRecords = [...storage.entries()]
          .map(([, record]) => record)
          .filter(record => record.sessionId === agent.id && isActive(record) && record.continuationId !== reused?.continuationId)
        for (const oldRecord of oldRecords) await invalidate(oldRecord)
        const failedRouteFields = failedSelection === undefined ? {} : { failedProvider: failedSelection.provider, failedModel: failedSelection.model }

        if (reused !== undefined) {
          await cancelScheduled(reused)
          const { overtaken: _overtaken, failedProvider: _failedProvider, failedModel: _failedModel, ...kept } = reused
          const taken: QuotaContinuationRecord = {
            ...kept,
            ...failedRouteFields,
            accountId,
            failedSeq: agent.session.seq,
            failedAt: nowAtFailure,
            resetAt,
            retryAt: resetAt === null ? quotaRetryAt({ failedAt: nowAtFailure, attempt: reused.retryAttempt }) : null,
            scheduleId: null,
            queueSource: null,
            state: 'waiting',
          }
          const record = isQueuedExternalWork(agent) ? transition(taken, { kind: 'newerWork' }) : taken
          await storage.put(record.continuationId, record)
          if (record.state === 'waiting') await ensureScheduled(record)
          return
        }

        const records = await allRecords()
        // A thread keeps the choice someone made for its earlier recovery, so
        // unticking the toggle there is not undone by the global default.
        const chosen = records
          .filter(record => record.sessionId === agent.id && record.autoRetrySource === 'user')
          .sort((left, right) => right.failedAt - left.failedAt)[0]
        const retryChoice = chosen?.autoRetry ?? autoRetry
        // A recovery that already ran and hit the same wall backs off one rung further.
        const lastRan = records
          .filter(record => record.sessionId === agent.id && record.state === 'completed')
          .sort((left, right) => right.failedAt - left.failedAt)[0]
        const retryAttempt = lastRan === undefined ? 0 : lastRan.retryAttempt + 1
        if (!(await makeRoom(records, nowAtFailure))) {
          context.logger.warn('ai-accounts: quota recovery capacity is full')
          return
        }

        const continuationId = randomUUID()
        const hasQueuedWork = isQueuedExternalWork(agent)
        const waiting = quotaContinuationDomain.tables.continuations.valueSchema.parse({
          continuationId,
          sessionId: agent.id,
          accountId,
          ...failedRouteFields,
          failedSeq: agent.session.seq,
          failedAt: nowAtFailure,
          resetAt,
          retryAt: resetAt === null ? quotaRetryAt({ failedAt: nowAtFailure, attempt: retryAttempt }) : null,
          retryAttempt,
          autoRetry: retryChoice,
          autoRetrySource: 'default' as const,
          snoozedUntil: null,
          scheduleId: null,
          queueSource: null,
          state: 'waiting',
        })
        const record = hasQueuedWork ? transition(waiting, { kind: 'newerWork' }) : waiting
        await storage.put(continuationId, record)
        if (record.state === 'waiting') await ensureScheduled(record)
      })
    } catch (error) {
      context.logger.warn(`ai-accounts: could not persist quota recovery: ${String(error)}`)
    }
  }

  const list = async (): Promise<{ scheduleAvailable: boolean; continuations: QuotaContinuationSummary[] }> => {
    const nowAtList = now()
    const scheduleAvailable = schedule() !== undefined
    const archivedSessionIds = new Set(readArchivedSessionIds())
    const records = (await allRecords())
      .filter(record => isActive(record) && !archivedSessionIds.has(record.sessionId))
      .sort((left, right) => right.failedAt - left.failedAt)
      .slice(0, MAX_CONTINUATIONS)
    const sessionMetadata = new Map<string, SessionListItems[number]>()
    const controller = sessionController()
    if (controller?.list !== undefined && records.length > 0) {
      try {
        const listed = await controller.list({}, AbortSignal.timeout(15_000))
        for (const item of listed.items) sessionMetadata.set(String(item.sessionId), item)
      } catch {
        context.logger.warn('ai-accounts: could not read Session labels for quota recovery')
      }
    }
    const continuations = records.map(record => {
      const item = sessionMetadata.get(record.sessionId)
      const result = summary(record, nowAtList, scheduleAvailable)
      const title = item?.projections?.values.title
      const enriched = { ...result }
      if (typeof title === 'string' && title.trim() !== '') enriched.title = title
      if (item?.cwd !== undefined) enriched.cwd = item.cwd
      return enriched
    })
    return { scheduleAvailable, continuations }
  }

  const resume = async (continuationId: string, selection?: ModelSelection): Promise<{ accepted: boolean }> => {
    const storage = await table()
    const record = storage.get(continuationId)
    if (record === undefined || !isActive(record)) return { accepted: false }
    if (record.state === 'queued') return { accepted: true }

    return serialize(record.sessionId, async () => {
      const current = storage.get(continuationId)
      if (current === undefined || !isActive(current)) return { accepted: false }
      if (current.state === 'queued') return { accepted: true }
      const controller = sessionController()
      if (controller === undefined || (selection !== undefined && controller.selectModel === undefined)) return { accepted: false }

      try {
        const activities = await userActivitiesSince(controller, SessionId(current.sessionId), current.failedSeq, AbortSignal.timeout(15_000))
        if (hasNewerUserWork(current, activities)) {
          await invalidate(current, 'newerWork')
          return { accepted: false }
        }
        if (selection !== undefined) {
          await controller.selectModel?.({ sessionId: SessionId(current.sessionId), ...selection })
        }
        await storage.put(continuationId, { ...transition(current, { kind: 'queued', queueSource: 'manual' }), snoozedUntil: null })
        await cancelScheduled(current)
        await controller.prompt(
          {
            requestId: requestIdFor(continuationId),
            sessionId: SessionId(current.sessionId),
            mode: 'queue',
            content: [{ type: 'text', text: QuotaContinuationMessage.promptFor(continuationId) }],
          },
          AbortSignal.timeout(15_000),
        )
        return { accepted: true }
      } catch {
        const latest = storage.get(continuationId)
        if (latest?.state === 'queued' && latest.queueSource === 'manual') {
          const restored = { ...latest, ...current, scheduleId: null }
          await storage.put(continuationId, restored)
          await ensureScheduled(restored)
        }
        return { accepted: false }
      }
    })
  }

  const setAutoRetry = async (continuationId: string, sessionId: string, enabled: boolean): Promise<{ updated: boolean }> => {
    const storage = await table()
    const record = storage.get(continuationId)
    if (record === undefined || record.sessionId !== sessionId || record.state !== 'waiting') return { updated: false }

    return serialize(record.sessionId, async () => {
      const current = storage.get(continuationId)
      if (current === undefined || current.sessionId !== sessionId || current.state !== 'waiting') return { updated: false }
      const updated = { ...current, autoRetry: enabled, autoRetrySource: 'user' as const, scheduleId: null }
      await storage.put(continuationId, updated)
      await cancelScheduled(current)
      await ensureScheduled(updated)
      return { updated: true }
    })
  }

  const snooze = async (continuationId: string, duration: SnoozeDuration): Promise<{ updated: boolean }> => {
    const storage = await table()
    const record = storage.get(continuationId)
    if (record === undefined || record.state !== 'waiting') return { updated: false }

    return serialize(record.sessionId, async () => {
      const current = storage.get(continuationId)
      if (current === undefined || current.state !== 'waiting') return { updated: false }
      const updated = {
        ...current,
        snoozedUntil: snoozeUntil(duration, now()),
        scheduleId: null,
      }
      await storage.put(continuationId, updated)
      await cancelScheduled(current)
      await ensureScheduled(updated)
      return { updated: true }
    })
  }

  const dismiss = async (continuationId: string): Promise<{ dismissed: boolean }> => {
    const storage = await table()
    const record = storage.get(continuationId)
    if (record === undefined || record.state !== 'waiting') return { dismissed: false }

    return serialize(record.sessionId, async () => {
      const current = storage.get(continuationId)
      if (current === undefined || current.state !== 'waiting') return { dismissed: false }
      await invalidate(current)
      return { dismissed: true }
    })
  }

  const stopSession = async (sessionId: string): Promise<void> => {
    await serialize(sessionId, async () => {
      for (const record of await activeForSession(sessionId)) await invalidate(record)
    })
  }

  /** Sessions a subagent owns: an earlier build stored their stopped turns as recoveries no one can resume here. */
  const subagentSessionIds = async (): Promise<ReadonlySet<string>> => {
    const listSessions = sessionController()?.list
    if (listSessions === undefined) return new Set()
    try {
      const listed = await listSessions({}, AbortSignal.timeout(15_000))
      return new Set(listed.items.filter(session => session.origin === 'subagent').map(session => String(session.sessionId)))
    } catch {
      context.logger.warn('ai-accounts: could not read Session origins for quota recovery')
      return new Set()
    }
  }

  const reportActivity = async (
    request: { readonly sessionId: string },
    next: () => Promise<readonly SessionActivity[]>,
  ): Promise<readonly SessionActivity[]> => {
    const records = await activeForSession(request.sessionId)
    const activity: SessionActivity[] = records.map(record => ({
      kind: 'quota-continuation',
      items: [{ id: record.continuationId, label: 'Quota recovery' }],
    }))
    return [...activity, ...(await next())]
  }

  const start = (): (() => void) => {
    if (started) return () => undefined
    started = true
    const offCreated = context.on('agent/created', async ({ agent, source }) => {
      await attachAgent(agent, source)
      return undefined
    })
    const offDisposed = context.on('agent/disposed', ({ agent }) => {
      perAgent.get(agent.id)?.()
      perAgent.delete(agent.id)
    })
    const offActivity = context.on('workspace/session-activity', reportActivity)
    const offStop = context.on('workspace/session-stop', ({ sessionId }) => stopSession(sessionId))
    const reconcile = async (): Promise<void> => {
      try {
        const records = await allRecords()
        const subagents = records.some(isActive) ? await subagentSessionIds() : new Set<string>()
        for (const record of records) {
          if (record.state === 'invalidated') await cancelScheduled(record)
          else if (subagents.has(record.sessionId)) await invalidate(record)
          else if (record.state === 'waiting') await serialize(record.sessionId, () => ensureScheduled(record))
        }
      } catch {
        context.logger.warn('ai-accounts: quota recovery startup reconciliation failed')
      }
    }
    void reconcile()

    return () => {
      offCreated()
      offDisposed()
      offActivity()
      offStop()
      for (const dispose of perAgent.values()) dispose()
      perAgent.clear()
      started = false
    }
  }

  // Forgetting the domain before it finishes closing makes a later call open a fresh one instead of the closing one.
  const close = async (): Promise<void> => {
    const closing = domainOpening?.then(
      opened => opened.close(),
      () => undefined,
    )
    domainOpening = undefined
    await closing
  }

  return { start, close, list, recordFailure, resume, setAutoRetry, snooze, dismiss }
}

export { createQuotaContinuationService, type QuotaContinuationService, type QuotaFailureAgent, type SnoozeDuration }

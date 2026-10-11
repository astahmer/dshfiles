import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SessionController, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ScheduleId, type ScheduleRecord } from '@deepseek-ai/dsh-schedule'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { SessionActivity } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  quotaContinuationDomain,
  type QuotaContinuationRecord,
  type QuotaContinuationSummary,
  type QuotaContinuationTable,
} from './quota-continuation-store.js'
import { continuationIdOf, promptFor, userActivityForMessage, type UserActivityIdentity } from './quota-continuation-message.js'

const MAX_CONTINUATIONS = 500
const CONTINUATION_RETENTION_MS = 30 * 24 * 60 * 60_000
const SNOOZE_MS = {
  'one-hour': 60 * 60_000,
  'four-hours': 4 * 60 * 60_000,
  'one-day': 24 * 60 * 60_000,
} as const

type QuotaContinuationDomain = Domain<typeof quotaContinuationDomain>
type SchedulePort = Pick<NonNullable<Context['schedule']>, 'create' | 'delete' | 'list'>
type SessionControllerService = SessionController
type SessionInspectionEvents = Awaited<ReturnType<SessionControllerService['inspect']>>['events']
type SessionControllerPort = {
  inspect: (
    sessionId: Parameters<SessionControllerService['inspect']>[0],
    signal?: Parameters<SessionControllerService['inspect']>[1],
  ) => Promise<{ readonly events: SessionInspectionEvents }>
  prompt: SessionControllerService['prompt']
}
type AgentUserMessage = Agent['inbox']['nextTurn'][number]
type QuotaFailureAgent = {
  readonly id: Agent['id']
  readonly session: { readonly seq: number }
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
  readonly now?: () => number
}
type QuotaContinuationService = {
  start(): () => void
  close(): Promise<void>
  list(): Promise<{ scheduleAvailable: boolean; continuations: QuotaContinuationSummary[] }>
  recordFailure(agent: QuotaFailureAgent, accountId: string, autoRetry: boolean): Promise<void>
  resume(continuationId: string): Promise<{ accepted: boolean }>
  setAutoRetry(continuationId: string, sessionId: string, enabled: boolean): Promise<{ updated: boolean }>
  snooze(continuationId: string, duration: SnoozeDuration): Promise<{ updated: boolean }>
}

declare module '@deepseek-ai/dsh-workspace/types' {
  interface SessionActivityKindMap {
    'quota-continuation': true
  }
}

const isReady = (record: QuotaContinuationRecord, now: number): boolean => record.resetAt !== null && Math.max(record.resetAt, record.snoozedUntil ?? 0) <= now

const isActive = (record: QuotaContinuationRecord): boolean => record.state === 'waiting' || record.state === 'queued'

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

const snoozeUntil = (duration: SnoozeDuration, now: number): number | null => (duration === 'unsnooze' ? null : now + SNOOZE_MS[duration])

const requestIdFor = (continuationId: string): SessionRequestId => {
  // SessionRequestId is a type-only opaque brand; the persisted UUID is its stable identity.
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
    const settled = current.then(
      () => undefined,
      () => undefined,
    )
    sessionChains.set(sessionId, settled)
    void settled.then(() => {
      if (sessionChains.get(sessionId) === settled) sessionChains.delete(sessionId)
    })
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

  const scheduleMatches = async (record: QuotaContinuationRecord) => {
    const scheduler = schedule()
    if (scheduler === undefined) return []
    const tasks = await scheduler.list({ sessionId: SessionId(record.sessionId) })
    return tasks.filter(task => task.prompt === promptFor(record.continuationId))
  }

  const cancelScheduled = async (record: QuotaContinuationRecord): Promise<void> => {
    const scheduler = schedule()
    if (scheduler === undefined) return
    try {
      const matches = await scheduleMatches(record)
      const ids = new Set(matches.map(task => task.id))
      if (record.scheduleId !== null) ids.add(scheduleIdFor(record.scheduleId))
      await Promise.all([...ids].map(id => scheduler.delete({ sessionId: SessionId(record.sessionId), id })))
    } catch {
      context.logger.warn('ai-accounts: could not remove a stale quota recovery schedule')
    }
  }

  const ensureScheduled = async (record: QuotaContinuationRecord): Promise<void> => {
    if (record.state !== 'waiting') return
    if (!record.autoRetry || record.resetAt === null) {
      await cancelScheduled(record)
      if (record.scheduleId !== null) {
        const storage = await table()
        await storage.update(record.continuationId, current => (current.state === 'waiting' ? { ...current, scheduleId: null } : current))
      }
      return
    }
    const scheduler = schedule()
    if (scheduler === undefined) return
    try {
      const matches = await scheduleMatches(record)
      const existing = matches[0]
      if (existing !== undefined) {
        await Promise.all(matches.slice(1).map(task => scheduler.delete({ sessionId: SessionId(record.sessionId), id: task.id })))
        const storage = await table()
        await storage.update(record.continuationId, current => (current.state === 'waiting' ? { ...current, scheduleId: existing.id } : current))
        return
      }

      const dueAt = Math.max(record.resetAt, record.snoozedUntil ?? 0)
      const afterSeconds = Math.max(1, Math.ceil((dueAt - now()) / 1_000))
      const created = await scheduler.create(SessionId(record.sessionId), {
        title: 'Quota recovery',
        prompt: promptFor(record.continuationId),
        after_seconds: afterSeconds,
      })
      const storage = await table()
      await storage.update(record.continuationId, current => (current.state === 'waiting' ? { ...current, scheduleId: created.id } : current))
      const current = storage.get(record.continuationId)
      if (current?.state !== 'waiting') await scheduler.delete({ sessionId: SessionId(record.sessionId), id: created.id })
    } catch {
      context.logger.warn('ai-accounts: automatic quota recovery could not be scheduled')
    }
  }

  const invalidate = async (record: QuotaContinuationRecord): Promise<void> => {
    if (!isActive(record)) return
    const storage = await table()
    await storage.update(record.continuationId, current =>
      isActive(current) ? { ...current, state: 'invalidated', scheduleId: null, queueSource: null } : current,
    )
    await cancelScheduled(record)
  }

  const summary = (record: QuotaContinuationRecord, now: number, scheduleAvailable: boolean): QuotaContinuationSummary => ({
    continuationId: record.continuationId,
    sessionId: record.sessionId,
    accountId: record.accountId,
    failedAt: record.failedAt,
    resetAt: record.resetAt,
    autoRetry: record.autoRetry,
    snoozedUntil: record.snoozedUntil,
    state: record.state === 'queued' ? 'queued' : 'waiting',
    scheduled: scheduleAvailable && record.scheduleId !== null,
    ready: isReady(record, now),
  })

  const activeForSession = async (sessionId: string): Promise<QuotaContinuationRecord[]> =>
    (await allRecords()).filter(record => record.sessionId === sessionId && isActive(record))

  const isQueuedExternalWork = (agent: Pick<QuotaFailureAgent, 'inbox'>): boolean =>
    [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => continuationIdOf(message) === null)

  const reconcileAgent = async (agent: Agent): Promise<void> => {
    const sessionId = agent.id
    await serialize(sessionId, async () => {
      const records = await activeForSession(sessionId)
      const events = agent.session.ownEvents()
      const activities = collectUserActivities(events, event => (event.type === 'user/message' ? userActivityForMessage(event.data) : undefined))
      for (const record of records) {
        if (hasNewerUserWork(record, activities) || isQueuedExternalWork(agent)) {
          await invalidate(record)
          for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
            if (continuationIdOf(message) === record.continuationId) agent.inbox.remove(message.id)
          }
          continue
        }

        const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].filter(message => continuationIdOf(message) === record.continuationId)
        for (const message of pending) {
          if (record.queueSource === 'manual' && String(message.source.kind) === 'schedule') agent.inbox.remove(message.id)
        }
        const continuationInInbox = pending.some(message => !(record.queueSource === 'manual' && String(message.source.kind) === 'schedule'))
        const continuationInHistory = activities.find(activity => activity.seq >= record.failedSeq && activity.continuationId === record.continuationId)
        if (continuationInInbox) {
          const queuedMessage = pending.find(message => !(record.queueSource === 'manual' && String(message.source.kind) === 'schedule'))
          const storage = await table()
          await storage.update(record.continuationId, current =>
            isActive(current)
              ? {
                  ...current,
                  state: 'queued',
                  scheduleId: null,
                  queueSource: queuedMessage === undefined ? null : userActivityForMessage(queuedMessage).queueSource,
                }
              : current,
          )
          await cancelScheduled(record)
          continue
        }
        if (continuationInHistory !== undefined) {
          const storage = await table()
          await storage.update(record.continuationId, current =>
            isActive(current) ? { ...current, state: 'completed', scheduleId: null, queueSource: null } : current,
          )
          continue
        }
        if (record.state === 'queued') {
          const storage = await table()
          const waiting = await storage.update(record.continuationId, current =>
            current.state === 'queued' ? { ...current, state: 'waiting', scheduleId: null, queueSource: null } : current,
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
      const continuationId = continuationIdOf(message)
      if (continuationId !== null) {
        const record = records.find(item => item.continuationId === continuationId)
        const isScheduledMessage = String(message.source.kind) === 'schedule'
        if (record === undefined || record.state === 'invalidated' || record.state === 'completed') {
          if (isScheduledMessage) agent.inbox.remove(message.id)
          return
        }
        const activities = collectUserActivities(agent.session.ownEvents(), event =>
          event.type === 'user/message' ? userActivityForMessage(event.data) : undefined,
        )
        if (hasNewerUserWork(record, activities)) {
          await invalidate(record)
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
        await storage.update(record.continuationId, current =>
          isActive(current)
            ? {
                ...current,
                state: 'queued',
                scheduleId: null,
                queueSource: isScheduledMessage ? 'schedule' : 'manual',
              }
            : current,
        )
        return
      }

      for (const record of records) {
        await invalidate(record)
        for (const pending of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
          if (continuationIdOf(pending) === record.continuationId) agent.inbox.remove(pending.id)
        }
      }
    }).catch(() => context.logger.warn('ai-accounts: quota recovery could not reconcile new Session work'))
  }

  const preStep = async (agent: Agent, messages: readonly AgentUserMessage[], next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const originalIds = new Map<AgentUserMessage['id'], string>()
    for (const message of messages) {
      const continuationId = continuationIdOf(message)
      if (continuationId !== null) originalIds.set(message.id, continuationId)
    }
    if (originalIds.size === 0) return decision

    const kept: AgentUserMessage[] = []
    const competingWork = isQueuedExternalWork(agent) || decision.messages.some(message => continuationIdOf(message) === null)
    for (const message of decision.messages) {
      const continuationId = originalIds.get(message.id) ?? continuationIdOf(message)
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
          event.type === 'user/message' ? userActivityForMessage(event.data) : undefined,
        )
        const newerWork = competingWork || hasNewerUserWork(record, activities)
        const notReady = isScheduleMessage && !isReady(record, now())
        const competingManual = isScheduleMessage && record.queueSource === 'manual'
        if (newerWork) await invalidate(record)
        if (newerWork || notReady || competingManual) {
          if (notReady && !newerWork && !competingManual) {
            const updated = await storage.update(record.continuationId, current =>
              isActive(current) ? { ...current, state: 'waiting', scheduleId: null, queueSource: null } : current,
            )
            await ensureScheduled(updated)
          }
          continue
        }

        await storage.update(record.continuationId, current =>
          isActive(current) ? { ...current, state: 'completed', scheduleId: null, queueSource: null } : current,
        )
        kept.push(message)
      } catch {
        context.logger.warn('ai-accounts: quota recovery failed closed before a Session step')
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
    } catch {
      context.logger.warn('ai-accounts: quota recovery could not reconcile a restored Session')
    }
  }

  const recordFailure = async (agent: QuotaFailureAgent, accountId: string, autoRetry: boolean): Promise<void> => {
    try {
      const resetAt = await readResetAt(accountId).catch(() => null)
      await serialize(agent.id, async () => {
        const storage = await table()
        const nowAtFailure = now()
        const oldRecords = [...storage.entries()].map(([, record]) => record).filter(record => record.sessionId === agent.id && isActive(record))
        for (const oldRecord of oldRecords) await invalidate(oldRecord)

        const records = await allRecords()
        if (!(await makeRoom(records, nowAtFailure))) {
          context.logger.warn('ai-accounts: quota recovery capacity is full')
          return
        }

        const continuationId = randomUUID()
        const hasQueuedWork = isQueuedExternalWork(agent)
        const record = quotaContinuationDomain.tables.continuations.valueSchema.parse({
          continuationId,
          sessionId: agent.id,
          accountId,
          failedSeq: agent.session.seq,
          failedAt: nowAtFailure,
          resetAt,
          autoRetry: autoRetry && resetAt !== null,
          snoozedUntil: null,
          scheduleId: null,
          queueSource: null,
          state: hasQueuedWork ? 'invalidated' : 'waiting',
        })
        await storage.put(continuationId, record)
        if (record.state === 'waiting') await ensureScheduled(record)
      })
    } catch {
      context.logger.warn('ai-accounts: could not persist quota recovery')
    }
  }

  const list = async (): Promise<{ scheduleAvailable: boolean; continuations: QuotaContinuationSummary[] }> => {
    const nowAtList = now()
    const scheduleAvailable = schedule() !== undefined
    const continuations = (await allRecords())
      .filter(isActive)
      .sort((left, right) => right.failedAt - left.failedAt)
      .slice(0, MAX_CONTINUATIONS)
      .map(record => summary(record, nowAtList, scheduleAvailable))
    return { scheduleAvailable, continuations }
  }

  const resume = async (continuationId: string): Promise<{ accepted: boolean }> => {
    const storage = await table()
    const record = storage.get(continuationId)
    if (record === undefined || !isActive(record)) return { accepted: false }
    if (record.state === 'queued') return { accepted: true }

    return serialize(record.sessionId, async () => {
      const current = storage.get(continuationId)
      if (current === undefined || !isActive(current)) return { accepted: false }
      if (current.state === 'queued') return { accepted: true }
      const controller = sessionController()
      if (controller === undefined) return { accepted: false }

      try {
        const inspected = await controller.inspect(SessionId(current.sessionId), AbortSignal.timeout(15_000))
        const activities = collectUserActivities<SessionInspectionEvents[number]>(inspected.events, event =>
          event.type === 'user/message' ? userActivityForMessage(event.data) : undefined,
        )
        if (hasNewerUserWork(current, activities)) {
          await invalidate(current)
          return { accepted: false }
        }
        await storage.put(continuationId, { ...current, state: 'queued', scheduleId: null, queueSource: 'manual', snoozedUntil: null })
        await cancelScheduled(current)
        await controller.prompt(
          {
            requestId: requestIdFor(continuationId),
            sessionId: SessionId(current.sessionId),
            mode: 'queue',
            content: [{ type: 'text', text: promptFor(continuationId) }],
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
    if (record === undefined || record.sessionId !== sessionId || record.state !== 'waiting' || (enabled && record.resetAt === null)) return { updated: false }

    return serialize(record.sessionId, async () => {
      const current = storage.get(continuationId)
      if (current === undefined || current.sessionId !== sessionId || current.state !== 'waiting' || (enabled && current.resetAt === null))
        return { updated: false }
      const updated = { ...current, autoRetry: enabled, scheduleId: null }
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

  const stopSession = async (sessionId: string): Promise<void> => {
    await serialize(sessionId, async () => {
      for (const record of await activeForSession(sessionId)) await invalidate(record)
    })
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
    void allRecords()
      .then(async records => {
        for (const record of records) {
          if (record.state === 'invalidated') await cancelScheduled(record)
          else if (record.state === 'waiting') await serialize(record.sessionId, () => ensureScheduled(record))
        }
      })
      .catch(() => context.logger.warn('ai-accounts: quota recovery startup reconciliation failed'))

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

  const close = async (): Promise<void> => {
    const opening = domainOpening
    if (opening === undefined) return
    try {
      await opening.then(
        opened => opened.close(),
        () => undefined,
      )
    } finally {
      if (domainOpening === opening) domainOpening = undefined
    }
  }

  return { start, close, list, recordFailure, resume, setAutoRetry, snooze }
}

export { createQuotaContinuationService, type QuotaContinuationService, type QuotaFailureAgent, type SnoozeDuration }

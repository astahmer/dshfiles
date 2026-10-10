import { chmod, lstat, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import {
  communicationActivityEventSchema,
  communicationAgentSchema,
  communicationDiagnosticsSchema,
  communicationDiagnosticMessageSchema,
  communicationDiagnosticSubscriptionSchema,
  communicationMessageSchema,
  communicationPrincipalSchema,
  communicationStateSchema,
  communicationStateV1Schema,
  communicationSubscriptionSchema,
  communicationTopicSchema,
  type CommunicationActivityEvent,
  type CommunicationActivityOperation,
  type CommunicationAgent,
  type CommunicationDelivery,
  type CommunicationDiagnostics,
  type CommunicationMessage,
  type CommunicationPrincipal,
  type CommunicationState,
  type CommunicationStateV1,
  type CommunicationSubscription,
  type CommunicationTopic,
} from './types.js'

const MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_MESSAGES = 5_000
const MAX_ACTIVITY_EVENTS = 5_000
const MAX_DIAGNOSTIC_ROWS = 100
const MAX_STATE_BYTES = 16 * 1024 * 1024
const MAX_SUBSCRIPTIONS = 5_000
const MAX_ACKNOWLEDGEMENTS = 100_000
const MAX_NOTIFICATIONS = 100_000

const topicSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(value => {
    if (value === 'inbox') return true
    const segments = value.split('/')
    return segments.every(segment => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(segment) && segment !== '..')
  }, 'Topic must use lowercase path segments; "inbox" is reserved for an agent private inbox.')

const messageInputSchema = z
  .object({
    topic: topicSchema,
    text: z.string().trim().min(1).max(12_000),
    priority: z.enum(['normal', 'urgent']).default('normal'),
  })
  .strict()

const directMessageInputSchema = z
  .object({
    toAgentId: z.string().min(1).max(256),
    text: z.string().trim().min(1).max(12_000),
    priority: z.enum(['normal', 'urgent']).default('normal'),
  })
  .strict()

const subscriptionInputSchema = z
  .object({
    topic: topicSchema,
    delivery: z.enum(['quiet', 'queue', 'steer']).default('queue'),
    allowSteerFrom: z.array(z.string().min(1).max(256)).max(64).default([]),
  })
  .strict()

export interface CommunicationServiceOptions {
  readonly statePath?: string
  readonly now?: () => number
  readonly notifyAgent?: (
    agentId: string,
    message: CommunicationMessage,
    delivery: CommunicationDelivery,
    allowSteerFrom: readonly string[],
  ) => Promise<void> | void
}

export interface CommunicationPublishInput {
  readonly sender: CommunicationPrincipal
  readonly topic: string
  readonly text: string
  readonly priority?: 'normal' | 'urgent'
}

export interface CommunicationSendInput {
  readonly sender: CommunicationPrincipal
  readonly toAgentId: string
  readonly text: string
  readonly priority?: 'normal' | 'urgent'
}

export interface CommunicationInboxInput {
  readonly principal: CommunicationPrincipal
  readonly topic?: string
  readonly limit?: number
}

export interface CommunicationActivityInput {
  readonly principal: { readonly kind: 'agent'; readonly id: string }
  readonly operation: CommunicationActivityOperation
  readonly outcome: 'success' | 'failure'
  readonly occurredAt: number
  readonly durationMs: number
  readonly callId: string
  readonly rootCallId?: string | null
  readonly errorCode?: string | null
}

const persistedCommunicationStateSchema = z.discriminatedUnion('schemaVersion', [communicationStateV1Schema, communicationStateSchema])

export class CommunicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'CommunicationError'
  }
}

const initialState = (): CommunicationState => ({
  schemaVersion: 2,
  messages: [],
  subscriptions: [],
  acknowledgements: [],
  workspaceOptOuts: [],
  notifications: [],
  activityStartedAt: null,
  activityEvents: [],
})

const defaultStatePath = (): string => {
  const home = process.env.DSH_HOME?.trim() || `${homedir()}/.dsh`
  return join(home, 'runtime', 'dshx', 'communication', 'state.json')
}

const principalKey = (principal: CommunicationPrincipal): string => `${principal.kind}:${principal.id}`

const cleanState = (state: CommunicationState, now: number): CommunicationState => {
  const retainedIds = new Set(state.messages.filter(message => message.createdAt >= now - MESSAGE_RETENTION_MS).map(message => message.id))
  const messages = state.messages.filter(message => retainedIds.has(message.id)).slice(-MAX_MESSAGES)
  const survivingIds = new Set(messages.map(message => message.id))
  const activityEvents = state.activityEvents.filter(event => event.occurredAt >= now - MESSAGE_RETENTION_MS).slice(-MAX_ACTIVITY_EVENTS)
  return {
    schemaVersion: 2,
    messages,
    subscriptions: state.subscriptions.slice(-MAX_SUBSCRIPTIONS),
    acknowledgements: state.acknowledgements.filter(entry => survivingIds.has(entry.messageId)).slice(-MAX_ACKNOWLEDGEMENTS),
    workspaceOptOuts: [...new Set(state.workspaceOptOuts)].slice(-10_000),
    notifications: state.notifications.filter(entry => survivingIds.has(entry.messageId)).slice(-MAX_NOTIFICATIONS),
    activityStartedAt: state.activityStartedAt,
    activityEvents,
  }
}

const assertTopic = (topic: string, privateAllowed = false): string => {
  const parsed = topicSchema.safeParse(topic)
  if (!parsed.success || (!privateAllowed && parsed.data === 'inbox')) {
    throw new CommunicationError('invalid-topic', privateAllowed ? 'Invalid communication topic.' : 'The private inbox cannot be published to.')
  }
  return parsed.data
}

const messageId = (): string => randomUUID()

const migrateLegacyState = (state: CommunicationStateV1): CommunicationState => ({
  schemaVersion: 2,
  messages: state.messages,
  subscriptions: state.subscriptions,
  acknowledgements: state.acknowledgements,
  workspaceOptOuts: state.workspaceOptOuts,
  notifications: state.notifications,
  activityStartedAt: null,
  activityEvents: [],
})

const topicsForState = (state: CommunicationState): readonly CommunicationTopic[] => {
  const counts = new Map<string, Set<string>>()
  for (const subscription of state.subscriptions) {
    if (subscription.topic === 'inbox') continue
    const subscribers = counts.get(subscription.topic) ?? new Set<string>()
    subscribers.add(principalKey(subscription.principal))
    counts.set(subscription.topic, subscribers)
  }
  return [...counts.entries()]
    .map(([topic, subscribers]) => communicationTopicSchema.parse({ topic, subscribers: subscribers.size }))
    .sort((left, right) => left.topic.localeCompare(right.topic))
}

export class CommunicationService {
  readonly #statePath: string
  readonly #now: () => number
  readonly #notifyAgent?: CommunicationServiceOptions['notifyAgent']
  readonly #inFlightNotifications = new Set<string>()
  #writes: Promise<void> = Promise.resolve()

  constructor(options: CommunicationServiceOptions = {}) {
    this.#statePath = options.statePath ?? defaultStatePath()
    this.#now = options.now ?? Date.now
    this.#notifyAgent = options.notifyAgent
  }

  async listTopics(): Promise<readonly CommunicationTopic[]> {
    return topicsForState(await this.#readState())
  }

  async recordActivity(input: CommunicationActivityInput): Promise<void> {
    const event: CommunicationActivityEvent = communicationActivityEventSchema.parse({
      id: randomUUID(),
      principal: input.principal,
      operation: input.operation,
      outcome: input.outcome,
      occurredAt: input.occurredAt,
      durationMs: input.durationMs,
      callId: input.callId,
      rootCallId: input.rootCallId ?? null,
      errorCode: input.errorCode ?? null,
    })
    await this.#updateState(state => ({
      state: {
        ...state,
        activityStartedAt: state.activityStartedAt ?? event.occurredAt,
        activityEvents: [...state.activityEvents, event],
      },
      value: undefined,
    }))
  }

  async diagnostics(input: { readonly agents: readonly CommunicationAgent[]; readonly limit?: number }): Promise<CommunicationDiagnostics> {
    const limit = input.limit ?? 20
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DIAGNOSTIC_ROWS) {
      throw new CommunicationError('invalid-limit', `Diagnostic limit must be an integer from 1 to ${MAX_DIAGNOSTIC_ROWS}.`)
    }

    const state = await this.#readState()
    const agents = z.array(communicationAgentSchema).parse(input.agents)
    const topics = topicsForState(state)
    const acknowledgements = new Map(state.acknowledgements.map(entry => [`${entry.messageId}:${principalKey(entry.principal)}`, entry.acknowledgedAt]))
    const notifications = new Map(state.notifications.map(entry => [`${entry.messageId}:${entry.agentId}`, entry.notifiedAt]))
    let pendingMessageCount = 0
    let pendingRecipientCount = 0
    let unnotifiedRecipientCount = 0

    for (const message of state.messages) {
      let hasPendingRecipient = false
      for (const recipient of message.recipients) {
        const recipientKey = principalKey(recipient.principal)
        if (!acknowledgements.has(`${message.id}:${recipientKey}`)) {
          pendingRecipientCount += 1
          hasPendingRecipient = true
        }
        if (recipient.principal.kind === 'agent' && recipient.delivery !== 'quiet' && !notifications.has(`${message.id}:${recipient.principal.id}`)) {
          unnotifiedRecipientCount += 1
        }
      }
      if (hasPendingRecipient) pendingMessageCount += 1
    }

    const recentMessages = state.messages
      .slice(-limit)
      .reverse()
      .map(message => {
        const pendingRecipients = message.recipients.filter(recipient => !acknowledgements.has(`${message.id}:${principalKey(recipient.principal)}`))
        const unnotifiedRecipients = message.recipients.filter(
          recipient => recipient.principal.kind === 'agent' && recipient.delivery !== 'quiet' && !notifications.has(`${message.id}:${recipient.principal.id}`),
        )
        return communicationDiagnosticMessageSchema.parse({
          id: message.id,
          topic: message.topic,
          sender: message.sender,
          priority: message.priority,
          createdAt: message.createdAt,
          recipientCount: message.recipients.length,
          pendingRecipientCount: pendingRecipients.length,
          unnotifiedRecipientCount: unnotifiedRecipients.length,
        })
      })
    const subscriptions = [...state.subscriptions]
      .sort((left, right) => left.topic.localeCompare(right.topic) || principalKey(left.principal).localeCompare(principalKey(right.principal)))
      .slice(0, limit)
      .map(subscription =>
        communicationDiagnosticSubscriptionSchema.parse({
          principal: subscription.principal,
          topic: subscription.topic,
          delivery: subscription.delivery,
          allowSteerFromCount: subscription.allowSteerFrom.length,
          createdAt: subscription.createdAt,
        }),
      )

    return communicationDiagnosticsSchema.parse({
      generatedAt: this.#now(),
      agentCount: agents.length,
      agents: agents.slice(0, limit),
      topicCount: topics.length,
      topics: topics.slice(0, limit),
      subscriptionCount: state.subscriptions.length,
      subscriptions,
      messageCount: state.messages.length,
      pendingMessageCount,
      pendingRecipientCount,
      unnotifiedRecipientCount,
      recentMessages,
      activity: {
        trackingStartedAt: state.activityStartedAt,
        oldestRetainedAt: state.activityEvents[0]?.occurredAt ?? null,
        retainedCount: state.activityEvents.length,
        events: state.activityEvents.slice(-limit).reverse(),
      },
      historyNote: 'Activity history starts when the first tool-call event is recorded; earlier use cannot be inferred.',
    })
  }

  async subscribe(
    principalInput: CommunicationPrincipal,
    input: { readonly topic: string; readonly delivery?: CommunicationDelivery; readonly allowSteerFrom?: readonly string[] },
  ): Promise<CommunicationSubscription> {
    const principal = communicationPrincipalSchema.parse(principalInput)
    const parsed = subscriptionInputSchema.parse({ ...input, allowSteerFrom: input.allowSteerFrom ?? [] })
    if (parsed.topic === 'inbox' && principal.kind !== 'agent') {
      throw new CommunicationError('invalid-topic', 'Only a DSH Agent can subscribe to its private inbox.')
    }
    if (parsed.delivery !== 'steer' && parsed.allowSteerFrom.length > 0) {
      throw new CommunicationError('invalid-steer-policy', 'A sender allowlist is only valid when steer delivery is enabled.')
    }
    if (principal.kind === 'external' && parsed.delivery === 'steer') {
      throw new CommunicationError('invalid-delivery', 'External subscribers cannot steer a DSH Agent.')
    }
    if (parsed.delivery === 'steer' && parsed.allowSteerFrom.length === 0) {
      throw new CommunicationError('sender-allowlist-required', 'Steer delivery requires at least one explicitly allowed sender id.')
    }
    const now = this.#now()
    const subscription = communicationSubscriptionSchema.parse({
      principal,
      topic: parsed.topic,
      delivery: parsed.delivery,
      allowSteerFrom: [...new Set(parsed.allowSteerFrom)],
      createdAt: now,
    })
    await this.#updateState(state => {
      const key = principalKey(principal)
      const otherSubscribers = state.subscriptions.filter(item => item.topic === parsed.topic && principalKey(item.principal) !== key)
      if (otherSubscribers.length >= 512) throw new CommunicationError('topic-full', 'A topic can have at most 512 subscribers.')
      const alreadySubscribed = state.subscriptions.some(item => principalKey(item.principal) === key && item.topic === parsed.topic)
      if (!alreadySubscribed && state.subscriptions.length >= MAX_SUBSCRIPTIONS) {
        throw new CommunicationError('subscription-limit', 'Communication subscription capacity is full.')
      }
      const subscriptions = state.subscriptions.filter(item => !(principalKey(item.principal) === key && item.topic === parsed.topic))
      subscriptions.push(subscription)
      const workspaceOptOuts = parsed.topic.startsWith('workspace/')
        ? state.workspaceOptOuts.filter(agentId => principal.kind !== 'agent' || agentId !== principal.id)
        : state.workspaceOptOuts
      return { state: { ...state, subscriptions, workspaceOptOuts }, value: undefined }
    })
    return subscription
  }

  async ensureSubscription(
    principalInput: CommunicationPrincipal,
    input: { readonly topic: string; readonly delivery: CommunicationDelivery },
  ): Promise<CommunicationSubscription | undefined> {
    const principal = communicationPrincipalSchema.parse(principalInput)
    const key = principalKey(principal)
    const topic = assertTopic(input.topic, true)
    const state = await this.#readState()
    if (principal.kind === 'agent' && topic.startsWith('workspace/') && state.workspaceOptOuts.includes(principal.id)) return undefined
    const current = state.subscriptions.find(item => principalKey(item.principal) === key && item.topic === topic)
    if (current !== undefined) return current
    return this.subscribe(principal, input)
  }

  async unsubscribe(principalInput: CommunicationPrincipal, topicInput: string): Promise<{ readonly removed: boolean }> {
    const principal = communicationPrincipalSchema.parse(principalInput)
    const topic = assertTopic(topicInput, true)
    if (topic === 'inbox') {
      throw new CommunicationError('private-inbox-always-available', 'The private inbox cannot be unsubscribed; set its delivery to quiet to mute notices.')
    }
    let removed = false
    await this.#updateState(state => {
      const key = principalKey(principal)
      const subscriptions = state.subscriptions.filter(item => {
        const keep = principalKey(item.principal) !== key || item.topic !== topic
        if (!keep) removed = true
        return keep
      })
      const workspaceOptOuts = principal.kind === 'agent' && topic.startsWith('workspace/') ? [...state.workspaceOptOuts, principal.id] : state.workspaceOptOuts
      return { state: { ...state, subscriptions, workspaceOptOuts }, value: undefined }
    })
    return { removed }
  }

  async publish(input: CommunicationPublishInput): Promise<CommunicationMessage> {
    const sender = communicationPrincipalSchema.parse(input.sender)
    const parsed = messageInputSchema.parse({ topic: input.topic, text: input.text, priority: input.priority })
    const topic = assertTopic(parsed.topic)
    const message = await this.#updateState(state => {
      const recipients = state.subscriptions
        .filter(subscription => subscription.topic === topic && principalKey(subscription.principal) !== principalKey(sender))
        .map(subscription => ({
          principal: subscription.principal,
          delivery: subscription.delivery,
          allowSteerFrom: subscription.allowSteerFrom,
        }))
      const item = communicationMessageSchema.parse({
        id: messageId(),
        topic,
        sender,
        text: parsed.text,
        priority: parsed.priority,
        createdAt: this.#now(),
        recipients,
      })
      return { state: { ...state, messages: [...state.messages, item] }, value: item }
    })
    await this.#deliverPending(message)
    return message
  }

  async send(input: CommunicationSendInput): Promise<CommunicationMessage> {
    const sender = communicationPrincipalSchema.parse(input.sender)
    const parsed = directMessageInputSchema.parse({ toAgentId: input.toAgentId, text: input.text, priority: input.priority })
    const recipient: CommunicationPrincipal = { kind: 'agent', id: parsed.toAgentId }
    if (principalKey(sender) === principalKey(recipient)) {
      throw new CommunicationError('self-message', 'A DSH Agent cannot send a direct message to itself.')
    }
    const message = await this.#updateState(state => {
      const inboxSubscription = state.subscriptions.find(item => item.topic === 'inbox' && principalKey(item.principal) === principalKey(recipient))
      const item = communicationMessageSchema.parse({
        id: messageId(),
        topic: null,
        sender,
        text: parsed.text,
        priority: parsed.priority,
        createdAt: this.#now(),
        recipients: [
          {
            principal: recipient,
            delivery: inboxSubscription?.delivery ?? 'queue',
            allowSteerFrom: inboxSubscription?.allowSteerFrom ?? [],
          },
        ],
      })
      return { state: { ...state, messages: [...state.messages, item] }, value: item }
    })
    await this.#deliverPending(message)
    return message
  }

  async inbox(input: CommunicationInboxInput): Promise<readonly CommunicationMessage[]> {
    const principal = communicationPrincipalSchema.parse(input.principal)
    const topic = input.topic === undefined ? undefined : assertTopic(input.topic, true)
    const limit = input.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new CommunicationError('invalid-limit', 'Inbox limit must be an integer from 1 to 500.')
    }
    const state = await this.#readState()
    const acked = new Set(state.acknowledgements.filter(entry => principalKey(entry.principal) === principalKey(principal)).map(entry => entry.messageId))
    return state.messages
      .filter(message => message.recipients.some(recipient => principalKey(recipient.principal) === principalKey(principal)))
      .filter(message => !acked.has(message.id))
      .filter(message => topic === undefined || (topic === 'inbox' ? message.topic === null : message.topic === topic))
      .slice(-limit)
  }

  async acknowledge(principalInput: CommunicationPrincipal, messageIdInput: string): Promise<{ readonly acknowledged: boolean }> {
    const principal = communicationPrincipalSchema.parse(principalInput)
    const id = z.string().uuid().parse(messageIdInput)
    let acknowledged = false
    await this.#updateState(state => {
      const message = state.messages.find(item => item.id === id)
      if (!message || !message.recipients.some(recipient => principalKey(recipient.principal) === principalKey(principal))) {
        throw new CommunicationError('message-not-found', 'Message is not present in this subscriber inbox.')
      }
      const alreadyAcknowledged = state.acknowledgements.some(entry => entry.messageId === id && principalKey(entry.principal) === principalKey(principal))
      if (!alreadyAcknowledged) {
        acknowledged = true
        return {
          state: { ...state, acknowledgements: [...state.acknowledgements, { messageId: id, principal, acknowledgedAt: this.#now() }] },
          value: undefined,
        }
      }
      return { state, value: undefined }
    })
    return { acknowledged }
  }

  async deliverPending(agentId: string): Promise<void> {
    if (this.#notifyAgent === undefined) return
    const state = await this.#readState()
    const notifications = state.messages.filter(message =>
      message.recipients.some(recipient => recipient.principal.kind === 'agent' && recipient.principal.id === agentId && recipient.delivery !== 'quiet'),
    )
    for (const message of notifications) await this.#deliverPending(message, agentId)
  }

  async #deliverPending(message: CommunicationMessage, onlyAgentId?: string): Promise<void> {
    if (this.#notifyAgent === undefined) return
    for (const recipient of message.recipients) {
      if (recipient.principal.kind !== 'agent' || recipient.delivery === 'quiet') continue
      if (onlyAgentId !== undefined && recipient.principal.id !== onlyAgentId) continue
      const notificationKey = `${message.id}:${recipient.principal.id}`
      if (this.#inFlightNotifications.has(notificationKey)) continue
      const state = await this.#readState()
      const alreadyNotified = state.notifications.some(entry => entry.messageId === message.id && entry.agentId === recipient.principal.id)
      if (alreadyNotified) continue
      this.#inFlightNotifications.add(notificationKey)
      try {
        await this.#notifyAgent(recipient.principal.id, message, recipient.delivery, recipient.allowSteerFrom)
        await this.#updateState(current => ({
          state: { ...current, notifications: [...current.notifications, { messageId: message.id, agentId: recipient.principal.id, notifiedAt: this.#now() }] },
          value: undefined,
        }))
      } catch {
        // The durable inbox remains authoritative; agent creation retries notice delivery.
      } finally {
        this.#inFlightNotifications.delete(notificationKey)
      }
    }
  }

  async #readState(): Promise<CommunicationState> {
    const directoryInfo = await lstat(dirname(this.#statePath)).catch(error => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw new CommunicationError('state-unreadable', 'Communication state directory is invalid or unreadable; it was left untouched.')
    })
    if (directoryInfo !== undefined && (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) !== 0)) {
      throw new CommunicationError('state-directory-permissions', 'Communication state directory must be a private directory with no group or other access.')
    }
    if (directoryInfo !== undefined && typeof process.getuid === 'function' && directoryInfo.uid !== process.getuid()) {
      throw new CommunicationError('state-directory-owner', 'Communication state directory belongs to a different user.')
    }
    const fileInfo = await lstat(this.#statePath).catch(error => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw new CommunicationError('state-unreadable', 'Communication state is invalid or unreadable; it was left untouched.')
    })
    if (fileInfo === undefined) return initialState()
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || (fileInfo.mode & 0o077) !== 0) {
      throw new CommunicationError('state-permissions', 'Communication state must be a private regular file.')
    }
    if (typeof process.getuid === 'function' && fileInfo.uid !== process.getuid()) {
      throw new CommunicationError('state-owner', 'Communication state belongs to a different user.')
    }
    if (fileInfo.size > MAX_STATE_BYTES) throw new CommunicationError('state-too-large', 'Communication state exceeds its size limit.')
    let text: string
    try {
      text = await readFile(this.#statePath, 'utf8')
    } catch {
      throw new CommunicationError('state-unreadable', 'Communication state is invalid or unreadable; it was left untouched.')
    }
    if (Buffer.byteLength(text) > MAX_STATE_BYTES) throw new CommunicationError('state-too-large', 'Communication state exceeds its size limit.')
    try {
      const value: unknown = JSON.parse(text)
      const persistedState = persistedCommunicationStateSchema.parse(value)
      const state = persistedState.schemaVersion === 1 ? migrateLegacyState(persistedState) : persistedState
      return cleanState(state, this.#now())
    } catch {
      throw new CommunicationError('state-unreadable', 'Communication state is invalid or unreadable; it was left untouched.')
    }
  }

  async #updateState<T>(update: (state: CommunicationState) => { readonly state: CommunicationState; readonly value: T }): Promise<T> {
    const operation = this.#writes.then(async () => {
      const current = cleanState(await this.#readState(), this.#now())
      const updated = update(current)
      const parsed = communicationStateSchema.parse(cleanState(updated.state, this.#now()))
      const serialized = `${JSON.stringify(parsed)}\n`
      if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) {
        throw new CommunicationError('state-too-large', 'Communication state exceeds its size limit.')
      }
      const stateDirectory = dirname(this.#statePath)
      await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
      const directoryInfo = await lstat(stateDirectory)
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) !== 0) {
        throw new CommunicationError('state-directory-permissions', 'Communication state directory must be a private directory with no group or other access.')
      }
      if (typeof process.getuid === 'function' && directoryInfo.uid !== process.getuid()) {
        throw new CommunicationError('state-directory-owner', 'Communication state directory belongs to a different user.')
      }
      await writeFileAtomic(this.#statePath, serialized, { mode: 0o600, fsync: true })
      await chmod(this.#statePath, 0o600)
      return updated.value
    })
    this.#writes = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }
}

export const createCommunicationService = (options: CommunicationServiceOptions = {}): CommunicationService => new CommunicationService(options)

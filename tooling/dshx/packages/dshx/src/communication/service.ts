import { chmod, lstat, mkdir, readFile } from 'node:fs/promises'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import writeFileAtomic from 'write-file-atomic'
import { decodeJson, jsonValueSchema } from '../json.js'
import {
  communicationActivityEventSchema,
  communicationAgentSchema,
  communicationDiagnosticAgentSchema,
  communicationDiagnosticRecipientSchema,
  communicationDiagnosticsSchema,
  communicationMessageBodySchema,
  communicationMessageIntentSchema,
  communicationMessagePageSchema,
  communicationMessageRecipientsSchema,
  communicationDiagnosticMessageSchema,
  communicationMessageSchema,
  communicationPrincipalSchema,
  communicationStateSchema,
  communicationStateV1Schema,
  communicationStateV2Schema,
  communicationStateV3Schema,
  communicationStateV4Schema,
  type CommunicationActivityEvent,
  type CommunicationActivityOperation,
  type CommunicationAgent,
  type CommunicationDiagnostics,
  type CommunicationMessage,
  type CommunicationMessageBody,
  type CommunicationMessageIntent,
  type CommunicationMessagePage,
  type CommunicationMessageRecipients,
  type CommunicationPrincipal,
  type CommunicationPriority,
  type CommunicationState,
  type CommunicationStateV4,
  type CommunicationStateV1,
  type CommunicationStateV2,
  type CommunicationStateV3,
} from './types.js'
import { isOwnerOnly } from '../bridge/local-endpoint.js'

const MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_MESSAGES = 5_000
const MAX_ACTIVITY_EVENTS = 5_000
const MAX_DIAGNOSTIC_ROWS = 100
const MAX_STATE_BYTES = 16 * 1024 * 1024
/** Bounds how long a cached read can serve state that retention would already have pruned. */
const STATE_CACHE_TTL_MS = 30_000
/** Telemetry buffers for at most this long, so a burst of tool calls costs one durable state write. */
export const ACTIVITY_BATCH_DELAY_MS = 25
/** A burst this large flushes immediately instead of growing the buffer. */
export const ACTIVITY_BATCH_LIMIT = 100
const MAX_ACKNOWLEDGEMENTS = 100_000

const strictStruct = <const Fields extends Schema.Struct.Fields>(fields: Fields) => {
  const struct = Schema.Struct(fields)
  return Schema.StructWithRest(struct, [
    Schema.Record(Schema.String.check(Schema.makeFilter(key => !Object.prototype.hasOwnProperty.call(fields, key))), Schema.Never),
  ])
}

const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S['Type'] => Schema.decodeUnknownSync(schema)(value)
const boundedString = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const directMessageInputSchema = strictStruct({
  toAgentId: boundedString(1, 256),
  text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(12_000)),
  intent: communicationMessageIntentSchema.pipe(Schema.withDecodingDefaultType(Effect.succeed('notice'))),
  priority: Schema.Literals(['normal', 'urgent']).pipe(Schema.withDecodingDefaultType(Effect.succeed('normal'))),
  correlationId: Schema.optional(boundedString(1, 128)),
  dedupeKey: Schema.optional(boundedString(1, 128)),
})

export interface CommunicationServiceOptions {
  readonly statePath?: string
  readonly now?: () => number
}

/** One principal's unread count, as a bulk read reports it. */
export interface CommunicationUnreadCount {
  readonly principal: CommunicationPrincipal
  readonly count: number
}

export interface CommunicationSendInput {
  readonly sender: CommunicationPrincipal
  readonly toAgentId: string
  readonly text: string
  readonly intent?: CommunicationMessageIntent
  readonly priority?: 'normal' | 'urgent'
  readonly correlationId?: string
  readonly dedupeKey?: string
}

export interface CommunicationInboxInput {
  readonly principal: CommunicationPrincipal
  readonly limit?: number | undefined
  readonly includeSeen?: boolean | undefined
}

export interface CommunicationBrowseInput {
  readonly agentId?: string | undefined
  readonly search?: string | undefined
  readonly beforeId?: string | undefined
  readonly limit?: number | undefined
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

const persistedCommunicationStateSchema = Schema.Union([
  communicationStateV1Schema,
  communicationStateV2Schema,
  communicationStateV3Schema,
  communicationStateV4Schema,
  communicationStateSchema,
])

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
  schemaVersion: 5,
  messages: [],
  acknowledgements: [],
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
    schemaVersion: 5,
    messages,
    acknowledgements: state.acknowledgements.filter(entry => survivingIds.has(entry.messageId)).slice(-MAX_ACKNOWLEDGEMENTS),
    activityStartedAt: state.activityStartedAt,
    activityEvents,
  }
}

const messageId = (): string => randomUUID()

const normalizeMessage = (message: {
  readonly id: string
  readonly sender: CommunicationPrincipal
  readonly text: string
  readonly priority: CommunicationPriority
  readonly createdAt: number
  readonly recipients: readonly { readonly principal: CommunicationPrincipal; readonly readAt?: number | null }[]
  readonly intent?: CommunicationMessageIntent
  readonly correlationId?: string | null
  readonly dedupeKey?: string | null
}) =>
  decode(communicationMessageSchema, {
    id: message.id,
    sender: message.sender,
    text: message.text,
    intent: message.intent ?? 'notice',
    priority: message.priority,
    correlationId: message.correlationId ?? null,
    dedupeKey: message.dedupeKey ?? null,
    createdAt: message.createdAt,
    recipients: message.recipients.map(recipient => ({ principal: recipient.principal, delivery: 'passive', readAt: recipient.readAt ?? null })),
  })

/** Older stores held subscriptions, workspace opt-outs and topic messages; peer topics are gone, so every version migrates to direct mail. */
const migrateLegacyState = (state: CommunicationStateV1 | CommunicationStateV2 | CommunicationStateV3 | CommunicationStateV4): CommunicationState =>
  decode(communicationStateSchema, {
    schemaVersion: 5,
    messages: state.messages.filter(message => message.recipients.length > 0).map(normalizeMessage),
    acknowledgements: state.acknowledgements,
    activityStartedAt: state.schemaVersion === 1 ? null : state.activityStartedAt,
    activityEvents: state.schemaVersion === 1 ? [] : state.activityEvents,
  })

export class CommunicationService {
  readonly #statePath: string
  readonly #now: () => number
  #writes: Promise<void> = Promise.resolve()
  readonly #queuedActivity: { readonly input: CommunicationActivityInput; readonly settle: () => void; readonly reject: (error: unknown) => void }[] = []
  #activityTimer: ReturnType<typeof setTimeout> | undefined
  #cachedState: { readonly revision: string; readonly at: number; readonly state: CommunicationState } | undefined

  constructor(options: CommunicationServiceOptions = {}) {
    this.#statePath = options.statePath ?? defaultStatePath()
    this.#now = options.now ?? Date.now
  }

  async browseMessages(input: CommunicationBrowseInput = {}): Promise<CommunicationMessagePage> {
    const browseMessagesInputSchema = strictStruct({
      agentId: Schema.optional(boundedString(1, 256)),
      search: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
      beforeId: Schema.optional(Schema.String.check(Schema.isUUID())),
      limit: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)).pipe(
        Schema.withDecodingDefaultType(Effect.succeed(50)),
      ),
    })
    const parsed = decode(browseMessagesInputSchema, input)

    const state = await this.#readState()
    const search = parsed.search?.toLocaleLowerCase()
    const matches = state.messages.filter(message => {
      if (
        parsed.agentId !== undefined &&
        (message.sender.kind !== 'agent' || message.sender.id !== parsed.agentId) &&
        !message.recipients.some(recipient => recipient.principal.kind === 'agent' && recipient.principal.id === parsed.agentId)
      ) {
        return false
      }
      return search === undefined || message.text.toLocaleLowerCase().includes(search)
    })
    let endIndex = matches.length
    if (parsed.beforeId !== undefined) {
      const cursorIndex = matches.findIndex(message => message.id === parsed.beforeId)
      if (cursorIndex < 0) throw new CommunicationError('cursor-not-found', 'The message page cursor is no longer available; refresh the conversation.')
      endIndex = cursorIndex
    }
    const startIndex = Math.max(0, endIndex - parsed.limit)
    const items = matches.slice(startIndex, endIndex)
    return decode(communicationMessagePageSchema, {
      items,
      nextCursor: startIndex > 0 ? (items[0]?.id ?? null) : null,
      totalMatching: matches.length,
    })
  }

  async recordActivity(input: CommunicationActivityInput): Promise<void> {
    await this.recordActivities([input])
  }

  /**
   * Append many telemetry records in one durable state write. Every write serializes and fsyncs the whole snapshot,
   * so a burst that used one call per record paid one full write each.
   * @param inputs - the activity records to append, in order.
   */
  async recordActivities(inputs: readonly CommunicationActivityInput[]): Promise<void> {
    if (inputs.length === 0) return
    const events: CommunicationActivityEvent[] = inputs.map(input =>
      decode(communicationActivityEventSchema, {
        id: randomUUID(),
        principal: input.principal,
        operation: input.operation,
        outcome: input.outcome,
        occurredAt: input.occurredAt,
        durationMs: input.durationMs,
        callId: input.callId,
        rootCallId: input.rootCallId ?? null,
        errorCode: input.errorCode ?? null,
      }),
    )
    await this.#updateState(state => ({
      state: {
        ...state,
        activityStartedAt: state.activityStartedAt ?? events[0]?.occurredAt ?? this.#now(),
        activityEvents: [...state.activityEvents, ...events],
      },
      value: undefined,
    }))
  }

  /**
   * Buffer one telemetry record into the next batch; its promise settles after that batch is durably written, so a
   * burst costs one state write while each caller keeps the old durability contract. A crash can lose records that
   * were still buffered, which is bounded by `ACTIVITY_BATCH_DELAY_MS`.
   * @param input - the activity record to append.
   */
  enqueueActivity(input: CommunicationActivityInput): Promise<void> {
    return new Promise((settle, reject) => {
      this.#queuedActivity.push({ input, settle, reject })
      if (this.#queuedActivity.length >= ACTIVITY_BATCH_LIMIT) {
        void this.#flushActivity().catch(() => undefined)
        return
      }
      if (this.#activityTimer === undefined) {
        this.#activityTimer = setTimeout(() => {
          this.#activityTimer = undefined
          void this.#flushActivity().catch(() => undefined)
        }, ACTIVITY_BATCH_DELAY_MS)
      }
    })
  }

  /** Write buffered telemetry now and wait for the writes already running; a shutdown awaits this. */
  async drainActivity(): Promise<void> {
    await this.#flushActivity().catch(() => undefined)
    await this.#writes
  }

  async #flushActivity(): Promise<void> {
    if (this.#activityTimer !== undefined) {
      clearTimeout(this.#activityTimer)
      this.#activityTimer = undefined
    }
    const batch = this.#queuedActivity.splice(0)
    if (batch.length === 0) return
    try {
      await this.recordActivities(batch.map(item => item.input))
      for (const item of batch) item.settle()
    } catch (error) {
      for (const item of batch) item.reject(error)
      throw error
    }
  }

  async diagnostics(input: { readonly agents: readonly CommunicationAgent[]; readonly limit?: number }): Promise<CommunicationDiagnostics> {
    const limit = input.limit ?? 20
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DIAGNOSTIC_ROWS) {
      throw new CommunicationError('invalid-limit', `Diagnostic limit must be an integer from 1 to ${MAX_DIAGNOSTIC_ROWS}.`)
    }

    const state = await this.#readState()
    const agents = decode(Schema.Array(communicationAgentSchema), input.agents)
    const acknowledgements = new Map(state.acknowledgements.map(entry => [`${entry.messageId}:${principalKey(entry.principal)}`, entry.acknowledgedAt]))
    let pendingMessageCount = 0
    let pendingRecipientCount = 0

    for (const message of state.messages) {
      let hasPendingRecipient = false
      for (const recipient of message.recipients) {
        if (acknowledgements.has(`${message.id}:${principalKey(recipient.principal)}`)) continue
        pendingRecipientCount += 1
        hasPendingRecipient = true
      }
      if (hasPendingRecipient) pendingMessageCount += 1
    }

    const recentMessages = state.messages
      .slice(-limit)
      .reverse()
      .map(message => {
        const pendingRecipients = message.recipients.filter(recipient => !acknowledgements.has(`${message.id}:${principalKey(recipient.principal)}`))
        return decode(communicationDiagnosticMessageSchema, {
          id: message.id,
          sender: message.sender,
          intent: message.intent,
          priority: message.priority,
          createdAt: message.createdAt,
          recipientCount: message.recipients.length,
          pendingRecipientCount: pendingRecipients.length,
        })
      })

    return decode(communicationDiagnosticsSchema, {
      generatedAt: this.#now(),
      agentCount: agents.length,
      agents: agents.slice(0, limit).map(agent => decode(communicationDiagnosticAgentSchema, { id: agent.id, status: agent.status })),
      messageCount: state.messages.length,
      pendingMessageCount,
      pendingRecipientCount,
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

  async messageRecipients(messageIdInput: string): Promise<CommunicationMessageRecipients> {
    const { state, message } = await this.#readMessage(messageIdInput)
    const acknowledgements = new Map(
      state.acknowledgements.filter(entry => entry.messageId === message.id).map(entry => [principalKey(entry.principal), entry.acknowledgedAt]),
    )
    return decode(communicationMessageRecipientsSchema, {
      messageId: message.id,
      recipientCount: message.recipients.length,
      recipients: message.recipients.map(recipient =>
        decode(communicationDiagnosticRecipientSchema, {
          principal: recipient.principal,
          delivery: recipient.delivery,
          readAt: recipient.readAt,
          acknowledgedAt: acknowledgements.get(principalKey(recipient.principal)) ?? null,
        }),
      ),
    })
  }

  async revealMessageBody(messageIdInput: string): Promise<CommunicationMessageBody> {
    const { message } = await this.#readMessage(messageIdInput)
    return decode(communicationMessageBodySchema, { messageId: message.id, text: message.text })
  }

  /**
   * Unread, unacknowledged messages waiting for one principal. A message already opened by an inbox read stays
   * unacknowledged until it is explicitly acknowledged, so it does not count as new here.
   */
  async unreadCount(principalInput: CommunicationPrincipal): Promise<number> {
    const [reading] = await this.unreadCounts([principalInput])
    return reading?.count ?? 0
  }

  /**
   * The same count for many principals in one secured state read: acknowledgement sets are indexed once and the
   * message/recipient sweep runs once, instead of once per principal. Counts are per message, so two recipients of
   * one message for a principal still read as one unread message.
   * @param principalsInput - the principals to report, in order.
   * @returns one reading per input principal, duplicates included.
   */
  async unreadCounts(principalsInput: readonly CommunicationPrincipal[]): Promise<readonly CommunicationUnreadCount[]> {
    const principals = principalsInput.map(principal => decode(communicationPrincipalSchema, principal))
    if (principals.length === 0) return []
    const state = await this.#readState()
    const wanted = new Map<string, { readonly principal: CommunicationPrincipal; count: number; readonly acknowledged: Set<string> }>()
    for (const principal of principals) {
      const key = principalKey(principal)
      if (!wanted.has(key)) wanted.set(key, { principal, count: 0, acknowledged: new Set() })
    }
    for (const entry of state.acknowledgements) wanted.get(principalKey(entry.principal))?.acknowledged.add(entry.messageId)
    // Reused across messages so the sweep stays allocation-free per message.
    const countedForMessage = new Set<string>()
    for (const message of state.messages) {
      countedForMessage.clear()
      for (const recipient of message.recipients) {
        if (recipient.readAt !== null) continue
        const key = principalKey(recipient.principal)
        const reading = wanted.get(key)
        if (reading === undefined || reading.acknowledged.has(message.id) || countedForMessage.has(key)) continue
        countedForMessage.add(key)
        reading.count += 1
      }
    }
    return principals.map(principal => {
      const reading = wanted.get(principalKey(principal))
      return { principal, count: reading?.count ?? 0 }
    })
  }

  async send(input: CommunicationSendInput): Promise<CommunicationMessage> {
    const sender = decode(communicationPrincipalSchema, input.sender)
    const parsed = decode(directMessageInputSchema, {
      toAgentId: input.toAgentId,
      text: input.text,
      intent: input.intent,
      priority: input.priority,
      correlationId: input.correlationId,
      dedupeKey: input.dedupeKey,
    })
    const recipient: CommunicationPrincipal = { kind: 'agent', id: parsed.toAgentId }
    const senderKey = principalKey(sender)
    if (senderKey === principalKey(recipient)) {
      throw new CommunicationError('self-message', 'A DSH Agent cannot send a direct message to itself.')
    }
    const message = await this.#updateState(state => {
      const duplicate =
        parsed.dedupeKey === undefined
          ? undefined
          : state.messages.find(
              item =>
                item.dedupeKey === parsed.dedupeKey &&
                principalKey(item.sender) === senderKey &&
                item.recipients.some(entry => entry.principal.kind === 'agent' && entry.principal.id === parsed.toAgentId),
            )
      if (duplicate !== undefined) return { state, value: duplicate }
      const item = decode(communicationMessageSchema, {
        id: messageId(),
        sender,
        text: parsed.text,
        intent: parsed.intent,
        priority: parsed.priority,
        correlationId: parsed.correlationId ?? null,
        dedupeKey: parsed.dedupeKey ?? null,
        createdAt: this.#now(),
        recipients: [{ principal: recipient, delivery: 'passive', readAt: null }],
      })
      return { state: { ...state, messages: [...state.messages, item] }, value: item }
    })
    return message
  }

  async inbox(input: CommunicationInboxInput): Promise<readonly CommunicationMessage[]> {
    const principal = decode(communicationPrincipalSchema, input.principal)
    const limit = input.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new CommunicationError('invalid-limit', 'Inbox limit must be an integer from 1 to 500.')
    }
    return this.#updateState(state => {
      const principalId = principalKey(principal)
      const acknowledgedMessageIds = new Set(
        state.acknowledgements.filter(entry => principalKey(entry.principal) === principalId).map(entry => entry.messageId),
      )
      const matchingMessages = state.messages
        .filter(message => message.recipients.some(recipient => principalKey(recipient.principal) === principalId))
        .filter(message => !acknowledgedMessageIds.has(message.id))
        .filter(
          message =>
            input.includeSeen === true || message.recipients.some(recipient => principalKey(recipient.principal) === principalId && recipient.readAt === null),
        )
        .slice(-limit)
      if (
        !matchingMessages.some(message => message.recipients.some(recipient => principalKey(recipient.principal) === principalId && recipient.readAt === null))
      ) {
        return { state, value: matchingMessages }
      }
      const matchingMessageIds = new Set(matchingMessages.map(message => message.id))
      const readAt = this.#now()
      const messages = state.messages.map(message => {
        if (!matchingMessageIds.has(message.id)) return message
        return {
          ...message,
          recipients: message.recipients.map(recipient =>
            principalKey(recipient.principal) === principalId ? { ...recipient, readAt: recipient.readAt ?? readAt } : recipient,
          ),
        }
      })
      const items = messages.filter(message => matchingMessageIds.has(message.id))
      return { state: { ...state, messages }, value: items }
    })
  }

  async acknowledge(principalInput: CommunicationPrincipal, messageIdInput: string): Promise<{ readonly acknowledged: boolean }> {
    const principal = decode(communicationPrincipalSchema, principalInput)
    const id = decode(Schema.String.check(Schema.isUUID()), messageIdInput)
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

  async #readMessage(messageIdInput: string): Promise<{ readonly state: CommunicationState; readonly message: CommunicationMessage }> {
    const messageId = decode(Schema.String.check(Schema.isUUID()), messageIdInput)
    const state = await this.#readState()
    const message = state.messages.find(item => item.id === messageId)
    if (message === undefined) throw new CommunicationError('message-not-found', 'Message is no longer retained.')
    return { state, message }
  }

  async #readState(): Promise<CommunicationState> {
    const directoryInfo = await lstat(dirname(this.#statePath)).catch(error => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw new CommunicationError('state-unreadable', 'Communication state directory is invalid or unreadable; it was left untouched.')
    })
    if (directoryInfo !== undefined && (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !isOwnerOnly(directoryInfo))) {
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
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || !isOwnerOnly(fileInfo)) {
      throw new CommunicationError('state-permissions', 'Communication state must be a private regular file.')
    }
    if (typeof process.getuid === 'function' && fileInfo.uid !== process.getuid()) {
      throw new CommunicationError('state-owner', 'Communication state belongs to a different user.')
    }
    if (fileInfo.size > MAX_STATE_BYTES) throw new CommunicationError('state-too-large', 'Communication state exceeds its size limit.')
    // Every write replaces the file atomically, so an unchanged (device, inode, size, mtime) triple means unchanged
    // state. The per-step Agent tools and the unread nudge re-read this file often, and parsing it is the expensive part.
    const revision = `${fileInfo.dev}:${fileInfo.ino}:${fileInfo.size}:${fileInfo.mtimeMs}`
    const cached = this.#cachedState
    if (cached?.revision === revision && this.#now() - cached.at < STATE_CACHE_TTL_MS) return cached.state
    let text: string
    try {
      text = await readFile(this.#statePath, 'utf8')
    } catch {
      throw new CommunicationError('state-unreadable', 'Communication state is invalid or unreadable; it was left untouched.')
    }
    if (Buffer.byteLength(text) > MAX_STATE_BYTES) throw new CommunicationError('state-too-large', 'Communication state exceeds its size limit.')
    try {
      const persistedState = decode(persistedCommunicationStateSchema, decodeJson(jsonValueSchema, text))
      const state = persistedState.schemaVersion === 5 ? persistedState : migrateLegacyState(persistedState)
      const cleaned = cleanState(state, this.#now())
      this.#cachedState = { revision, at: this.#now(), state: cleaned }
      return cleaned
    } catch {
      throw new CommunicationError('state-unreadable', 'Communication state is invalid or unreadable; it was left untouched.')
    }
  }

  async #updateState<T>(update: (state: CommunicationState) => { readonly state: CommunicationState; readonly value: T }): Promise<T> {
    const operation = this.#writes.then(async () => {
      const current = cleanState(await this.#readState(), this.#now())
      const updated = update(current)
      if (updated.state === current) return updated.value
      const parsed = decode(communicationStateSchema, cleanState(updated.state, this.#now()))
      const serialized = `${JSON.stringify(parsed)}\n`
      if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) {
        throw new CommunicationError('state-too-large', 'Communication state exceeds its size limit.')
      }
      const stateDirectory = dirname(this.#statePath)
      await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
      const directoryInfo = await lstat(stateDirectory)
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !isOwnerOnly(directoryInfo)) {
        throw new CommunicationError('state-directory-permissions', 'Communication state directory must be a private directory with no group or other access.')
      }
      if (typeof process.getuid === 'function' && directoryInfo.uid !== process.getuid()) {
        throw new CommunicationError('state-directory-owner', 'Communication state directory belongs to a different user.')
      }
      await writeFileAtomic(this.#statePath, serialized, { mode: 0o600, fsync: true })
      await chmod(this.#statePath, 0o600)
      this.#cachedState = undefined
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

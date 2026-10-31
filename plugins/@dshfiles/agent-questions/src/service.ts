import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { Context, Effect, Schema } from 'effect'
import { createKeyedEffectLock } from './keyed-effect-lock.js'
import {
  deferredFilePathSchema,
  parentQuestionExpiryBehaviorSchema,
  parentQuestionRecordEffectSchema,
  parentQuestionOptionsSchema,
  type ParentQuestionExpiryBehavior,
  type ParentQuestionRecord,
  type ParentQuestionTable,
} from './store.js'

const trimmedString = (minimum: number, maximum: number) => Schema.Trim.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const decodeStrict = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S['Type'] =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value)

const requestInputSchema = Schema.Struct({
  operationId: trimmedString(1, 256),
  question: trimmedString(1, 4_000),
  context: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(16_000))),
  options: parentQuestionOptionsSchema,
  recommendedOptionId: trimmedString(1, 80),
  expiryBehavior: parentQuestionExpiryBehaviorSchema,
  timeoutMs: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1_000, maximum: 3_600_000 })),
}).check(
  Schema.makeFilter(request =>
    request.options.some(option => option.id === request.recommendedOptionId)
      ? undefined
      : { path: ['recommendedOptionId'], issue: 'The recommended option must exist in the question options.' },
  ),
)

const answerInputSchema = trimmedString(1, 4_000)
const parentQuestionListInputSchema = Schema.Struct({ childSessionId: Schema.optionalKey(trimmedString(1, 256)) })

const MAX_STORED_QUESTIONS = 1_000
const MAX_PENDING_PER_PARENT = 50
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export interface ParentQuestionAgent {
  readonly id: string
}

export interface ParentQuestionRuntime {
  readonly isLive: (agent: ParentQuestionAgent) => boolean
  readonly parentSessionId: (childSessionId: string) => string | undefined
  readonly isDirectChild: (childSessionId: string, parentSessionId: string) => boolean
  readonly sendToParent: (input: {
    readonly childSessionId: string
    readonly parentSessionId: string
    readonly record: ParentQuestionRecord
    readonly signal: AbortSignal
  }) => Promise<string>
}

export type ParentQuestionOutcome =
  | { readonly kind: 'answered'; readonly questionId: string; readonly answer: string }
  | {
      readonly kind: 'recommended'
      readonly questionId: string
      readonly option: ParentQuestionRecord['options'][number]
    }
  | {
      readonly kind: 'deferred'
      readonly questionId: string
      readonly childSessionId: string
      readonly question: string
      readonly context?: string
      readonly options: ParentQuestionRecord['options']
      readonly recommendedOption: ParentQuestionRecord['options'][number]
      readonly createdAt: number
      readonly deferredAt: number
      readonly filePath?: string
    }
  | { readonly kind: 'cancelled' | 'expired' | 'delivery-failed' | 'interrupted'; readonly questionId: string }

export interface ParentQuestionReceipt {
  readonly questionId: string
  readonly expiresAt: number
  readonly status: ParentQuestionRecord['status']
}

export interface ParentQuestionInboxEntry {
  readonly questionId: string
  readonly childSessionId: string
  readonly question: string
  readonly context?: string
  readonly options: ParentQuestionRecord['options']
  readonly recommendedOptionId?: string
  readonly expiryBehavior?: ParentQuestionExpiryBehavior
  readonly createdAt: number
  readonly expiresAt: number
  readonly remainingMs: number
  readonly expired: boolean
}

export interface ParentQuestionService {
  request(input: {
    readonly agent: ParentQuestionAgent
    readonly operationId: string
    readonly question: string
    readonly context?: string
    readonly options: ParentQuestionRecord['options']
    readonly recommendedOptionId: string
    readonly expiryBehavior: ParentQuestionExpiryBehavior
    readonly timeoutMs: number
    readonly signal: AbortSignal
  }): Promise<ParentQuestionReceipt>
  listForParent(input: { readonly agent: ParentQuestionAgent; readonly childSessionId?: string }): Promise<ParentQuestionInboxEntry[]>
  answer(input: { readonly agent: ParentQuestionAgent; readonly questionId: string; readonly answer: string }): Promise<ParentQuestionOutcome>
  wait(input: { readonly agent: ParentQuestionAgent; readonly questionId: string; readonly signal: AbortSignal }): Promise<ParentQuestionOutcome>
  cancel(input: { readonly agent: ParentQuestionAgent; readonly questionId: string }): Promise<ParentQuestionOutcome>
  recordDeferredFile(input: { readonly agent: ParentQuestionAgent; readonly questionId: string; readonly filePath: string }): Promise<ParentQuestionOutcome>
  close(): Promise<void>
}

export interface ParentQuestionServiceEffectApi {
  request(input: Parameters<ParentQuestionService['request']>[0]): Effect.Effect<ParentQuestionReceipt, ParentQuestionServiceError>
  listForParent(input: Parameters<ParentQuestionService['listForParent']>[0]): Effect.Effect<ParentQuestionInboxEntry[], ParentQuestionServiceError>
  answer(input: Parameters<ParentQuestionService['answer']>[0]): Effect.Effect<ParentQuestionOutcome, ParentQuestionServiceError>
  wait(input: Parameters<ParentQuestionService['wait']>[0]): Effect.Effect<ParentQuestionOutcome, ParentQuestionServiceError>
  cancel(input: Parameters<ParentQuestionService['cancel']>[0]): Effect.Effect<ParentQuestionOutcome, ParentQuestionServiceError>
  recordDeferredFile(input: Parameters<ParentQuestionService['recordDeferredFile']>[0]): Effect.Effect<ParentQuestionOutcome, ParentQuestionServiceError>
  close(): Effect.Effect<void, ParentQuestionServiceError>
}

export class ParentQuestionServiceEffect extends Context.Service<ParentQuestionServiceEffect, ParentQuestionServiceEffectApi>()(
  'agent-questions/ParentQuestionService',
) {}

export class ParentQuestionServiceError extends Schema.TaggedError<ParentQuestionServiceError>()('ParentQuestionServiceError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

interface QuestionWaiter {
  readonly resume: (effect: Effect.Effect<ParentQuestionOutcome, ParentQuestionServiceError>) => void
}

const questionWaitEffects = new WeakMap<ParentQuestionService, ParentQuestionServiceEffectApi['wait']>()

const questionServiceFailure = (operation: string, error: unknown): ParentQuestionServiceError =>
  new ParentQuestionServiceError({ operation, message: error instanceof Error ? error.message : String(error) })

const promiseEffect = <Value>(operation: string, run: () => Promise<Value>): Effect.Effect<Value, ParentQuestionServiceError> =>
  Effect.tryPromise({ try: run, catch: error => questionServiceFailure(operation, error) })

const operationKeyFor = (parentSessionId: string, childSessionId: string, operationId: string): string =>
  createHash('sha256')
    .update(JSON.stringify([parentSessionId, childSessionId, operationId]))
    .digest('hex')

const outcomeOf = (record: ParentQuestionRecord): ParentQuestionOutcome => {
  if (record.status === 'answered') {
    if (record.answer === undefined) throw new Error('An answered question has no answer.')
    return { kind: 'answered', questionId: record.questionId, answer: record.answer }
  }
  if (record.status === 'recommended' || record.status === 'deferred') {
    if (record.recommendedOptionId === undefined) {
      throw new Error('A question outcome has no recommended option.')
    }
    const recommendedOption = record.options.find(option => option.id === record.recommendedOptionId)
    if (recommendedOption === undefined) throw new Error('A question outcome has an unknown recommended option.')
    if (record.status === 'recommended') {
      return { kind: 'recommended', questionId: record.questionId, option: recommendedOption }
    }
    return {
      kind: 'deferred',
      questionId: record.questionId,
      childSessionId: record.childSessionId,
      question: record.question,
      ...(record.context !== undefined && { context: record.context }),
      options: record.options,
      recommendedOption,
      createdAt: record.createdAt,
      deferredAt: record.updatedAt,
      ...(record.deferredFilePath !== undefined && { filePath: record.deferredFilePath }),
    }
  }
  if (record.status === 'pending') throw new Error('A pending question has no terminal outcome.')
  return { kind: record.status, questionId: record.questionId }
}

const receiptOf = (record: ParentQuestionRecord): ParentQuestionReceipt => ({
  questionId: record.questionId,
  expiresAt: record.expiresAt,
  status: record.status,
})

export const createParentQuestionService = (input: {
  readonly table: () => Promise<ParentQuestionTable>
  readonly runtime: ParentQuestionRuntime
  readonly now?: () => number
}): ParentQuestionService => {
  const operationLocks = createKeyedEffectLock()
  const waiters = new Map<string, Set<QuestionWaiter>>()
  const now = input.now ?? Date.now
  let closed = false

  const assertOpen = (): void => {
    if (closed) throw new Error('Parent question service is closed.')
  }

  const notifyWaiters = (record: ParentQuestionRecord): void => {
    if (record.status === 'pending') return
    const outcome = outcomeOf(record)
    for (const waiter of waiters.get(record.questionId) ?? []) waiter.resume(Effect.succeed(outcome))
  }

  const findByQuestionId = (table: ParentQuestionTable, questionId: string): { readonly key: string; readonly record: ParentQuestionRecord } | undefined => {
    for (const [key, record] of table.entries()) {
      if (record.questionId === questionId) return { key, record }
    }
    return undefined
  }

  const settle = async (
    table: ParentQuestionTable,
    key: string,
    questionId: string,
    status: Exclude<ParentQuestionRecord['status'], 'pending'>,
    answer?: string,
  ): Promise<ParentQuestionRecord> => {
    const updated = await table.update(key, current => {
      if (current.questionId !== questionId || current.status !== 'pending') return current
      const next = status === 'answered' ? { ...current, status, answer, updatedAt: now() } : { ...current, status, updatedAt: now() }
      return decodeStrict(parentQuestionRecordEffectSchema, next)
    })
    if (updated.questionId !== questionId) throw new Error('Parent question identity changed during settlement.')
    notifyWaiters(updated)
    return updated
  }

  const settleExpired = async (table: ParentQuestionTable, key: string, record: ParentQuestionRecord): Promise<ParentQuestionRecord> => {
    if (record.expiryBehavior === 'recommended' && record.recommendedOptionId !== undefined) {
      return settle(table, key, record.questionId, 'recommended')
    }
    if (record.expiryBehavior === 'defer' && record.recommendedOptionId !== undefined) {
      return settle(table, key, record.questionId, 'deferred')
    }
    return settle(table, key, record.questionId, 'expired')
  }

  const findAuthorizedChildQuestion = async (
    agent: ParentQuestionAgent,
    questionId: string,
  ): Promise<{ readonly table: ParentQuestionTable; readonly key: string; readonly record: ParentQuestionRecord }> => {
    if (!input.runtime.isLive(agent)) throw new Error('Question operation requires the exact live Agent.')
    const table = await input.table()
    const found = findByQuestionId(table, questionId)
    if (found === undefined) throw new Error('Parent question was not found.')
    const parentSessionId = input.runtime.parentSessionId(agent.id)
    if (
      found.record.childSessionId !== agent.id ||
      found.record.parentSessionId !== parentSessionId ||
      !input.runtime.isDirectChild(agent.id, found.record.parentSessionId)
    ) {
      throw new Error('Only the requesting direct child can read or cancel this question.')
    }
    return { table, ...found }
  }

  const expireDueQuestions = async (table: ParentQuestionTable): Promise<void> => {
    const timestamp = now()
    for (const [key, record] of table.entries()) {
      if (record.status === 'pending' && record.expiresAt <= timestamp) {
        await settleExpired(table, key, record)
      }
      if (record.status !== 'pending' && record.updatedAt < timestamp - TERMINAL_RETENTION_MS) {
        await table.delete(key)
      }
    }
  }

  const sendQuestion = async (table: ParentQuestionTable, key: string, record: ParentQuestionRecord, signal: AbortSignal): Promise<ParentQuestionRecord> => {
    try {
      const notificationMessageId = await input.runtime.sendToParent({
        childSessionId: record.childSessionId,
        parentSessionId: record.parentSessionId,
        record,
        signal,
      })
      const updated = await table.update(key, current => {
        if (current.questionId !== record.questionId || current.status !== 'pending' || current.notificationMessageId !== undefined) return current
        return decodeStrict(parentQuestionRecordEffectSchema, {
          ...current,
          notificationMessageId,
          updatedAt: now(),
        })
      })
      notifyWaiters(updated)
      return updated
    } catch (error: unknown) {
      const found = table.get(key)
      if (found === undefined || found.questionId !== record.questionId) throw error
      const status = signal.aborted ? 'cancelled' : 'delivery-failed'
      const updated = await settle(table, key, record.questionId, status)
      if (updated.status === 'answered') return updated
      throw error
    }
  }

  const waitEffect: ParentQuestionServiceEffectApi['wait'] = Effect.fn('parent question wait')(waitRequest =>
    Effect.gen(function* () {
      yield* Effect.try({ try: assertOpen, catch: error => questionServiceFailure('wait', error) })
      const found = yield* promiseEffect('wait-authorize', () => findAuthorizedChildQuestion(waitRequest.agent, waitRequest.questionId))
      if (found.record.status !== 'pending') return outcomeOf(found.record)
      if (found.record.expiresAt <= now()) return outcomeOf(yield* promiseEffect('wait-expire', () => settleExpired(found.table, found.key, found.record)))
      if (waitRequest.signal.aborted) {
        return outcomeOf(yield* promiseEffect('wait-cancel', () => settle(found.table, found.key, waitRequest.questionId, 'cancelled')))
      }

      const completion = Effect.callback<ParentQuestionOutcome, ParentQuestionServiceError>(resume => {
        const waiter: QuestionWaiter = { resume }
        const questionWaiters = waiters.get(waitRequest.questionId) ?? new Set<QuestionWaiter>()
        questionWaiters.add(waiter)
        waiters.set(waitRequest.questionId, questionWaiters)
        const onAbort = (): void => {
          void settle(found.table, found.key, waitRequest.questionId, 'cancelled').catch(error =>
            waiter.resume(Effect.fail(questionServiceFailure('wait-cancel', error))),
          )
        }
        waitRequest.signal.addEventListener('abort', onAbort, { once: true })
        if (waitRequest.signal.aborted) onAbort()
        const latest = findByQuestionId(found.table, waitRequest.questionId)
        if (latest === undefined) {
          waiter.resume(Effect.fail(questionServiceFailure('wait', new Error('Parent question disappeared while waiting.'))))
        } else if (latest.record.status !== 'pending') {
          waiter.resume(Effect.succeed(outcomeOf(latest.record)))
        }
        return Effect.sync(() => {
          waitRequest.signal.removeEventListener('abort', onAbort)
          questionWaiters.delete(waiter)
          if (questionWaiters.size === 0) waiters.delete(waitRequest.questionId)
        })
      })
      const expiry = Effect.sleep(Math.max(1, found.record.expiresAt - now())).pipe(
        Effect.andThen(promiseEffect('wait-expire', () => settleExpired(found.table, found.key, found.record))),
        Effect.map(outcomeOf),
      )
      return yield* Effect.raceFirst(completion, expiry)
    }),
  )

  const service: ParentQuestionService = {
    request: async request => {
      assertOpen()
      const parsed = decodeStrict(requestInputSchema, {
        operationId: request.operationId,
        question: request.question,
        ...(request.context !== undefined && { context: request.context }),
        options: request.options,
        recommendedOptionId: request.recommendedOptionId,
        expiryBehavior: request.expiryBehavior,
        timeoutMs: request.timeoutMs,
      })
      const parentSessionId = input.runtime.parentSessionId(request.agent.id)
      if (!input.runtime.isLive(request.agent) || parentSessionId === undefined || !input.runtime.isDirectChild(request.agent.id, parentSessionId)) {
        throw new Error('A question can only be requested by a live direct subagent.')
      }
      request.signal.throwIfAborted()
      const key = operationKeyFor(parentSessionId, request.agent.id, parsed.operationId)
      return operationLocks.run({
        key,
        operation: async () => {
          assertOpen()
          const table = await input.table()
          let record = table.get(key)
          if (record !== undefined) {
            if (
              record.parentSessionId !== parentSessionId ||
              record.childSessionId !== request.agent.id ||
              record.question !== parsed.question ||
              record.context !== parsed.context ||
              JSON.stringify(record.options) !== JSON.stringify(parsed.options) ||
              (record.recommendedOptionId !== undefined &&
                (record.recommendedOptionId !== parsed.recommendedOptionId || record.expiryBehavior !== parsed.expiryBehavior))
            ) {
              throw new Error('Question operation id was reused with different input.')
            }
            if (record.status !== 'pending' || record.notificationMessageId !== undefined) return receiptOf(record)
            record = await sendQuestion(table, key, record, request.signal)
            return receiptOf(record)
          }

          const created = await operationLocks.run({
            key: 'question-admission',
            operation: async () => {
              await expireDueQuestions(table)
              const rows = Array.from(table.entries())
              const pendingForParent = rows.filter(([, row]) => row.parentSessionId === parentSessionId && row.status === 'pending').length
              if (pendingForParent >= MAX_PENDING_PER_PARENT) {
                throw new Error('The parent has reached its pending question limit.')
              }
              if (table.size >= MAX_STORED_QUESTIONS) {
                throw new Error('The retained parent question limit has been reached.')
              }
              const timestamp = now()
              const next = decodeStrict(parentQuestionRecordEffectSchema, {
                questionId: randomUUID(),
                parentSessionId,
                childSessionId: request.agent.id,
                operationId: parsed.operationId,
                question: parsed.question,
                ...(parsed.context !== undefined && { context: parsed.context }),
                options: parsed.options,
                recommendedOptionId: parsed.recommendedOptionId,
                expiryBehavior: parsed.expiryBehavior,
                status: 'pending',
                createdAt: timestamp,
                expiresAt: timestamp + parsed.timeoutMs,
                updatedAt: timestamp,
              })
              await table.put(key, next)
              return next
            },
          })
          record = await sendQuestion(table, key, created, request.signal)
          return receiptOf(record)
        },
      })
    },
    listForParent: async ({ agent, childSessionId }) => {
      assertOpen()
      if (!input.runtime.isLive(agent)) throw new Error('Question list requires the exact live parent Agent.')
      const parsed = decodeStrict(parentQuestionListInputSchema, childSessionId === undefined ? {} : { childSessionId })
      const table = await input.table()
      const timestamp = now()

      return Array.from(table.entries(), ([, record]) => record)
        .filter(
          record =>
            record.parentSessionId === agent.id &&
            record.status === 'pending' &&
            (parsed.childSessionId === undefined || record.childSessionId === parsed.childSessionId),
        )
        .sort((left, right) => left.expiresAt - right.expiresAt)
        .map((record): ParentQuestionInboxEntry => {
          const entry = {
            questionId: record.questionId,
            childSessionId: record.childSessionId,
            question: record.question,
            options: record.options,
            createdAt: record.createdAt,
            expiresAt: record.expiresAt,
            remainingMs: Math.max(0, record.expiresAt - timestamp),
            expired: record.expiresAt <= timestamp,
          } satisfies ParentQuestionInboxEntry
          const entryWithContext = record.context === undefined ? entry : { ...entry, context: record.context }
          const entryWithRecommendation =
            record.recommendedOptionId === undefined ? entryWithContext : { ...entryWithContext, recommendedOptionId: record.recommendedOptionId }
          return record.expiryBehavior === undefined ? entryWithRecommendation : { ...entryWithRecommendation, expiryBehavior: record.expiryBehavior }
        })
    },
    answer: async answerRequest => {
      assertOpen()
      if (!input.runtime.isLive(answerRequest.agent)) {
        throw new Error('Question answer requires the exact live parent Agent.')
      }
      const answer = decodeStrict(answerInputSchema, answerRequest.answer)
      const table = await input.table()
      const found = findByQuestionId(table, answerRequest.questionId)
      if (found === undefined) throw new Error('Parent question was not found.')
      if (found.record.parentSessionId !== answerRequest.agent.id) {
        throw new Error('Only the direct parent can answer this question.')
      }
      if (found.record.status === 'pending' && found.record.expiresAt <= now()) {
        return outcomeOf(await settleExpired(table, found.key, found.record))
      }
      if (found.record.status === 'answered') {
        if (found.record.answer === answer) return outcomeOf(found.record)
        throw new Error('Parent question already has a different answer.')
      }
      if (found.record.status !== 'pending') throw new Error(`Parent question is ${found.record.status}.`)
      const settled = await settle(table, found.key, answerRequest.questionId, 'answered', answer)
      if (settled.status === 'answered' && settled.answer !== answer) {
        throw new Error('Parent question already has a different answer.')
      }
      return outcomeOf(settled)
    },
    wait: waitRequest => Effect.runPromise(waitEffect(waitRequest)),
    cancel: async cancelRequest => {
      assertOpen()
      const found = await findAuthorizedChildQuestion(cancelRequest.agent, cancelRequest.questionId)
      if (found.record.status !== 'pending') return outcomeOf(found.record)
      if (found.record.expiresAt <= now()) {
        return outcomeOf(await settleExpired(found.table, found.key, found.record))
      }
      return outcomeOf(await settle(found.table, found.key, cancelRequest.questionId, 'cancelled'))
    },
    recordDeferredFile: async fileRequest => {
      assertOpen()
      const filePath = decodeStrict(deferredFilePathSchema, fileRequest.filePath)
      return operationLocks.run({
        key: `deferred-file:${fileRequest.questionId}`,
        operation: async () => {
          const found = await findAuthorizedChildQuestion(fileRequest.agent, fileRequest.questionId)
          if (found.record.status !== 'deferred') {
            throw new Error(`Parent question is ${found.record.status}; only deferred questions can attach a file.`)
          }
          if (found.record.deferredFilePath !== undefined && found.record.deferredFilePath !== filePath) {
            throw new Error('Deferred question already has a different file path.')
          }
          const updated = await found.table.update(found.key, current => {
            if (current.questionId !== fileRequest.questionId || current.status !== 'deferred') return current
            if (current.deferredFilePath !== undefined && current.deferredFilePath !== filePath) {
              throw new Error('Deferred question already has a different file path.')
            }
            return decodeStrict(parentQuestionRecordEffectSchema, { ...current, deferredFilePath: filePath })
          })
          if (updated.status !== 'deferred') throw new Error(`Parent question is ${updated.status}.`)
          return outcomeOf(updated)
        },
      })
    },
    close: async () => {
      if (closed) return
      closed = true
      operationLocks.clear()
      for (const [questionId, questionWaiters] of waiters.entries()) {
        const outcome: ParentQuestionOutcome = { kind: 'interrupted', questionId }
        for (const waiter of questionWaiters) waiter.resume(Effect.succeed(outcome))
      }
      waiters.clear()
    },
  }
  questionWaitEffects.set(service, waitEffect)
  return service
}

export const createParentQuestionEffectService = (input: {
  readonly table: () => Promise<ParentQuestionTable>
  readonly runtime: ParentQuestionRuntime
  readonly now?: () => number
}): ParentQuestionServiceEffectApi => {
  const service = createParentQuestionService(input)
  const wait = questionWaitEffects.get(service)
  if (wait === undefined) throw new Error('Parent question service did not register its Effect wait operation.')

  return {
    request: Effect.fn('parent question request')(request => promiseEffect('request', () => service.request(request))),
    listForParent: Effect.fn('parent question list')(request => promiseEffect('listForParent', () => service.listForParent(request))),
    answer: Effect.fn('parent question answer')(request => promiseEffect('answer', () => service.answer(request))),
    wait,
    cancel: Effect.fn('parent question cancel')(request => promiseEffect('cancel', () => service.cancel(request))),
    recordDeferredFile: Effect.fn('deferred question file record')(request => promiseEffect('recordDeferredFile', () => service.recordDeferredFile(request))),
    close: Effect.fn('parent question close')(() => promiseEffect('close', () => service.close())),
  }
}

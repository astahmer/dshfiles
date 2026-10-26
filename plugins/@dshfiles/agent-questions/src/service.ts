import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  deferredFilePathSchema,
  parentQuestionExpiryBehaviorSchema,
  parentQuestionRecordSchema,
  parentQuestionOptionsSchema,
  type ParentQuestionExpiryBehavior,
  type ParentQuestionRecord,
  type ParentQuestionTable,
} from './store.js'

const requestInputSchema = z
  .object({
    operationId: z.string().trim().min(1).max(256),
    question: z.string().trim().min(1).max(4_000),
    context: z.string().max(16_000).optional(),
    options: parentQuestionOptionsSchema,
    recommendedOptionId: z.string().trim().min(1).max(80),
    expiryBehavior: parentQuestionExpiryBehaviorSchema,
    timeoutMs: z.number().int().min(1_000).max(3_600_000),
  })
  .strict()
  .superRefine((request, context) => {
    if (!request.options.some(option => option.id === request.recommendedOptionId)) {
      context.addIssue({
        code: 'custom',
        path: ['recommendedOptionId'],
        message: 'The recommended option must exist in the question options.',
      })
    }
  })

const answerInputSchema = z.string().trim().min(1).max(4_000)
const parentQuestionListInputSchema = z.object({ childSessionId: z.string().trim().min(1).max(256).optional() }).strict()

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

interface QuestionWaiter {
  readonly resolve: (outcome: ParentQuestionOutcome) => void
  readonly reject: (error: unknown) => void
}

interface Deferred<Value> {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
  readonly reject: (error: unknown) => void
}

const createDeferred = <Value>(): Deferred<Value> => {
  let resolve = (_value: Value): void => {
    throw new Error('Deferred resolve was used before initialization.')
  }
  // oxlint-disable-next-line antislop/no-unknown-parameters -- The promise plumbing rejects with `unknown`; this placeholder only throws until the executor replaces it.
  let reject = (_error: unknown): void => {
    throw new Error('Deferred reject was used before initialization.')
  }
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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

const runWithLock = async <Value>(locks: Map<string, Promise<void>>, key: string, operation: () => Promise<Value>): Promise<Value> => {
  const previous = locks.get(key) ?? Promise.resolve()
  const gate = createDeferred<void>()
  const current = previous.then(() => gate.promise)
  locks.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    gate.resolve(undefined)
    if (locks.get(key) === current) locks.delete(key)
  }
}

export const createParentQuestionService = (input: {
  readonly table: () => Promise<ParentQuestionTable>
  readonly runtime: ParentQuestionRuntime
  readonly now?: () => number
}): ParentQuestionService => {
  const operationLocks = new Map<string, Promise<void>>()
  const waiters = new Map<string, Set<QuestionWaiter>>()
  const now = input.now ?? Date.now
  let closed = false

  const assertOpen = (): void => {
    if (closed) throw new Error('Parent question service is closed.')
  }

  const notifyWaiters = (record: ParentQuestionRecord): void => {
    if (record.status === 'pending') return
    const outcome = outcomeOf(record)
    for (const waiter of waiters.get(record.questionId) ?? []) waiter.resolve(outcome)
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
      return parentQuestionRecordSchema.parse(next)
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
        return parentQuestionRecordSchema.parse({
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

  return {
    request: async request => {
      assertOpen()
      const parsed = requestInputSchema.parse({
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
      return runWithLock(operationLocks, key, async () => {
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

        const created = await runWithLock(operationLocks, 'question-admission', async () => {
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
          const next = parentQuestionRecordSchema.parse({
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
        })
        record = await sendQuestion(table, key, created, request.signal)
        return receiptOf(record)
      })
    },
    listForParent: async ({ agent, childSessionId }) => {
      assertOpen()
      if (!input.runtime.isLive(agent)) throw new Error('Question list requires the exact live parent Agent.')
      const parsed = parentQuestionListInputSchema.parse({ childSessionId })
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
      const answer = answerInputSchema.parse(answerRequest.answer)
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
    wait: async waitRequest => {
      assertOpen()
      const found = await findAuthorizedChildQuestion(waitRequest.agent, waitRequest.questionId)
      assertOpen()
      if (found.record.status !== 'pending') return outcomeOf(found.record)
      if (found.record.expiresAt <= now()) {
        return outcomeOf(await settleExpired(found.table, found.key, found.record))
      }
      if (waitRequest.signal.aborted) {
        return outcomeOf(await settle(found.table, found.key, waitRequest.questionId, 'cancelled'))
      }

      const completion = createDeferred<ParentQuestionOutcome>()
      const waiter: QuestionWaiter = { resolve: completion.resolve, reject: completion.reject }
      const questionWaiters = waiters.get(waitRequest.questionId) ?? new Set<QuestionWaiter>()
      questionWaiters.add(waiter)
      waiters.set(waitRequest.questionId, questionWaiters)
      const timeout = setTimeout(
        () => {
          void settleExpired(found.table, found.key, found.record).catch(waiter.reject)
        },
        Math.max(1, found.record.expiresAt - now()),
      )
      const onAbort = (): void => {
        void settle(found.table, found.key, waitRequest.questionId, 'cancelled').catch(waiter.reject)
      }
      waitRequest.signal.addEventListener('abort', onAbort, { once: true })
      if (waitRequest.signal.aborted) onAbort()
      const latest = findByQuestionId(found.table, waitRequest.questionId)
      if (latest === undefined) {
        waiter.reject(new Error('Parent question disappeared while waiting.'))
      } else if (latest.record.status !== 'pending') {
        waiter.resolve(outcomeOf(latest.record))
      }
      try {
        return await completion.promise
      } finally {
        clearTimeout(timeout)
        waitRequest.signal.removeEventListener('abort', onAbort)
        questionWaiters.delete(waiter)
        if (questionWaiters.size === 0) waiters.delete(waitRequest.questionId)
      }
    },
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
      const filePath = deferredFilePathSchema.parse(fileRequest.filePath)
      return runWithLock(operationLocks, `deferred-file:${fileRequest.questionId}`, async () => {
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
          return parentQuestionRecordSchema.parse({ ...current, deferredFilePath: filePath })
        })
        if (updated.status !== 'deferred') throw new Error(`Parent question is ${updated.status}.`)
        return outcomeOf(updated)
      })
    },
    close: async () => {
      if (closed) return
      closed = true
      for (const [questionId, questionWaiters] of waiters.entries()) {
        const outcome: ParentQuestionOutcome = { kind: 'interrupted', questionId }
        for (const waiter of questionWaiters) waiter.resolve(outcome)
      }
      waiters.clear()
    },
  }
}

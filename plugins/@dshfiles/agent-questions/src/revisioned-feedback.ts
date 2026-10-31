import { createHash, randomUUID } from 'node:crypto'
import { Context, Effect, Schema } from 'effect'
import { createKeyedEffectLock } from './keyed-effect-lock.js'
import {
  feedbackResolutionReceiptSchema,
  markdownFeedbackAnchorSchema,
  revisionedFeedbackRecordEffectSchema,
  type MarkdownFeedbackAnchor,
  type RevisionedFeedbackRecord,
  type RevisionedFeedbackTable,
} from './store.js'

const trimmedString = (minimum: number, maximum: number) => Schema.Trim.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const decodeStrict = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S['Type'] =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value)

const requestInputSchema = Schema.Struct({
  operationId: trimmedString(1, 256),
  anchor: markdownFeedbackAnchorSchema,
  comment: trimmedString(1, 4_000),
})

const answerInputSchema = Schema.Struct({
  feedbackId: Schema.String.check(Schema.isUUID()),
  disposition: Schema.Literals(['accepted', 'rejected', 'deferred']),
  note: Schema.optionalKey(trimmedString(1, 4_000)),
})

type AnswerInput = typeof answerInputSchema.Type
type AnswerEncoded = typeof answerInputSchema.Encoded

const answerBatchSchema = Schema.Array(answerInputSchema).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(20),
  Schema.makeFilter(answers =>
    new Set(answers.map(answer => answer.feedbackId)).size === answers.length ? undefined : 'Feedback ids in the resolution batch must be unique.',
  ),
)

const maximumStoredFeedback = 1_000
const maximumPendingPerParent = 50
const terminalRetentionMs = 7 * 24 * 60 * 60 * 1_000

export interface ParentFeedbackAgent {
  readonly id: string
}

export interface ParentFeedbackRuntime {
  readonly isLive: (agent: ParentFeedbackAgent) => boolean
  readonly parentSessionId: (childSessionId: string) => string | undefined
  readonly isDirectChild: (childSessionId: string, parentSessionId: string) => boolean
  readonly currentRevision: (input: { readonly childSessionId: string; readonly path: string }) => Promise<string | null>
  readonly sendToParent: (input: {
    readonly childSessionId: string
    readonly parentSessionId: string
    readonly record: RevisionedFeedbackRecord
    readonly signal: AbortSignal
  }) => Promise<string>
  readonly sendToChild: (input: {
    readonly parentSessionId: string
    readonly childSessionId: string
    readonly record: RevisionedFeedbackRecord
    readonly signal: AbortSignal
  }) => Promise<void>
}

export interface ParentFeedbackResolutionResult {
  readonly feedbackId: string
  readonly status: 'resolved' | 'stale' | 'rejected'
  readonly notified: boolean
}

export interface ParentFeedbackService {
  submit(input: {
    readonly agent: ParentFeedbackAgent
    readonly operationId: string
    readonly anchor: MarkdownFeedbackAnchor
    readonly comment: string
    readonly signal: AbortSignal
  }): Promise<RevisionedFeedbackRecord>
  answerMany(input: {
    readonly agent: ParentFeedbackAgent
    readonly responses: readonly AnswerEncoded[]
    readonly signal: AbortSignal
  }): Promise<readonly ParentFeedbackResolutionResult[]>
  read(input: { readonly agent: ParentFeedbackAgent; readonly feedbackId: string }): Promise<RevisionedFeedbackRecord>
  cancel(input: { readonly agent: ParentFeedbackAgent; readonly feedbackId: string }): Promise<RevisionedFeedbackRecord>
  close(): Promise<void>
}

export interface ParentFeedbackServiceEffectApi {
  submit(input: Parameters<ParentFeedbackService['submit']>[0]): Effect.Effect<RevisionedFeedbackRecord, ParentFeedbackServiceError>
  answerMany(input: Parameters<ParentFeedbackService['answerMany']>[0]): Effect.Effect<readonly ParentFeedbackResolutionResult[], ParentFeedbackServiceError>
  read(input: Parameters<ParentFeedbackService['read']>[0]): Effect.Effect<RevisionedFeedbackRecord, ParentFeedbackServiceError>
  cancel(input: Parameters<ParentFeedbackService['cancel']>[0]): Effect.Effect<RevisionedFeedbackRecord, ParentFeedbackServiceError>
  close(): Effect.Effect<void, ParentFeedbackServiceError>
}

export class ParentFeedbackServiceEffect extends Context.Service<ParentFeedbackServiceEffect, ParentFeedbackServiceEffectApi>()(
  'agent-questions/ParentFeedbackService',
) {}

export class ParentFeedbackServiceError extends Schema.TaggedError<ParentFeedbackServiceError>()('ParentFeedbackServiceError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

const operationKeyFor = (parentSessionId: string, childSessionId: string, operationId: string): string =>
  createHash('sha256')
    .update(JSON.stringify([parentSessionId, childSessionId, operationId]))
    .digest('hex')

const findByFeedbackId = (
  table: RevisionedFeedbackTable,
  feedbackId: string,
): { readonly key: string; readonly record: RevisionedFeedbackRecord } | undefined => {
  for (const [key, record] of table.entries()) {
    if (record.feedbackId === feedbackId) return { key, record }
  }
  return undefined
}

const sameResolution = (record: RevisionedFeedbackRecord, answer: AnswerInput): boolean =>
  record.resolutionReceipt?.disposition === answer.disposition && record.resolutionReceipt.note === answer.note

export const createParentFeedbackService = (input: {
  readonly table: () => Promise<RevisionedFeedbackTable>
  readonly runtime: ParentFeedbackRuntime
  readonly now?: () => number
}): ParentFeedbackService => {
  const operationLocks = createKeyedEffectLock()
  const now = input.now ?? Date.now
  let closed = false

  const assertOpen = (): void => {
    if (closed) throw new Error('Parent feedback service is closed.')
  }

  const assertLiveDirectChild = (agent: ParentFeedbackAgent): string => {
    if (!input.runtime.isLive(agent)) throw new Error('Feedback operation requires the exact live Agent.')
    const parentSessionId = input.runtime.parentSessionId(agent.id)
    if (parentSessionId === undefined || !input.runtime.isDirectChild(agent.id, parentSessionId)) {
      throw new Error('Feedback can only be submitted by a live direct subagent.')
    }
    return parentSessionId
  }

  const belongsToParent = (record: RevisionedFeedbackRecord, parentSessionId: string): boolean => {
    if (record.parentSessionId !== parentSessionId) return false
    const currentParentSessionId = input.runtime.parentSessionId(record.childSessionId)
    return currentParentSessionId === undefined || currentParentSessionId === parentSessionId
  }

  const findAuthorizedChildFeedback = async (
    agent: ParentFeedbackAgent,
    feedbackId: string,
  ): Promise<{ readonly table: RevisionedFeedbackTable; readonly key: string; readonly record: RevisionedFeedbackRecord }> => {
    if (!input.runtime.isLive(agent)) throw new Error('Feedback read requires the exact live child Agent.')
    const table = await input.table()
    const found = findByFeedbackId(table, feedbackId)
    if (found === undefined) throw new Error('Parent feedback was not found.')
    const parentSessionId = input.runtime.parentSessionId(agent.id)
    if (
      found.record.childSessionId !== agent.id ||
      found.record.parentSessionId !== parentSessionId ||
      parentSessionId === undefined ||
      !input.runtime.isDirectChild(agent.id, parentSessionId)
    ) {
      throw new Error('Only the requesting direct child can read or cancel this feedback.')
    }
    return { table, ...found }
  }

  const pruneTerminalFeedback = async (table: RevisionedFeedbackTable): Promise<void> => {
    const cutoff = now() - terminalRetentionMs
    for (const [key, record] of table.entries()) {
      if (record.status !== 'pending' && record.updatedAt < cutoff) await table.delete(key)
    }
  }

  const refreshStaleness = async (table: RevisionedFeedbackTable, key: string, record: RevisionedFeedbackRecord): Promise<RevisionedFeedbackRecord> => {
    if (record.status !== 'resolved' || record.resolutionReceipt === undefined) return record
    const observedRevision = await input.runtime.currentRevision({
      childSessionId: record.childSessionId,
      path: record.anchor.path,
    })
    if (observedRevision === record.anchor.revision) return record
    assertOpen()
    const stale = await table.update(key, current => {
      if (current.feedbackId !== record.feedbackId || current.status !== 'resolved') return current
      return decodeStrict(revisionedFeedbackRecordEffectSchema, {
        ...current,
        status: 'stale',
        resolutionReceipt: decodeStrict(feedbackResolutionReceiptSchema, {
          ...current.resolutionReceipt,
          observedRevision,
          checkedAt: now(),
        }),
        updatedAt: now(),
      })
    })
    return stale
  }

  const resolveOne = async (resolution: {
    readonly table: RevisionedFeedbackTable
    readonly agent: ParentFeedbackAgent
    readonly answer: AnswerInput
    readonly signal: AbortSignal
  }): Promise<ParentFeedbackResolutionResult> => {
    assertOpen()
    const found = findByFeedbackId(resolution.table, resolution.answer.feedbackId)
    if (found === undefined || !belongsToParent(found.record, resolution.agent.id)) {
      return { feedbackId: resolution.answer.feedbackId, status: 'rejected', notified: false }
    }
    if (found.record.status === 'resolved' || found.record.status === 'stale') {
      if (!sameResolution(found.record, resolution.answer)) {
        return { feedbackId: resolution.answer.feedbackId, status: 'rejected', notified: false }
      }
      const refreshed = await refreshStaleness(resolution.table, found.key, found.record)
      return {
        feedbackId: resolution.answer.feedbackId,
        status: refreshed.status === 'stale' ? 'stale' : 'resolved',
        notified: false,
      }
    }
    if (found.record.status !== 'pending') {
      return { feedbackId: resolution.answer.feedbackId, status: 'rejected', notified: false }
    }

    resolution.signal.throwIfAborted()
    const observedRevision = await input.runtime.currentRevision({
      childSessionId: found.record.childSessionId,
      path: found.record.anchor.path,
    })
    resolution.signal.throwIfAborted()
    if (!input.runtime.isLive(resolution.agent) || !belongsToParent(found.record, resolution.agent.id)) {
      return { feedbackId: resolution.answer.feedbackId, status: 'rejected', notified: false }
    }
    const status = observedRevision === found.record.anchor.revision ? 'resolved' : 'stale'
    const resolutionReceipt = decodeStrict(feedbackResolutionReceiptSchema, {
      disposition: resolution.answer.disposition,
      ...(resolution.answer.note !== undefined && { note: resolution.answer.note }),
      baseRevision: found.record.anchor.revision,
      observedRevision,
      checkedAt: now(),
    })
    const updated = await resolution.table.update(found.key, current => {
      if (current.feedbackId !== resolution.answer.feedbackId || current.status !== 'pending') return current
      return decodeStrict(revisionedFeedbackRecordEffectSchema, {
        ...current,
        status,
        resolutionReceipt,
        updatedAt: now(),
      })
    })
    if ((updated.status !== 'resolved' && updated.status !== 'stale') || !sameResolution(updated, resolution.answer)) {
      return { feedbackId: resolution.answer.feedbackId, status: 'rejected', notified: false }
    }

    let notified = false
    try {
      await input.runtime.sendToChild({
        parentSessionId: resolution.agent.id,
        childSessionId: updated.childSessionId,
        record: updated,
        signal: resolution.signal,
      })
      notified = true
    } catch {
      notified = false
    }
    return { feedbackId: resolution.answer.feedbackId, status: updated.status, notified }
  }

  return {
    submit: async request => {
      assertOpen()
      const parentSessionId = assertLiveDirectChild(request.agent)
      request.signal.throwIfAborted()
      const parsed = decodeStrict(requestInputSchema, {
        operationId: request.operationId,
        anchor: request.anchor,
        comment: request.comment,
      })
      const key = operationKeyFor(parentSessionId, request.agent.id, parsed.operationId)
      return operationLocks.run({
        key,
        operation: async () => {
          assertOpen()
          if (assertLiveDirectChild(request.agent) !== parentSessionId) {
            throw new Error('Feedback parent changed before submission.')
          }
          const table = await input.table()
          let record = table.get(key)
          if (record !== undefined) {
            if (
              record.parentSessionId !== parentSessionId ||
              record.childSessionId !== request.agent.id ||
              record.comment !== parsed.comment ||
              JSON.stringify(record.anchor) !== JSON.stringify(parsed.anchor)
            ) {
              throw new Error('Feedback operation id was reused with different input.')
            }
            return record
          }

          const observedRevision = await input.runtime.currentRevision({
            childSessionId: request.agent.id,
            path: parsed.anchor.path,
          })
          if (observedRevision !== parsed.anchor.revision) {
            throw new Error('Markdown changed before feedback could be sent. Capture a new anchor and retry.')
          }

          await pruneTerminalFeedback(table)
          const rows = Array.from(table.entries())
          const pendingForParent = rows.filter(([, row]) => row.parentSessionId === parentSessionId && row.status === 'pending').length
          if (pendingForParent >= maximumPendingPerParent) {
            throw new Error('The parent has reached its pending feedback limit.')
          }
          if (table.size >= maximumStoredFeedback) throw new Error('The retained feedback limit has been reached.')

          const timestamp = now()
          record = decodeStrict(revisionedFeedbackRecordEffectSchema, {
            feedbackId: randomUUID(),
            parentSessionId,
            childSessionId: request.agent.id,
            operationId: parsed.operationId,
            anchor: parsed.anchor,
            comment: parsed.comment,
            status: 'pending',
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          await table.put(key, record)
          try {
            const notificationMessageId = await input.runtime.sendToParent({
              childSessionId: record.childSessionId,
              parentSessionId: record.parentSessionId,
              record,
              signal: request.signal,
            })
            record = await table.update(key, current => {
              if (current.feedbackId !== record?.feedbackId || current.status !== 'pending') return current
              return decodeStrict(revisionedFeedbackRecordEffectSchema, {
                ...current,
                notificationMessageId,
                updatedAt: now(),
              })
            })
          } catch (error: unknown) {
            const found = table.get(key)
            if (found === undefined || found.feedbackId !== record.feedbackId) throw error
            record = await table.update(key, current =>
              current.status === 'pending'
                ? decodeStrict(revisionedFeedbackRecordEffectSchema, { ...current, status: 'delivery-failed', updatedAt: now() })
                : current,
            )
          }
          return record
        },
      })
    },
    answerMany: async answerRequest => {
      assertOpen()
      if (!input.runtime.isLive(answerRequest.agent)) {
        throw new Error('Feedback resolution requires the exact live parent Agent.')
      }
      answerRequest.signal.throwIfAborted()
      const answers = decodeStrict(answerBatchSchema, answerRequest.responses)
      const table = await input.table()
      const results: ParentFeedbackResolutionResult[] = []
      for (const answer of answers) {
        const result = await operationLocks.run({
          key: `feedback-resolution:${answer.feedbackId}`,
          operation: () =>
            resolveOne({
              table,
              agent: answerRequest.agent,
              answer,
              signal: answerRequest.signal,
            }),
        })
        results.push(result)
      }
      return results
    },
    read: async readRequest => {
      assertOpen()
      const found = await findAuthorizedChildFeedback(readRequest.agent, readRequest.feedbackId)
      return refreshStaleness(found.table, found.key, found.record)
    },
    cancel: async cancelRequest => {
      assertOpen()
      const found = await findAuthorizedChildFeedback(cancelRequest.agent, cancelRequest.feedbackId)
      if (found.record.status !== 'pending') return found.record
      return found.table.update(found.key, current => {
        if (current.feedbackId !== cancelRequest.feedbackId || current.status !== 'pending') return current
        return decodeStrict(revisionedFeedbackRecordEffectSchema, { ...current, status: 'cancelled', updatedAt: now() })
      })
    },
    close: async () => {
      closed = true
      operationLocks.clear()
    },
  }
}

export const createParentFeedbackEffectService = (input: {
  readonly table: () => Promise<RevisionedFeedbackTable>
  readonly runtime: ParentFeedbackRuntime
  readonly now?: () => number
}): ParentFeedbackServiceEffectApi => {
  const service = createParentFeedbackService(input)
  const call = <Value>(operation: string, run: () => Promise<Value>): Effect.Effect<Value, ParentFeedbackServiceError> =>
    Effect.tryPromise({
      try: run,
      catch: error => new ParentFeedbackServiceError({ operation, message: error instanceof Error ? error.message : String(error) }),
    })

  return {
    submit: Effect.fn('parent feedback submit')(request => call('submit', () => service.submit(request))),
    answerMany: Effect.fn('parent feedback resolve batch')(request => call('answerMany', () => service.answerMany(request))),
    read: Effect.fn('parent feedback read')(request => call('read', () => service.read(request))),
    cancel: Effect.fn('parent feedback cancel')(request => call('cancel', () => service.cancel(request))),
    close: Effect.fn('parent feedback close')(() => call('close', () => service.close())),
  }
}

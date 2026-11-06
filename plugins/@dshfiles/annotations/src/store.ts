import { randomBytes } from 'node:crypto'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain, type StorageDomainWriteFailed } from '@dshfiles/dshx/effect/storage-domain'
import { Clock, Context, Effect, Layer, Option, Ref, Schema, Semaphore } from 'effect'
import {
  MAX_ANNOTATIONS_PER_SESSION,
  MAX_THREAD_MESSAGES,
  MAX_UNASSIGNED,
  annotationSchema,
  metaSchema,
  unassignedSchema,
  type Annotation,
  type AnnotationCounts,
  type AnnotationDraft,
  type AnnotationMeta,
  type AnnotationOrigin,
  type AnnotationStaleReason,
  type AnnotationStatus,
  type UnassignedAnnotation,
} from './schema.js'

export const annotationsDomain = defineDomain({
  name: 'annotations',
  version: 1,
  tables: {
    // `defineDomain` still types a table's record validator as a zod schema; the Effect schemas stay the source of truth.
    annotations: { valueSchema: zodSchemaFromEffect(annotationSchema), __key: 'annotations' },
    unassigned: { valueSchema: zodSchemaFromEffect(unassignedSchema), __key: 'unassigned' },
    meta: { valueSchema: zodSchemaFromEffect(metaSchema), __key: 'meta' },
  },
})

/** No annotation (or intake item) with that id in that Session. */
export class AnnotationNotFound extends Schema.TaggedError<AnnotationNotFound>()('AnnotationNotFound', {
  id: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `No annotation ${this.id} in this Session.`
  }
}

/** The caller resolved a revision that is no longer current. */
export class AnnotationRevisionConflict extends Schema.TaggedError<AnnotationRevisionConflict>()('AnnotationRevisionConflict', {
  id: Schema.String,
  expected: Schema.Number,
  actual: Schema.Number,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Annotation ${this.id} changed since revision ${this.expected}; read it again.`
  }
}

/** The annotation is already resolved or dismissed. */
export class AnnotationClosed extends Schema.TaggedError<AnnotationClosed>()('AnnotationClosed', {
  id: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Annotation ${this.id} is already closed.`
  }
}

/** The Session holds the maximum number of open annotations. */
export class AnnotationLimitReached extends Schema.TaggedError<AnnotationLimitReached>()(
  'AnnotationLimitReached',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'annotations-limit' },
) {
  override get message(): string {
    return `This Session already holds ${MAX_ANNOTATIONS_PER_SESSION} open annotations; resolve or dismiss some first.`
  }
}

export type StoreFailure = AnnotationNotFound | AnnotationRevisionConflict | AnnotationClosed | AnnotationLimitReached

const META_KEY = 'meta'
const CLOSED: readonly AnnotationStatus[] = ['resolved', 'dismissed']

/**
 * The one table every mutator reads: the status a verb moves an annotation to, or nothing when the verb does not apply
 * to the status the record is in. Resolved and dismissed are terminal.
 */
const NEXT_STATUS = {
  acknowledge: (status: AnnotationStatus): AnnotationStatus | undefined => (status === 'pending' || status === 'stale' ? 'acknowledged' : undefined),
  resolve: (status: AnnotationStatus): AnnotationStatus | undefined => (CLOSED.includes(status) ? undefined : 'resolved'),
  dismiss: (status: AnnotationStatus): AnnotationStatus | undefined => (CLOSED.includes(status) ? undefined : 'dismissed'),
  'mark-stale': (status: AnnotationStatus): AnnotationStatus | undefined => (CLOSED.includes(status) ? undefined : 'stale'),
} satisfies Record<string, (status: AnnotationStatus) => AnnotationStatus | undefined>

type AnnotationVerb = keyof typeof NEXT_STATUS

const transition = (status: AnnotationStatus, verb: AnnotationVerb): AnnotationStatus | undefined => NEXT_STATUS[verb](status)

const recordKey = (input: { readonly sessionId: string; readonly id: string }): string => `${input.sessionId}\u0000${input.id}`

const newerRevision = (current: number, now: number): number => Math.max(current + 1, now)

const nextToken = Effect.sync(() => randomBytes(32).toString('base64url'))

const byCreation = (left: Annotation, right: Annotation) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)

const nextIdFor = (existing: readonly Annotation[]): string => {
  const highest = existing.reduce((maximum, record) => {
    const numeric = Number.parseInt(record.id.slice('ann_'.length), 10)
    return Number.isNaN(numeric) ? maximum : Math.max(maximum, numeric)
  }, 0)
  return `ann_${highest + 1}`
}

const logWriteFailure = (error: StorageDomainWriteFailed) => Effect.logWarning('Annotations write failed', { table: error.table, operation: error.operation })

export interface AnnotationStoreShape {
  readonly token: Effect.Effect<string>
  readonly rotateToken: Effect.Effect<string>
  readonly list: (input: {
    readonly sessionId: string
    readonly statuses?: readonly AnnotationStatus[]
    readonly limit?: number
  }) => Effect.Effect<Annotation[]>
  readonly counts: (sessionId: string) => Effect.Effect<AnnotationCounts>
  readonly create: (input: {
    readonly sessionId: string
    readonly drafts: readonly AnnotationDraft[]
    readonly origin: AnnotationOrigin
  }) => Effect.Effect<Annotation[], AnnotationLimitReached>
  readonly ack: (input: { readonly sessionId: string; readonly ids: readonly string[] }) => Effect.Effect<Annotation[], AnnotationNotFound>
  readonly resolve: (input: {
    readonly sessionId: string
    readonly id: string
    readonly revision: number
    readonly summary?: string
    readonly resolvedBy: 'human' | 'agent'
  }) => Effect.Effect<Annotation, AnnotationNotFound | AnnotationRevisionConflict | AnnotationClosed>
  readonly dismiss: (input: {
    readonly sessionId: string
    readonly id: string
    readonly reason: string
  }) => Effect.Effect<Annotation, AnnotationNotFound | AnnotationClosed>
  readonly markStale: (input: {
    readonly sessionId: string
    readonly id: string
    readonly reason: AnnotationStaleReason
  }) => Effect.Effect<Annotation, AnnotationNotFound | AnnotationClosed>
  readonly reply: (input: {
    readonly sessionId: string
    readonly id: string
    readonly body: string
    readonly role: 'human' | 'agent'
  }) => Effect.Effect<Annotation, AnnotationNotFound>
  readonly intake: Effect.Effect<UnassignedAnnotation[]>
  readonly ingest: (input: { readonly drafts: readonly AnnotationDraft[]; readonly extensionOrigin: string }) => Effect.Effect<UnassignedAnnotation[]>
  readonly attach: (input: {
    readonly sessionId: string
    readonly ids: readonly string[]
  }) => Effect.Effect<Annotation[], AnnotationNotFound | AnnotationLimitReached>
}

/**
 * Annotations per Session plus extension feedback waiting for a Session, kept in memory and written through to the
 * `annotations` storage domain. The domain is open for the layer's Scope; a failed write is logged and the in-memory
 * state stays authoritative until the next write, as before.
 */
export class AnnotationStore extends Context.Service<AnnotationStore, AnnotationStoreShape>()('@dshfiles/annotations/AnnotationStore') {
  static readonly layer = Layer.effect(
    AnnotationStore,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const domain = yield* storage.open(annotationsDomain)
      const annotationsTable = domain.table('annotations')
      const unassignedTable = domain.table('unassigned')
      const metaTable = domain.table('meta')
      const records = yield* Ref.make<ReadonlyMap<string, Annotation>>(new Map((yield* annotationsTable.entries).map(([key, value]) => [key, value])))
      const waiting = yield* Ref.make<ReadonlyMap<string, UnassignedAnnotation>>(new Map((yield* unassignedTable.entries).map(([key, value]) => [key, value])))
      const storedMeta = yield* metaTable.get(META_KEY)
      const initialMeta: AnnotationMeta = Option.isSome(storedMeta)
        ? storedMeta.value
        : { schemaVersion: 1, token: yield* nextToken, tokenCreatedAt: yield* Clock.currentTimeMillis, sequence: 0 }
      const meta = yield* Ref.make(initialMeta)
      const writes = yield* Semaphore.make(1)

      const persistMeta = Effect.flatMap(Ref.get(meta), state => metaTable.put(META_KEY, state)).pipe(
        Effect.catchTag('StorageDomainWriteFailed', logWriteFailure),
      )
      yield* persistMeta
      yield* Effect.addFinalizer(() => persistMeta)

      const sessionRecords = (sessionId: string) =>
        Effect.map(Ref.get(records), all =>
          Array.from(all.values())
            .filter(record => record.sessionId === sessionId)
            .sort(byCreation),
        )

      const storeRecord = (record: Annotation) =>
        Ref.update(records, all => new Map(all).set(recordKey(record), record)).pipe(
          Effect.andThen(annotationsTable.put(recordKey(record), record)),
          Effect.catchTag('StorageDomainWriteFailed', logWriteFailure),
        )

      const removeRecord = (record: Annotation) =>
        Ref.update(records, all => {
          const next = new Map(all)
          next.delete(recordKey(record))
          return next
        }).pipe(Effect.andThen(annotationsTable.delete(recordKey(record))), Effect.asVoid, Effect.catchTag('StorageDomainWriteFailed', logWriteFailure))

      const removeWaiting = (id: string) =>
        Ref.update(waiting, all => {
          const next = new Map(all)
          next.delete(id)
          return next
        }).pipe(Effect.andThen(unassignedTable.delete(id)), Effect.asVoid, Effect.catchTag('StorageDomainWriteFailed', logWriteFailure))

      const find = (input: { readonly sessionId: string; readonly id: string }) =>
        Effect.flatMap(Ref.get(records), all => {
          const record = all.get(recordKey(input))
          return record === undefined ? Effect.fail(new AnnotationNotFound({ id: input.id })) : Effect.succeed(record)
        })

      const ensureCapacity = Effect.fnUntraced(function* (input: { readonly sessionId: string; readonly incoming: number }) {
        const existing = yield* sessionRecords(input.sessionId)
        if (existing.length + input.incoming <= MAX_ANNOTATIONS_PER_SESSION) return
        const needed = existing.length + input.incoming - MAX_ANNOTATIONS_PER_SESSION
        yield* Effect.forEach(existing.filter(record => CLOSED.includes(record.status)).slice(0, needed), removeRecord, { discard: true })
        if ((yield* sessionRecords(input.sessionId)).length + input.incoming > MAX_ANNOTATIONS_PER_SESSION)
          return yield* new AnnotationLimitReached({ sessionId: input.sessionId })
      })

      const createRecords = Effect.fnUntraced(function* (input: {
        readonly sessionId: string
        readonly drafts: readonly AnnotationDraft[]
        readonly origin: AnnotationOrigin
      }) {
        yield* ensureCapacity({ sessionId: input.sessionId, incoming: input.drafts.length })
        const created: Annotation[] = []
        for (const draft of input.drafts) {
          const timestamp = yield* Clock.currentTimeMillis
          const record: Annotation = {
            id: nextIdFor(yield* sessionRecords(input.sessionId)),
            sessionId: input.sessionId,
            revision: 1,
            status: 'pending',
            kind: draft.kind,
            target: draft.target,
            note: draft.note,
            thread: [],
            createdAt: timestamp,
            updatedAt: timestamp,
            origin: input.origin,
            ...(draft.intent !== undefined && { intent: draft.intent }),
            ...(draft.severity !== undefined && { severity: draft.severity }),
          }
          yield* storeRecord(record)
          created.push(record)
        }
        return created
      })

      const mutate = Effect.fnUntraced(function* (record: Annotation, update: Partial<Annotation>) {
        const timestamp = yield* Clock.currentTimeMillis
        const next: Annotation = { ...record, ...update, revision: newerRevision(record.revision, timestamp), updatedAt: timestamp }
        yield* storeRecord(next)
        return next
      })

      const serialized = <A, E>(effect: Effect.Effect<A, E>) => writes.withPermit(effect)

      return AnnotationStore.of({
        token: Effect.map(Ref.get(meta), state => state.token),

        rotateToken: serialized(
          Effect.gen(function* () {
            const token = yield* nextToken
            const now = yield* Clock.currentTimeMillis
            yield* Ref.update(meta, state => ({ ...state, token, tokenCreatedAt: now, sequence: state.sequence + 1 }))
            yield* persistMeta
            return token
          }),
        ),

        list: Effect.fn('annotations store list')(function* (input) {
          const allowed = input.statuses === undefined ? undefined : new Set(input.statuses)
          const rows = (yield* sessionRecords(input.sessionId)).filter(record => allowed === undefined || allowed.has(record.status))
          return rows.slice(0, input.limit ?? 200)
        }),

        counts: Effect.fn('annotations store counts')(function* (sessionId) {
          const counts = { pending: 0, acknowledged: 0, stale: 0, resolved: 0, dismissed: 0 }
          for (const record of yield* sessionRecords(sessionId)) counts[record.status] += 1
          return counts
        }),

        create: input => serialized(createRecords(input)).pipe(Effect.withSpan('annotations store create')),

        ack: input =>
          serialized(
            Effect.gen(function* () {
              const acknowledged: Annotation[] = []
              // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- the first missing id fails the whole acknowledgement, in request order.
              for (const id of input.ids) {
                const record = yield* find({ sessionId: input.sessionId, id })
                const next = transition(record.status, 'acknowledge')
                if (next === undefined) continue
                acknowledged.push(yield* mutate(record, { status: next }))
              }
              return acknowledged
            }),
          ).pipe(Effect.withSpan('annotations store acknowledge')),

        resolve: input =>
          serialized(
            Effect.gen(function* () {
              const record = yield* find(input)
              if (record.revision !== input.revision)
                return yield* new AnnotationRevisionConflict({ id: input.id, expected: input.revision, actual: record.revision })
              const next = transition(record.status, 'resolve')
              if (next === undefined) return yield* new AnnotationClosed({ id: input.id })
              return yield* mutate(record, {
                status: next,
                resolvedAt: yield* Clock.currentTimeMillis,
                resolvedBy: input.resolvedBy,
                resolution: { revision: input.revision, ...(input.summary !== undefined && { summary: input.summary }) },
              })
            }),
          ).pipe(Effect.withSpan('annotations store resolve')),

        dismiss: input =>
          serialized(
            Effect.gen(function* () {
              const record = yield* find(input)
              const next = transition(record.status, 'dismiss')
              if (next === undefined) return yield* new AnnotationClosed({ id: input.id })
              const now = yield* Clock.currentTimeMillis
              const message = { id: `msg_${record.thread.length + 1}`, role: 'human' as const, body: `Dismissed: ${input.reason}`, at: now }
              return yield* mutate(record, {
                status: next,
                resolvedAt: now,
                resolvedBy: 'human',
                resolution: { revision: record.revision, summary: input.reason },
                thread: [...record.thread, message].slice(-MAX_THREAD_MESSAGES),
              })
            }),
          ).pipe(Effect.withSpan('annotations store dismiss')),

        markStale: input =>
          serialized(
            Effect.gen(function* () {
              const record = yield* find(input)
              const next = transition(record.status, 'mark-stale')
              if (next === undefined) return yield* new AnnotationClosed({ id: input.id })
              if (record.status === 'stale' && record.target.staleReason === input.reason) return record
              return yield* mutate(record, { status: next, target: { ...record.target, staleReason: input.reason } })
            }),
          ).pipe(Effect.withSpan('annotations store mark stale')),

        reply: input =>
          serialized(
            Effect.gen(function* () {
              const record = yield* find(input)
              const message = { id: `msg_${record.thread.length + 1}`, role: input.role, body: input.body, at: yield* Clock.currentTimeMillis }
              return yield* mutate(record, { thread: [...record.thread, message].slice(-MAX_THREAD_MESSAGES) })
            }),
          ).pipe(Effect.withSpan('annotations store reply')),

        intake: Effect.map(Ref.get(waiting), all => Array.from(all.values()).sort((left, right) => left.receivedAt - right.receivedAt)),

        ingest: input =>
          serialized(
            Effect.gen(function* () {
              const accepted: UnassignedAnnotation[] = []
              for (const draft of input.drafts) {
                const current = yield* Ref.get(waiting)
                if (current.size >= MAX_UNASSIGNED) {
                  const oldest = Array.from(current.values()).sort((left, right) => left.receivedAt - right.receivedAt)[0]
                  if (oldest !== undefined) yield* removeWaiting(oldest.id)
                }
                const sequence = (yield* Ref.updateAndGet(meta, state => ({ ...state, sequence: state.sequence + 1 }))).sequence
                const item: UnassignedAnnotation = {
                  id: `ext_${sequence}`,
                  draft: { ...draft, target: { ...draft.target, surface: 'external' } },
                  receivedAt: yield* Clock.currentTimeMillis,
                  extensionOrigin: input.extensionOrigin,
                }
                yield* Ref.update(waiting, all => new Map(all).set(item.id, item))
                yield* unassignedTable.put(item.id, item).pipe(Effect.catchTag('StorageDomainWriteFailed', logWriteFailure))
                accepted.push(item)
              }
              yield* persistMeta
              return accepted
            }),
          ).pipe(Effect.withSpan('annotations store ingest')),

        attach: input =>
          serialized(
            Effect.gen(function* () {
              const attached: Annotation[] = []
              for (const id of input.ids) {
                const pending = (yield* Ref.get(waiting)).get(id)
                if (pending === undefined) return yield* new AnnotationNotFound({ id })
                attached.push(...(yield* createRecords({ sessionId: input.sessionId, drafts: [pending.draft], origin: 'extension' })))
                yield* removeWaiting(id)
              }
              return attached
            }),
          ).pipe(Effect.withSpan('annotations store attach')),
      })
    }),
  )
}

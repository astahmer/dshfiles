import { randomBytes } from 'node:crypto'
import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
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
  type AnnotationStatus,
  type AnnotationStaleReason,
  type UnassignedAnnotation,
} from './schema.js'

export const annotationsDomain = defineDomain({
  name: 'annotations',
  version: 1,
  tables: {
    annotations: { valueSchema: annotationSchema, __key: 'annotations' },
    unassigned: { valueSchema: unassignedSchema, __key: 'unassigned' },
    meta: { valueSchema: metaSchema, __key: 'meta' },
  },
})

export type AnnotationTable = KvTable<string, Annotation>
export type UnassignedTable = KvTable<string, UnassignedAnnotation>
export type MetaTable = KvTable<string, AnnotationMeta>

const META_KEY = 'meta'
const CLOSED: readonly AnnotationStatus[] = ['resolved', 'dismissed']

export type StoreFailure = 'missing' | 'revision' | 'limit' | 'status'
export type StoreResult<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: StoreFailure }

const recordKey = ({ sessionId, id }: { readonly sessionId: string; readonly id: string }): string => `${sessionId}\u0000${id}`

const newerRevision = (current: number, now: number): number => Math.max(current + 1, now)

const nextToken = (): string => randomBytes(32).toString('base64url')

export interface AnnotationStore {
  token(): string
  rotateToken(): Promise<string>
  list(input: { readonly sessionId: string; readonly statuses?: readonly AnnotationStatus[]; readonly limit?: number }): Annotation[]
  counts(sessionId: string): AnnotationCounts
  create(input: {
    readonly sessionId: string
    readonly drafts: readonly AnnotationDraft[]
    readonly origin: AnnotationOrigin
  }): Promise<StoreResult<Annotation[]>>
  ack(input: { readonly sessionId: string; readonly ids: readonly string[] }): Promise<StoreResult<Annotation[]>>
  resolve(input: {
    readonly sessionId: string
    readonly id: string
    readonly revision: number
    readonly summary?: string
    readonly resolvedBy: 'human' | 'agent'
  }): Promise<StoreResult<Annotation>>
  dismiss(input: { readonly sessionId: string; readonly id: string; readonly reason: string }): Promise<StoreResult<Annotation>>
  markStale(input: { readonly sessionId: string; readonly id: string; readonly reason: AnnotationStaleReason }): Promise<StoreResult<Annotation>>
  reply(input: { readonly sessionId: string; readonly id: string; readonly body: string; readonly role: 'human' | 'agent' }): Promise<StoreResult<Annotation>>
  intake(): UnassignedAnnotation[]
  ingest(input: { readonly drafts: readonly AnnotationDraft[]; readonly extensionOrigin: string }): Promise<UnassignedAnnotation[]>
  attach(input: { readonly sessionId: string; readonly ids: readonly string[] }): Promise<StoreResult<Annotation[]>>
  flush(): Promise<void>
}

export const createAnnotationStore = ({
  annotations,
  unassigned,
  meta,
  now = Date.now,
  reportError = (error: unknown) =>
    console.error('Annotations write failed', {
      error: error instanceof Error ? error.message.slice(0, 200) : String(error),
    }),
}: {
  readonly annotations: AnnotationTable
  readonly unassigned: UnassignedTable
  readonly meta: MetaTable
  readonly now?: () => number
  readonly reportError?: (error: unknown) => void
}): AnnotationStore => {
  const records = new Map<string, Annotation>(annotations.entries())
  const waiting = new Map<string, UnassignedAnnotation>(unassigned.entries())
  let state: AnnotationMeta = meta.get(META_KEY) ?? {
    schemaVersion: 1,
    token: nextToken(),
    tokenCreatedAt: now(),
    sequence: 0,
  }

  const guard = async (write: () => Promise<unknown>): Promise<void> => {
    try {
      await write()
    } catch (error) {
      reportError(error)
    }
  }

  const persistMeta = async (): Promise<void> => {
    await guard(() => meta.put(META_KEY, state))
  }

  const sessionRecords = (sessionId: string): Annotation[] =>
    Array.from(records.values())
      .filter(record => record.sessionId === sessionId)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))

  const countsFor = (sessionId: string): AnnotationCounts => {
    const counts: AnnotationCounts = { pending: 0, acknowledged: 0, stale: 0, resolved: 0, dismissed: 0 }
    for (const record of records.values()) {
      if (record.sessionId !== sessionId) continue
      counts[record.status] += 1
    }
    return counts
  }

  const storeRecord = async (record: Annotation): Promise<void> => {
    records.set(recordKey(record), record)
    await guard(() => annotations.put(recordKey(record), record))
  }

  const removeRecord = async (record: Annotation): Promise<void> => {
    records.delete(recordKey(record))
    await guard(() => annotations.delete(recordKey(record)))
  }

  const ensureCapacity = async ({ sessionId, incoming }: { readonly sessionId: string; readonly incoming: number }): Promise<boolean> => {
    const existing = sessionRecords(sessionId)
    if (existing.length + incoming <= MAX_ANNOTATIONS_PER_SESSION) return true
    const needed = existing.length + incoming - MAX_ANNOTATIONS_PER_SESSION
    const closed = existing.filter(record => CLOSED.includes(record.status)).slice(0, needed)
    for (const record of closed) await removeRecord(record)
    return sessionRecords(sessionId).length + incoming <= MAX_ANNOTATIONS_PER_SESSION
  }

  const nextIdFor = (sessionId: string): string => {
    const highest = sessionRecords(sessionId).reduce((maximum, record) => {
      const numeric = Number.parseInt(record.id.slice('ann_'.length), 10)
      return Number.isNaN(numeric) ? maximum : Math.max(maximum, numeric)
    }, 0)
    return `ann_${highest + 1}`
  }

  const createRecords = async ({
    sessionId,
    drafts,
    origin,
  }: {
    readonly sessionId: string
    readonly drafts: readonly AnnotationDraft[]
    readonly origin: AnnotationOrigin
  }): Promise<StoreResult<Annotation[]>> => {
    if (!(await ensureCapacity({ sessionId, incoming: drafts.length }))) return { ok: false, error: 'limit' }
    const created: Annotation[] = []
    for (const draft of drafts) {
      const timestamp = now()
      const record: Annotation = {
        id: nextIdFor(sessionId),
        sessionId,
        revision: 1,
        status: 'pending',
        kind: draft.kind,
        target: draft.target,
        note: draft.note,
        thread: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        origin,
        ...(draft.intent !== undefined && { intent: draft.intent }),
        ...(draft.severity !== undefined && { severity: draft.severity }),
      }
      await storeRecord(record)
      created.push(record)
    }
    return { ok: true, value: created }
  }

  const mutate = async (record: Annotation, update: Partial<Annotation>): Promise<Annotation> => {
    const timestamp = now()
    const next: Annotation = { ...record, ...update, revision: newerRevision(record.revision, timestamp), updatedAt: timestamp }
    await storeRecord(next)
    return next
  }

  const find = ({ sessionId, id }: { readonly sessionId: string; readonly id: string }): Annotation | undefined => records.get(recordKey({ sessionId, id }))

  return {
    token: () => state.token,

    rotateToken: async () => {
      state = { ...state, token: nextToken(), tokenCreatedAt: now(), sequence: state.sequence + 1 }
      await persistMeta()
      return state.token
    },

    list: ({ sessionId, statuses, limit }) => {
      const allowed = statuses === undefined ? undefined : new Set(statuses)
      const rows = sessionRecords(sessionId).filter(record => allowed === undefined || allowed.has(record.status))
      return rows.slice(0, limit ?? 200)
    },

    counts: countsFor,

    create: createRecords,

    ack: async ({ sessionId, ids }) => {
      const acknowledged: Annotation[] = []
      for (const id of ids) {
        const record = find({ sessionId, id })
        if (record === undefined) return { ok: false, error: 'missing' }
        if (record.status !== 'pending' && record.status !== 'stale') continue
        acknowledged.push(await mutate(record, { status: 'acknowledged' }))
      }
      return { ok: true, value: acknowledged }
    },

    resolve: async ({ sessionId, id, revision, summary, resolvedBy }) => {
      const record = find({ sessionId, id })
      if (record === undefined) return { ok: false, error: 'missing' }
      if (record.revision !== revision) return { ok: false, error: 'revision' }
      const resolution = { revision, ...(summary !== undefined && { summary }) }
      return {
        ok: true,
        value: await mutate(record, {
          status: 'resolved',
          resolvedAt: now(),
          resolvedBy,
          resolution,
        }),
      }
    },

    dismiss: async ({ sessionId, id, reason }) => {
      const record = find({ sessionId, id })
      if (record === undefined) return { ok: false, error: 'missing' }
      if (CLOSED.includes(record.status)) return { ok: false, error: 'status' }
      const message = { id: `msg_${record.thread.length + 1}`, role: 'human' as const, body: `Dismissed: ${reason}`, at: now() }
      return {
        ok: true,
        value: await mutate(record, {
          status: 'dismissed',
          resolvedAt: now(),
          resolvedBy: 'human',
          resolution: { revision: record.revision, summary: reason },
          thread: [...record.thread, message].slice(-MAX_THREAD_MESSAGES),
        }),
      }
    },

    markStale: async ({ sessionId, id, reason }) => {
      const record = find({ sessionId, id })
      if (record === undefined) return { ok: false, error: 'missing' }
      if (CLOSED.includes(record.status)) return { ok: false, error: 'status' }
      if (record.status === 'stale' && record.target.staleReason === reason) return { ok: true, value: record }
      return {
        ok: true,
        value: await mutate(record, {
          status: 'stale',
          target: { ...record.target, staleReason: reason },
        }),
      }
    },

    reply: async ({ sessionId, id, body, role }) => {
      const record = find({ sessionId, id })
      if (record === undefined) return { ok: false, error: 'missing' }
      const message = { id: `msg_${record.thread.length + 1}`, role, body, at: now() }
      return { ok: true, value: await mutate(record, { thread: [...record.thread, message].slice(-MAX_THREAD_MESSAGES) }) }
    },

    intake: () => Array.from(waiting.values()).sort((left, right) => left.receivedAt - right.receivedAt),

    ingest: async ({ drafts, extensionOrigin }) => {
      const accepted: UnassignedAnnotation[] = []
      for (const draft of drafts) {
        if (waiting.size >= MAX_UNASSIGNED) {
          const oldest = Array.from(waiting.values()).sort((left, right) => left.receivedAt - right.receivedAt)[0]
          if (oldest !== undefined) {
            waiting.delete(oldest.id)
            await guard(() => unassigned.delete(oldest.id))
          }
        }
        state = { ...state, sequence: state.sequence + 1 }
        const item: UnassignedAnnotation = {
          id: `ext_${state.sequence}`,
          draft: { ...draft, target: { ...draft.target, surface: 'external' } },
          receivedAt: now(),
          extensionOrigin,
        }
        waiting.set(item.id, item)
        await guard(() => unassigned.put(item.id, item))
        accepted.push(item)
      }
      await persistMeta()
      return accepted
    },

    attach: async ({ sessionId, ids }) => {
      const attached: Annotation[] = []
      for (const id of ids) {
        const pending = waiting.get(id)
        if (pending === undefined) return { ok: false, error: 'missing' }
        const created = await createRecords({ sessionId, drafts: [pending.draft], origin: 'extension' })
        if (!created.ok) return { ok: false, error: created.error }
        waiting.delete(id)
        await guard(() => unassigned.delete(id))
        attached.push(...created.value)
      }
      return { ok: true, value: attached }
    },

    flush: persistMeta,
  }
}

import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  MAX_ATTENTION_SESSIONS,
  threadAttentionViewSchema,
  type AttentionFinishReason,
  type ThreadAttentionMigrationEntry,
  type ThreadAttentionSnapshot,
  type ThreadAttentionView,
} from './attention-api.js'

export const threadAttentionDomain = defineDomain({
  name: 'thread_attention',
  version: 1,
  tables: {
    sessions: { valueSchema: threadAttentionViewSchema, __key: 'sessions' },
  },
})

export type AttentionTable = KvTable<string, ThreadAttentionView>

const turnEndEventSchema = z.object({
  type: z.literal('turn/end'),
  data: z.object({ reason: z.object({ kind: z.string().max(64), reason: z.object({ kind: z.string().max(64) }).optional() }) }),
})

/**
 * Turn ends that ask the user for something. `forked` closes a fork's
 * bookkeeping and `interrupted` continues in the next turn, so neither is a
 * completion to review.
 */
const finishReasonByKind: Readonly<Record<string, AttentionFinishReason>> = {
  completed: 'completed',
  aborted: 'aborted',
  blocked: 'blocked',
  error: 'error',
  'max-tokens': 'max-tokens',
}

const finishReasonFromEvent = (event: unknown): AttentionFinishReason | null => {
  const parsed = turnEndEventSchema.safeParse(event)
  if (!parsed.success) return null
  const reason = parsed.data.data.reason
  // The Host shutting down disposes a running Agent: that turn resumes after the restart, it was not stopped by anyone.
  if (reason.kind === 'aborted' && reason.reason?.kind === 'disposed') return null
  return finishReasonByKind[reason.kind] ?? null
}

/** Monotone across Host restarts: a new record always outranks every stored version. */
const nextAttentionVersion = (current: number, now: number): number => Math.max(current + 1, now)

const byVersionAscending = (left: ThreadAttentionView, right: ThreadAttentionView): number => left.version - right.version

/** Keys to drop once the store exceeds its bound; the least recently written records go first. */
const attentionKeysToTrim = (records: readonly ThreadAttentionView[], limit = MAX_ATTENTION_SESSIONS): readonly string[] =>
  [...records]
    .sort(byVersionAscending)
    .slice(0, Math.max(0, records.length - limit))
    .map(record => record.sessionId)

const legacyAttentionRecord = (entry: ThreadAttentionMigrationEntry, version: number): ThreadAttentionView | null =>
  entry.finishedAt === null && !entry.manuallyUnread
    ? null
    : {
        sessionId: entry.sessionId,
        version,
        finishedAt: entry.finishedAt,
        finishedSeq: null,
        finishedReason: null,
        manuallyUnread: entry.manuallyUnread,
      }

export interface AttentionStore {
  snapshot(): ThreadAttentionSnapshot
  recordFinish(input: { readonly sessionId: string; readonly seq: number; readonly time: number; readonly reason: AttentionFinishReason }): void
  acknowledge(input: { readonly sessionId: string; readonly version: number }): Promise<ThreadAttentionSnapshot>
  clearUnread(input: { readonly sessionId: string; readonly version: number }): Promise<ThreadAttentionSnapshot>
  markUnread(input: { readonly sessionId: string }): Promise<ThreadAttentionSnapshot>
  migrate(entries: readonly ThreadAttentionMigrationEntry[]): Promise<ThreadAttentionSnapshot>
  flush(): Promise<void>
}

/**
 * The Host's durable record of threads the user has not acknowledged. Only
 * unacknowledged threads are stored, so acknowledging deletes a row instead of
 * keeping a comparison value that could drift from the session log.
 */
export const createAttentionStore = ({
  table,
  now = Date.now,
  reportError = error => console.error('Thread attention write failed', { error: error instanceof Error ? error.message.slice(0, 200) : typeof error }),
}: {
  readonly table: AttentionTable
  readonly now?: () => number
  readonly reportError?: (error: unknown) => void
}): AttentionStore => {
  const records = new Map<string, ThreadAttentionView>(table.entries())
  let revision = Math.max(now(), ...[...records.values()].map(record => record.version))
  let writes: Promise<void> = Promise.resolve()

  const enqueue = (operation: () => Promise<unknown>): Promise<void> => {
    const result = writes.then(operation).then(() => undefined)
    writes = result.catch(() => undefined)
    return result
  }

  const trim = (): void => {
    for (const sessionId of attentionKeysToTrim([...records.values()])) {
      records.delete(sessionId)
      void enqueue(() => table.delete(sessionId)).catch(reportError)
    }
  }

  const put = (record: ThreadAttentionView): Promise<void> => {
    records.set(record.sessionId, record)
    trim()
    return enqueue(() => table.put(record.sessionId, record))
  }

  const snapshot = (): ThreadAttentionSnapshot => ({
    revision,
    sessions: [...records.values()].sort((left, right) => (right.finishedAt ?? 0) - (left.finishedAt ?? 0) || byVersionAscending(left, right)),
  })

  const takeVersion = (): number => {
    revision = nextAttentionVersion(revision, now())
    return revision
  }

  return {
    snapshot,
    recordFinish: ({ sessionId, seq, time, reason }) => {
      const existing = records.get(sessionId)
      void put({
        sessionId,
        version: takeVersion(),
        finishedAt: time,
        finishedSeq: seq,
        finishedReason: reason,
        manuallyUnread: existing?.manuallyUnread ?? false,
      }).catch(reportError)
    },
    acknowledge: async ({ sessionId, version }) => {
      const record = records.get(sessionId)
      if (record !== undefined && record.version <= version) {
        if (record.manuallyUnread) {
          await put({ sessionId, version: takeVersion(), finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: true })
        } else {
          records.delete(sessionId)
          await enqueue(() => table.delete(sessionId))
        }
      }
      return snapshot()
    },
    clearUnread: async ({ sessionId, version }) => {
      const record = records.get(sessionId)
      if (record !== undefined && record.version <= version) {
        records.delete(sessionId)
        await enqueue(() => table.delete(sessionId))
      }
      return snapshot()
    },
    markUnread: async ({ sessionId }) => {
      const existing = records.get(sessionId)
      await put({
        sessionId,
        version: takeVersion(),
        finishedAt: existing?.finishedAt ?? null,
        finishedSeq: existing?.finishedSeq ?? null,
        finishedReason: existing?.finishedReason ?? null,
        manuallyUnread: true,
      })
      return snapshot()
    },
    migrate: async entries => {
      for (const entry of entries) {
        if (records.has(entry.sessionId)) continue
        const record = legacyAttentionRecord(entry, takeVersion())
        if (record !== null) await put(record)
      }
      return snapshot()
    },
    flush: () => writes,
  }
}

export class ThreadAttentionStoreModel {
  static readonly finishReasonFromEvent = finishReasonFromEvent
  static readonly nextVersion = nextAttentionVersion
  static readonly keysToTrim = attentionKeysToTrim
  static readonly legacyRecord = legacyAttentionRecord
}

import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  MAX_COMMENT_THREADS,
  commentThreadSchema,
  type CommentAnchor,
  type CommentAuthor,
  type CommentSource,
  type CommentThread,
} from './review-comments-api.js'

export const commentThreadsDomain = defineDomain({
  name: 'changes_review',
  version: 1,
  tables: {
    threads: { valueSchema: commentThreadSchema, __key: 'threads' },
  },
})

export type CommentThreadsTable = KvTable<string, CommentThread>

/** One review's identity, the same tuple both surfaces and their comments agree on. */
export const commentSourceKey = (source: CommentSource): string =>
  source.kind === 'turn' ? JSON.stringify(['turn', source.sessionId, source.seq]) : JSON.stringify(['workspace', source.path, source.base, source.head])

const byCreatedAt = (left: CommentThread, right: CommentThread): number => left.createdAt - right.createdAt

/** Threads to drop once the store exceeds its bound; the oldest go first. */
export const threadsToTrim = (threads: readonly CommentThread[], limit = MAX_COMMENT_THREADS): readonly string[] =>
  [...threads]
    .sort(byCreatedAt)
    .slice(0, Math.max(0, threads.length - limit))
    .map(thread => thread.id)

export interface CommentThreadsStore {
  list(source: CommentSource): readonly CommentThread[]
  create(input: {
    readonly source: CommentSource
    readonly path: string
    readonly anchor: CommentAnchor
    readonly body: string
    readonly author: CommentAuthor
  }): Promise<CommentThread>
  reply(input: { readonly id: string; readonly body: string; readonly author: CommentAuthor }): Promise<CommentThread>
  setResolved(input: { readonly id: string; readonly resolved: boolean }): Promise<CommentThread>
  delete(id: string): Promise<{ readonly deleted: true }>
  flush(): Promise<void>
}

const missingThread = (): Error => new Error('That review comment thread is no longer there.')

const createCommentThreadsStore = ({
  table,
  now = Date.now,
  newId = () => crypto.randomUUID(),
  reportError = error => console.error('Review comment write failed', { error: error instanceof Error ? error.message.slice(0, 200) : typeof error }),
}: {
  readonly table: CommentThreadsTable
  readonly now?: () => number
  readonly newId?: () => string
  readonly reportError?: (error: unknown) => void
}): CommentThreadsStore => {
  const threads = new Map<string, CommentThread>(table.entries())
  let writes: Promise<void> = Promise.resolve()

  const enqueue = (operation: () => Promise<unknown>): Promise<void> => {
    const result = writes.then(operation).then(() => undefined)
    writes = result.catch(() => undefined)
    return result
  }

  const put = (thread: CommentThread): Promise<void> => {
    threads.set(thread.id, thread)
    for (const id of threadsToTrim([...threads.values()])) {
      threads.delete(id)
      void enqueue(() => table.delete(id)).catch(reportError)
    }
    return enqueue(() => table.put(thread.id, thread))
  }

  const find = (id: string): CommentThread => {
    const thread = threads.get(id)
    if (thread === undefined) throw missingThread()
    return thread
  }

  return {
    list: source => {
      const wanted = commentSourceKey(source)
      return [...threads.values()].filter(thread => commentSourceKey(thread.source) === wanted).sort(byCreatedAt)
    },
    create: async input => {
      const thread: CommentThread = {
        id: newId(),
        source: input.source,
        path: input.path,
        anchor: input.anchor,
        body: input.body,
        author: input.author,
        createdAt: now(),
        replies: [],
      }
      await put(thread)
      return thread
    },
    reply: async input => {
      const thread = find(input.id)
      const next: CommentThread = {
        ...thread,
        replies: [...thread.replies, { id: newId(), body: input.body, author: input.author, createdAt: now() }],
      }
      await put(next)
      return next
    },
    setResolved: async input => {
      const thread = find(input.id)
      const { resolvedAt: previousResolvedAt, ...rest } = thread
      void previousResolvedAt
      const next: CommentThread = input.resolved ? { ...rest, resolvedAt: now() } : rest
      await put(next)
      return next
    },
    delete: async id => {
      find(id)
      threads.delete(id)
      await enqueue(() => table.delete(id))
      return { deleted: true }
    },
    flush: () => writes,
  }
}

export class CommentThreadsModel {
  static readonly domain = commentThreadsDomain
  static readonly sourceKey = commentSourceKey
  static readonly threadsToTrim = threadsToTrim
  static readonly createStore = createCommentThreadsStore
}

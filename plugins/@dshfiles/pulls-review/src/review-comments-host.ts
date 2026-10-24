import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { reviewCommentsApi, type CommentAuthor } from './review-comments-api.js'
import { CommentThreadsModel, type CommentThreadsStore } from './review-comments-store.js'

interface OpenedThreads {
  readonly store: CommentThreadsStore
  readonly close: () => Promise<void>
}

/**
 * One store per Host process, not per Cordis context: API handlers receive
 * different contexts, and a second store would keep its own map and clobber the
 * other's durable rows.
 */
let opening: Promise<OpenedThreads> | undefined

const openThreads = async (ctx: Context): Promise<OpenedThreads> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Review comment storage is unavailable.')
  const domain = await storage.open(CommentThreadsModel.domain)
  return { store: CommentThreadsModel.createStore({ table: domain.table('threads') }), close: () => domain.close() }
}

export const threadsFor = (ctx: Context): Promise<CommentThreadsStore> => {
  if (opening === undefined) {
    const started = openThreads(ctx)
    opening = started
    void started.catch(() => {
      if (opening === started) opening = undefined
    })
  }
  // oxlint-disable-next-line antislop/no-passthrough-variable -- `opening` is reassigned by the catch above, so the snapshot is the required narrowing.
  const current = opening
  if (current === undefined) throw new Error('Review comment storage is unavailable.')
  return current.then(opened => opened.store)
}

export const closeThreads = async (): Promise<void> => {
  if (opening === undefined) return
  const opened = await opening.catch(() => undefined)
  opening = undefined
  if (opened === undefined) return
  await opened.store.flush()
  await opened.close()
}

/** A comment written from a tool is the Agent's; a browser click is the user's. */
const authorOf = (caller: ApiCaller | undefined): CommentAuthor =>
  caller?.kind === 'agent' ? { kind: 'agent', ...(caller.sessionId === undefined ? {} : { sessionId: caller.sessionId }) } : { kind: 'user' }

export const reviewCommentsApiHost = reviewCommentsApi.host({
  list: async ({ ctx, input }) => ({ threads: [...(await threadsFor(ctx)).list(input.source)] }),
  create: async ({ ctx, input, caller }) => (await threadsFor(ctx)).create({ ...input, author: authorOf(caller) }),
  reply: async ({ ctx, input, caller }) => (await threadsFor(ctx)).reply({ id: input.id, body: input.body, author: authorOf(caller) }),
  setResolved: async ({ ctx, input }) => (await threadsFor(ctx)).setResolved(input),
  delete: async ({ ctx, input }) => (await threadsFor(ctx)).delete(input.id),
})

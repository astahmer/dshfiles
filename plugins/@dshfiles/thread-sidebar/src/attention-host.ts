import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { Effect } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { threadSidebarAttentionApi } from './attention-api.js'
import { createAttentionStore, threadAttentionDomain, type AttentionStore } from './attention-store.js'

interface OpenedAttention {
  readonly store: AttentionStore
  readonly close: () => Promise<void>
}

/**
 * One store per Host process, not per Cordis context: an API handler and the
 * session-event tracker receive different contexts, and a second store would
 * keep its own record map and clobber the other's durable rows.
 */
let opening: Promise<OpenedAttention> | undefined

const openAttention = async (ctx: Context): Promise<OpenedAttention> => {
  const storage = ctx.storageDomain
  if (storage === undefined) throw new Error('Thread attention storage is unavailable.')
  const domain = await storage.open(threadAttentionDomain)
  return { store: createAttentionStore({ table: domain.table('sessions') }), close: () => domain.close() }
}

export const attentionFor = (ctx: Context): Promise<AttentionStore> => {
  if (opening === undefined) {
    const started = openAttention(ctx)
    opening = started
    void started.catch(() => {
      if (opening === started) opening = undefined
    })
  }
  return opening.then(opened => opened.store)
}

export const closeAttention = async (): Promise<void> => {
  if (opening === undefined) return
  const opened = await opening.then(
    value => value,
    () => undefined,
  )
  // Cleared before the store is released, so the next reader opens a fresh one.
  opening = undefined
  if (opened === undefined) return
  await opened.store.flush()
  await opened.close()
}

export const threadAttentionApiHost = DshxEffect.host(threadSidebarAttentionApi, {
  state: Effect.fn('thread-sidebar attention state read')(({ ctx }) =>
    Effect.tryPromise({ try: async () => (await attentionFor(ctx)).snapshot(), catch: error => error }),
  ),
  acknowledge: Effect.fn('thread-sidebar attention acknowledge')(({ ctx, input }) =>
    Effect.tryPromise({ try: async () => (await attentionFor(ctx)).acknowledge(input), catch: error => error }),
  ),
  clearUnread: Effect.fn('thread-sidebar attention unread clear')(({ ctx, input }) =>
    Effect.tryPromise({ try: async () => (await attentionFor(ctx)).clearUnread(input), catch: error => error }),
  ),
  clearUnreadMany: Effect.fn('thread-sidebar attention unread clear batch')(({ ctx, input }) =>
    Effect.tryPromise({ try: async () => (await attentionFor(ctx)).clearUnreadMany(input.entries), catch: error => error }),
  ),
  markUnread: Effect.fn('thread-sidebar attention unread mark')(({ ctx, input }) =>
    Effect.tryPromise({ try: async () => (await attentionFor(ctx)).markUnread(input), catch: error => error }),
  ),
  markUnreadMany: Effect.fn('thread-sidebar attention unread mark batch')(({ ctx, input }) =>
    Effect.tryPromise({ try: async () => (await attentionFor(ctx)).markUnreadMany(input.sessionIds), catch: error => error }),
  ),
  migrate: Effect.fn('thread-sidebar attention migration')(({ ctx, input }) =>
    Effect.tryPromise({ try: async () => (await attentionFor(ctx)).migrate(input.entries), catch: error => error }),
  ),
})

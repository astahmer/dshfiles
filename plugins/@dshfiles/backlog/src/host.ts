import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import { backlogApi } from './api.js'
import { BacklogModel, backlogDomain, type BacklogActor, type BacklogStore } from './store.js'

interface OpenedBacklog {
  readonly store: BacklogStore
  readonly close: () => Promise<void>
}

/**
 * One store per Host process, not per Cordis context: the API handlers and the setup effect receive
 * different contexts, and a second store would allocate the same ids.
 */
let opening: Promise<OpenedBacklog> | undefined

const openBacklog = async (ctx: Context): Promise<OpenedBacklog> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Backlog storage is unavailable.')
  const domain = await storage.open(backlogDomain)
  return { store: BacklogModel.createStore({ items: domain.table('items') }), close: () => domain.close() }
}

const backlogFor = (ctx: Context): Promise<BacklogStore> => {
  if (opening === undefined) {
    const started = openBacklog(ctx)
    opening = started
    void started.catch(() => {
      if (opening === started) opening = undefined
    })
  }
  return opening.then(opened => opened.store)
}

const closeBacklog = async (): Promise<void> => {
  if (opening === undefined) return
  const opened = await opening.then(
    value => value,
    () => undefined,
  )
  opening = undefined
  if (opened === undefined) return
  await opened.store.flush()
  await opened.close()
}

const actorOf = (caller: ApiCaller): BacklogActor =>
  caller.kind === 'agent' ? { kind: 'agent', sessionId: caller.sessionId, cwd: caller.cwd } : { kind: 'user' }

const backlogApiHost = backlogApi.host({
  list: async ({ ctx, input }) => (await backlogFor(ctx)).list(input),
  get: async ({ ctx, input }) => (await backlogFor(ctx)).get(input.id),
  referencing: async ({ ctx, input }) => (await backlogFor(ctx)).referencing(input),
  capture: async ({ ctx, input, caller }) => (await backlogFor(ctx)).capture({ ...input, actor: actorOf(caller) }),
  update: async ({ ctx, input, caller }) => (await backlogFor(ctx)).update({ ...input, actor: actorOf(caller) }),
  link: async ({ ctx, input, caller }) => (await backlogFor(ctx)).link({ ...input, actor: actorOf(caller) }),
  comment: async ({ ctx, input, caller }) => (await backlogFor(ctx)).comment({ ...input, actor: actorOf(caller) }),
})

export default defineHost({
  name: '@dshfiles/backlog',
  inject: ['storageDomain'],
  apis: [backlogApiHost],
  setup: ctx => {
    ctx.effect(() => {
      void backlogFor(ctx).catch(() => undefined)
      return async () => {
        await closeBacklog()
      }
    }, 'backlog: item store')
  },
})

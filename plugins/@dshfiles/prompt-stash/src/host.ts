import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { defineHost } from '@dshfiles/dshx/host'
import { promptStashApi } from './library-api.js'
import { createPromptStashStore, promptStashDomain, type PromptStashStore } from './store.js'

interface OpenedStash {
  readonly store: PromptStashStore
  readonly close: () => Promise<void>
}

/**
 * One store per Host process, not per Cordis context: the API handlers and the
 * setup effect receive different contexts, and a second store would keep its own
 * record maps and clobber the other's durable rows.
 */
let opening: Promise<OpenedStash> | undefined

const openStash = async (ctx: Context): Promise<OpenedStash> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Prompt stash storage is unavailable.')
  const domain = await storage.open(promptStashDomain)
  return {
    store: createPromptStashStore({ prompts: domain.table('prompts'), drafts: domain.table('drafts') }),
    close: () => domain.close(),
  }
}

const stashFor = (ctx: Context): Promise<PromptStashStore> => {
  if (opening === undefined) {
    const started = openStash(ctx)
    opening = started
    void started.catch(() => {
      if (opening === started) opening = undefined
    })
  }
  return opening.then(opened => opened.store)
}

const closeStash = async (): Promise<void> => {
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

const promptStashApiHost = promptStashApi.host({
  state: async ({ ctx }) => (await stashFor(ctx)).snapshot(),
  save: async ({ ctx, input }) => (await stashFor(ctx)).save(input),
  remove: async ({ ctx, input }) => (await stashFor(ctx)).remove(input),
  drafts: async ({ ctx }) => (await stashFor(ctx)).draftsSnapshot(),
  saveDraft: async ({ ctx, input }) => (await stashFor(ctx)).saveDraft(input.draft),
  removeDraft: async ({ ctx, input }) => (await stashFor(ctx)).removeDraft(input.id),
})

export default defineHost({
  name: '@dshfiles/prompt-stash',
  inject: ['storageDomain'],
  apis: [promptStashApiHost],
  setup: ctx => {
    ctx.effect(() => {
      const started = stashFor(ctx)
      void started.catch(() => undefined)
      return async () => {
        await closeStash()
      }
    }, 'prompt-stash: prompt stash store')
  },
})

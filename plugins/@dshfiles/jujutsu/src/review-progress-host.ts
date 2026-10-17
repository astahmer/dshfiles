import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { jujutsuReviewProgressApi } from './review-progress-api.js'
import { ReviewProgressStoreModel, reviewProgressDomain, type ReviewProgressStore } from './review-progress-store.js'

interface OpenedReviewProgress {
  readonly store: ReviewProgressStore
  readonly close: () => Promise<void>
}

/**
 * One store per Host process, not per Cordis context: an API handler and any
 * future writer receive different contexts, and a second store would keep its
 * own record map and clobber the other's durable rows.
 */
let opening: Promise<OpenedReviewProgress> | undefined

const openReviewProgress = async (ctx: Context): Promise<OpenedReviewProgress> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Jujutsu review progress storage is unavailable.')
  const domain = await storage.open(reviewProgressDomain)
  return { store: ReviewProgressStoreModel.create({ table: domain.table('marks') }), close: () => domain.close() }
}

export const reviewProgressFor = (ctx: Context): Promise<ReviewProgressStore> => {
  if (opening === undefined) {
    const started = openReviewProgress(ctx)
    opening = started
    void started.catch(() => {
      if (opening === started) opening = undefined
    })
  }
  return opening.then(opened => opened.store)
}

export const closeReviewProgress = async (): Promise<void> => {
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

export const jujutsuReviewProgressApiHost = jujutsuReviewProgressApi.host({
  state: async ({ ctx }) => (await reviewProgressFor(ctx)).snapshot(),
  toggle: async ({ ctx, input }) => (await reviewProgressFor(ctx)).toggle(input),
})

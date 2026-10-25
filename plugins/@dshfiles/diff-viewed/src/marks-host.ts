import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { diffViewedApi } from './marks-api.js'
import { ViewedMarksModel, viewedMarksDomain, type ViewedMarksStore } from './marks-store.js'

interface OpenedViewedMarks {
  readonly store: ViewedMarksStore
  readonly close: () => Promise<void>
}

/**
 * One store per Host process, not per Cordis context: API handlers receive
 * different contexts, and a second store would keep its own record map and
 * clobber the other's durable rows.
 */
let opening: Promise<OpenedViewedMarks> | undefined

const openViewedMarks = async (ctx: Context): Promise<OpenedViewedMarks> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Viewed marks storage is unavailable.')
  const domain = await storage.open(viewedMarksDomain)
  return { store: ViewedMarksModel.createStore({ table: domain.table('marks') }), close: () => domain.close() }
}

export const viewedMarksFor = (ctx: Context): Promise<ViewedMarksStore> => {
  if (opening === undefined) {
    const started = openViewedMarks(ctx)
    opening = started
    void started.catch(() => {
      if (opening === started) opening = undefined
    })
  }
  return opening.then(opened => opened.store)
}

export const closeViewedMarks = async (): Promise<void> => {
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

export const diffViewedApiHost = diffViewedApi.host({
  state: async ({ ctx }) => (await viewedMarksFor(ctx)).snapshot(),
  toggle: async ({ ctx, input }) => (await viewedMarksFor(ctx)).toggle(input),
  mark: async ({ ctx, input }) => {
    const { viewed, ...file } = input
    return (await viewedMarksFor(ctx)).mark(file, viewed)
  },
})

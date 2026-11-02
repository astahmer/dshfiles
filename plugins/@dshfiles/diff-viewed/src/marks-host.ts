import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Schema } from 'effect'
import { diffViewedApi } from './marks-api.js'
import { ViewedMarksModel, viewedMarksDomain, type ViewedMarksStore } from './marks-store.js'

class ViewedMarksFailure extends Schema.TaggedError<ViewedMarksFailure>()('ViewedMarksFailure', {
  operation: Schema.String,
  message: Schema.String,
}) {}

class ViewedMarksRuntime extends Context.Service<ViewedMarksRuntime, { readonly store: ViewedMarksStore }>()('@dshfiles/diff-viewed/Runtime') {}

const failure = (operation: string, error: unknown) => new ViewedMarksFailure({ operation, message: error instanceof Error ? error.message : String(error) })

const rootLayer = (ctx: CordisContext) =>
  Layer.effect(
    ViewedMarksRuntime,
    Effect.acquireRelease(
      Effect.gen(function* () {
        const storage = ctx.get('storageDomain')
        if (storage === undefined) return yield* Effect.fail(failure('open', 'Viewed marks storage is unavailable.'))
        const domain = yield* Effect.tryPromise({ try: () => storage.open(viewedMarksDomain), catch: error => failure('open', error) })
        return { domain, store: ViewedMarksModel.createStore({ table: domain.table('marks') }) }
      }),
      ({ domain, store }) =>
        Effect.tryPromise({
          try: async () => {
            await store.flush()
            await domain.close()
          },
          catch: error => failure('close', error),
        }).pipe(Effect.catch(error => Effect.sync(() => ctx.logger.error(`diff-viewed: ${error.message}`)))),
    ).pipe(Effect.map(({ store }) => ({ store }))),
  )

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: rootLayer,
  setup: () => ViewedMarksRuntime.use(() => Effect.void),
})

export const diffViewedApiHost = hostApi(diffViewedApi, {
  state: Effect.fn('diff viewed state read')(() => ViewedMarksRuntime.use(runtime => Effect.sync(() => runtime.store.snapshot()))),
  toggle: Effect.fn('diff viewed mark toggle')(({ input }) =>
    ViewedMarksRuntime.use(runtime => Effect.tryPromise({ try: () => runtime.store.toggle(input), catch: error => failure('toggle', error) })),
  ),
})

export { effectPlugin as diffViewedEffectPlugin }

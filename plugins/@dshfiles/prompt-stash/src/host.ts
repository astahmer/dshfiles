import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { promptStashApi } from './library-api.js'
import { PromptStashModel, promptStashDomain, type PromptStashStore } from './store.js'

class PromptStashStorageError extends Schema.TaggedError<PromptStashStorageError>()('PromptStashStorageError', {
  message: Schema.String,
}) {}

class PromptStashRuntime extends EffectContext.Service<PromptStashRuntime, { readonly store: PromptStashStore }>()(
  'dshfiles/prompt-stash/PromptStashRuntime',
) {}

const storageFailure = (): PromptStashStorageError => new PromptStashStorageError({ message: 'Prompt stash storage operation failed.' })

const promptStashLayer = (ctx: Context) =>
  Layer.effect(
    PromptStashRuntime,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const storage = ctx.get('storageDomain')
          if (storage === undefined) throw storageFailure()
          const domain = await storage.open(promptStashDomain)
          return {
            store: PromptStashModel.createStore({ prompts: domain.table('prompts') }),
            close: () => domain.close(),
          }
        },
        catch: () => storageFailure(),
      }),
      opened => Effect.promise(() => opened.store.flush()).pipe(Effect.ensuring(Effect.promise(() => opened.close()))),
    ).pipe(Effect.map(opened => ({ store: opened.store }))),
  )

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: promptStashLayer,
  setup: () => Effect.void,
})

const promptStashApiHost = hostApi(promptStashApi, {
  state: Effect.fn('prompt stash state read')(() => PromptStashRuntime.use(runtime => Effect.sync(() => runtime.store.snapshot()))),
  save: Effect.fn('prompt stash prompt save')(({ input }) =>
    PromptStashRuntime.use(runtime => Effect.tryPromise({ try: () => runtime.store.save(input), catch: () => storageFailure() })),
  ),
  remove: Effect.fn('prompt stash prompt remove')(({ input }) =>
    PromptStashRuntime.use(runtime => Effect.tryPromise({ try: () => runtime.store.remove(input), catch: () => storageFailure() })),
  ),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/prompt-stash',
  inject: ['storageDomain'],
  apis: [promptStashApiHost],
})

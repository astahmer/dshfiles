import type { Context } from '@deepseek-ai/cordis'
import { defineHost } from '@dshfiles/dshx/host'
import { resourcePacksApi } from './api.js'
import { ResourceStore } from './store.js'
import { ResourceValidation } from './validation.js'

/** Each mount owns its handle. A shared definition may safely run in independent Hosts. */
export function createResourcePacksHost(path?: string) {
  const stores = new WeakMap<Context, ResourceStore>()
  const store = (ctx: Context): ResourceStore => stores.get(ctx) ?? ResourceValidation.refuse('not-ready', 'The resource metadata store is not active.')
  return defineHost({
    name: '@dshfiles/resource-packs',
    apis: [
      resourcePacksApi.host({
        catalog: ({ ctx }) => store(ctx).catalog(),
        list: ({ ctx, input }) => store(ctx).list(input),
        get: ({ ctx, input }) => store(ctx).get(input),
        registerPack: ({ ctx, input, caller }) => store(ctx).registerPack(input, caller),
        registerResource: ({ ctx, input, caller }) => store(ctx).registerResource(input, caller),
        attach: ({ ctx, input, caller }) => store(ctx).attach(input, caller),
        setValues: ({ ctx, input, caller }) => store(ctx).setValues(input, caller),
        detach: ({ ctx, input, caller }) => store(ctx).detach(input, caller),
      }),
    ],
    setup(ctx) {
      const instance = new ResourceStore(path)
      stores.set(ctx, instance)
      ctx.effect(
        () => () => {
          stores.delete(ctx)
          instance.close()
        },
        'resource-packs SQLite handle',
      )
    },
  })
}

export default createResourcePacksHost()

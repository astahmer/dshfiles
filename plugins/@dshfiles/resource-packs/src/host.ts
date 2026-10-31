import { Context as EffectContext, Effect, Layer } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { resourcePacksApi } from './api.js'
import { ResourceStore } from './store.js'

class ResourcePacksRuntime extends EffectContext.Service<ResourcePacksRuntime, { readonly store: ResourceStore }>()('@dshfiles/resource-packs/Runtime') {}

/** Each mount owns its handle. A shared definition may safely run in independent Hosts. */
export function createResourcePacksHost(path?: string) {
  const { hostApi, ...effectPlugin } = DshxEffect.plugin({
    layer: () =>
      Layer.effect(
        ResourcePacksRuntime,
        Effect.acquireRelease(
          Effect.sync(() => ({ store: new ResourceStore(path) })),
          ({ store }) => Effect.sync(() => store.close()),
        ),
      ),
    setup: () => Effect.void,
  })

  const api = hostApi(resourcePacksApi, {
    catalog: Effect.fn('resource packs catalog read')(() => ResourcePacksRuntime.use(({ store }) => Effect.sync(() => store.catalog()))),
    list: Effect.fn('resource packs list')(({ input }) => ResourcePacksRuntime.use(({ store }) => Effect.sync(() => store.list(input)))),
    get: Effect.fn('resource packs get')(({ input }) => ResourcePacksRuntime.use(({ store }) => Effect.sync(() => store.get(input)))),
    registerPack: Effect.fn('resource packs register pack')(({ input, caller }) =>
      ResourcePacksRuntime.use(({ store }) => Effect.sync(() => store.registerPack(input, caller))),
    ),
    registerResource: Effect.fn('resource packs register resource')(({ input, caller }) =>
      ResourcePacksRuntime.use(({ store }) => Effect.sync(() => store.registerResource(input, caller))),
    ),
    attach: Effect.fn('resource packs attach')(({ input, caller }) => ResourcePacksRuntime.use(({ store }) => Effect.sync(() => store.attach(input, caller)))),
    setValues: Effect.fn('resource packs set values')(({ input, caller }) =>
      ResourcePacksRuntime.use(({ store }) => Effect.sync(() => store.setValues(input, caller))),
    ),
    detach: Effect.fn('resource packs detach')(({ input, caller }) => ResourcePacksRuntime.use(({ store }) => Effect.sync(() => store.detach(input, caller)))),
  })

  return defineHost({
    ...effectPlugin,
    name: '@dshfiles/resource-packs',
    apis: [api],
  })
}

export default createResourcePacksHost()

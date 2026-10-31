import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context, Effect, Layer } from 'effect'
import { pluginMarketplaceApi } from './api.js'
import { MarketplaceHostService } from './host-service.js'
import { DEFAULT_HUB_BASE_URL, marketplaceSettings } from './settings.js'

let readHubBaseUrl: (() => string) | undefined

const service = new MarketplaceHostService({
  settings: () => ({ hubBaseUrl: readHubBaseUrl?.() ?? DEFAULT_HUB_BASE_URL }),
})

const marketplaceSettingsHost = marketplaceSettings.host({
  setup(scope) {
    const read = (): string => scope.get().hubBaseUrl
    readHubBaseUrl = read
    return () => {
      if (readHubBaseUrl === read) readHubBaseUrl = undefined
    }
  },
})

class MarketplaceRuntime extends Context.Service<
  MarketplaceRuntime,
  {
    readonly list: (input: Parameters<typeof service.list>[0], ctx: CordisContext, signal: AbortSignal) => ReturnType<typeof service.listEffect>
    readonly install: (slug: string, ctx: CordisContext, signal: AbortSignal) => ReturnType<typeof service.installEffect>
  }
>()('@dshfiles/plugin-marketplace/Runtime') {}

const marketplaceLayer = Layer.succeed(MarketplaceRuntime, {
  list: service.listEffect,
  install: service.installEffect,
})

const { hostApi, ...effectPlugin } = DshxEffect.plugin({ layer: marketplaceLayer, setup: () => Effect.void })
const marketplaceHostApi = hostApi(pluginMarketplaceApi, {
  list: ({ input, ctx, signal }) => MarketplaceRuntime.use(runtime => runtime.list(input, ctx, signal)),
  install: ({ input, ctx, signal }) => MarketplaceRuntime.use(runtime => runtime.install(input.slug, ctx, signal)),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/plugin-marketplace',
  settings: [marketplaceSettingsHost],
  apis: [marketplaceHostApi],
})

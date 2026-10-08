import { defineHost } from '@dshfiles/dshx/host'
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

const marketplaceHostApi = pluginMarketplaceApi.host({
  list({ input, ctx, signal }) {
    return service.list(input, ctx, signal)
  },
  install({ input, ctx, signal }) {
    return service.install(input.slug, ctx, signal)
  },
})

export default defineHost({
  name: '@dshfiles/plugin-marketplace',
  settings: [marketplaceSettingsHost],
  apis: [marketplaceHostApi],
})

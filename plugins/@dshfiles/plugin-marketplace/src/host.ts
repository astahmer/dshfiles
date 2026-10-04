import { defineHost } from '@dshfiles/dshx/host'
import { pluginMarketplaceApi } from './api.js'
import { MarketplaceHostService } from './host-service.js'
import { marketplaceSettingsHost } from './settings.js'

const service = new MarketplaceHostService()

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

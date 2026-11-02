import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Layer } from 'effect'
import { pluginMarketplaceApi } from './api.js'
import { marketplaceLayer, MarketplaceService } from './marketplace-service.js'
import { marketplaceSettings } from './settings.js'
import { marketplaceSettingsLayer } from './settings-tag.js'

export default DshxPlugin.make({
  name: '@dshfiles/plugin-marketplace',
  inject: ['subprocess'],
  settings: [marketplaceSettings],
  layer: marketplaceLayer.pipe(Layer.provideMerge(marketplaceSettingsLayer), Layer.provideMerge(DshChildProcessSpawner.layer)),
  apis: [
    Api.bind(pluginMarketplaceApi, {
      list: input => MarketplaceService.use(service => service.list(input)),
      install: input => MarketplaceService.use(service => service.install(input.slug)),
    }),
  ],
})

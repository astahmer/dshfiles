import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Layer } from 'effect'
import { loopbackAccessApi } from './api.js'
import { LoopbackAdjunct, NetworkHost } from './host-edge-promise.js'
import { NetworkAccess } from './network-controller.js'

export default DshxPlugin.make({
  name: 'dshfiles-loopback-access',
  inject: ['webServer', 'webStartup', 'dshfilesNetworkStartup', 'settings', 'configEditor'],
  layer: NetworkAccess.layer.pipe(Layer.provideMerge(Layer.mergeAll(LoopbackAdjunct.layer, NetworkHost.layer))),
  apis: [
    Api.bind(loopbackAccessApi, {
      status: () => LoopbackAdjunct.use(adjunct => adjunct.status),
      network: () => NetworkAccess.use(network => network.snapshot),
      saveNetwork: input => NetworkAccess.use(network => network.save(input)),
    }),
  ],
})

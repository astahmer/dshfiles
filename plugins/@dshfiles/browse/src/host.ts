import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Layer } from 'effect'
import { browseApi } from './api.js'
import { BrowseCli } from './browse-cli.js'
import { HandoffAttention } from './handoff-attention.js'
import { BrowsePairing } from './pairing.js'
import { Browse } from './service.js'
import { browseSettings } from './settings.js'

const PlatformLive = Layer.mergeAll(DshChildProcessSpawner.layer, NodeFileSystem.layer, NodePath.layer, HostApis.layer, Settings.layer(browseSettings))

export const BrowseLive = HandoffAttention.layer.pipe(
  Layer.provideMerge(Browse.layer),
  Layer.provideMerge(BrowsePairing.layer),
  Layer.provideMerge(BrowseCli.layer),
  Layer.provideMerge(PlatformLive),
)

export default DshxPlugin.make({
  name: '@dshfiles/browse',
  inject: ['subprocess'],
  settings: [browseSettings],
  layer: BrowseLive,
  apis: [
    Api.bind(browseApi, {
      status: () => Browse.use(browse => browse.status),
      pairingStart: () => BrowsePairing.use(pairing => pairing.start),
      pairingCancel: () => BrowsePairing.use(pairing => pairing.cancel),
      pairings: () => Browse.use(browse => browse.pairings),
      pairingRevoke: input => Browse.use(browse => browse.revoke(input.target)),
    }),
  ],
})

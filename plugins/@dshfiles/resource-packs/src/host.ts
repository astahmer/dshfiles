import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Layer } from 'effect'
import { resourcePacksApi } from './api.js'
import { ResourceStore, ResourceStoreFile } from './store.js'

const resourcePacksHandlers = Api.handlers(resourcePacksApi, {
  catalog: () => ResourceStore.use(store => store.catalog()),
  list: input => ResourceStore.use(store => store.list(input)),
  get: input => ResourceStore.use(store => store.get(input)),
  registerPack: (input, call) => ResourceStore.use(store => store.registerPack({ input, caller: call.caller })),
  registerResource: (input, call) => ResourceStore.use(store => store.registerResource({ input, caller: call.caller })),
  attach: (input, call) => ResourceStore.use(store => store.attach({ input, caller: call.caller })),
  setValues: (input, call) => ResourceStore.use(store => store.setValues({ input, caller: call.caller })),
  detach: (input, call) => ResourceStore.use(store => store.detach({ input, caller: call.caller })),
})

/** One definition per call: a definition activates once per process, and each activation opens its own handle on `$DSH_HOME/plugins/resource-packs/resources.db`. */
export const createResourcePacksPlugin = () =>
  DshxPlugin.make({
    name: '@dshfiles/resource-packs',
    layer: ResourceStore.layer.pipe(Layer.provide(Layer.mergeAll(ResourceStoreFile.fromDshHome, nodeFileSystemLayer, nodePathLayer))),
    apis: [Api.bind(resourcePacksApi, resourcePacksHandlers)],
  })

export default createResourcePacksPlugin()

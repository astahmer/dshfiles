import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Layer } from 'effect'
import { agentToolkitApi } from './api.js'
import { PackageVersions, ProfileDirectory } from './package-versions.js'

export default DshxPlugin.make({
  name: '@dshfiles/agent-toolkit',
  layer: PackageVersions.layer.pipe(Layer.provide(ProfileDirectory.layer), Layer.provide(Layer.mergeAll(nodeFileSystemLayer, nodePathLayer))),
  apis: [Api.bind(agentToolkitApi, { versions: input => PackageVersions.use(versions => versions.read(input.packages)) })],
})

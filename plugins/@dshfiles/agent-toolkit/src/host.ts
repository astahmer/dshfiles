import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, Layer } from 'effect'
import { agentToolkitApi } from './api.js'
import { InstructionFiles } from './instruction-files.js'
import { PackageVersions, ProfileDirectory } from './package-versions.js'

const platform = Layer.mergeAll(nodeFileSystemLayer, nodePathLayer)

export default DshxPlugin.make({
  name: '@dshfiles/agent-toolkit',
  layer: Layer.mergeAll(PackageVersions.layer.pipe(Layer.provide(ProfileDirectory.layer)), InstructionFiles.layer).pipe(Layer.provide(platform)),
  apis: [
    Api.bind(agentToolkitApi, {
      versions: input => PackageVersions.use(versions => versions.read(input.packages)),
      instructionFiles: input => InstructionFiles.use(files => Effect.map(files.list(input.cwd), found => ({ files: found }))),
    }),
  ],
})

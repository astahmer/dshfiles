import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Layer } from 'effect'
import { threadTransferApi } from './api.js'
import { threadStoreLayer } from './host-edge-promise.js'
import { PACKAGE_ID, ThreadTransfer } from './transfer-service.js'

const sourceOf = (source: { readonly transferId: string } | { readonly path: string }) =>
  'path' in source ? { path: source.path } : { transferId: source.transferId }

export default DshxPlugin.make({
  name: PACKAGE_ID,
  layer: ThreadTransfer.layer.pipe(Layer.provide(Layer.mergeAll(threadStoreLayer, nodeFileSystemLayer, nodePathLayer))),
  apis: [
    Api.bind(threadTransferApi, {
      exportStage: input => ThreadTransfer.use(transfer => transfer.exportStaged(input.sessionId)),
      exportChunk: input => ThreadTransfer.use(transfer => transfer.readChunk(input)),
      exportFile: input => ThreadTransfer.use(transfer => transfer.exportFile(input)),
      importStage: input => ThreadTransfer.use(transfer => transfer.beginImport(input.bytes)),
      importChunk: input => ThreadTransfer.use(transfer => transfer.writeChunk(input)),
      inspect: input => ThreadTransfer.use(transfer => transfer.inspect(sourceOf(input.source))),
      import: input =>
        ThreadTransfer.use(transfer => transfer.importThread({ source: sourceOf(input.source), workspaceId: input.workspaceId, cwd: input.cwd })),
      destinations: () => ThreadTransfer.use(transfer => transfer.destinations),
    }),
  ],
})

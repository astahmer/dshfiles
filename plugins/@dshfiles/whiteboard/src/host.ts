import type {} from '@deepseek-ai/dsh-host-webserver'
import { Api, DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Context, Effect, type FileSystem, Layer, Option, type Path } from 'effect'
import { whiteboardApi } from './api.js'
import { createEditorAssetHandler, defaultEditorDirectory } from './editor-assets.js'
import { EDITOR_ASSET_ROUTE } from './editor-route.js'
import { BoardStore, BoardStoreFile } from './store.js'

const whiteboardHandlers = Api.handlers(whiteboardApi, {
  list: input => BoardStore.use(store => store.list(input)),
  read: input => BoardStore.use(store => store.read(input)),
  write: input => BoardStore.use(store => store.write(input)),
  rename: input => BoardStore.use(store => store.rename(input)),
  delete: input => BoardStore.use(store => store.remove(input)),
  restore: input => BoardStore.use(store => store.restore(input)),
})

/**
 * The editor is several megabytes of Excalidraw, so it is not in `client.js` (which every page downloads at boot):
 * it is a separate build the Client imports from this route the first time a board opens. The route serves only
 * that open-source build, the same trust class as the `/plugins/<id>/client.js` DSH itself serves.
 */
class EditorAssetRoute extends Context.Service<EditorAssetRoute, { readonly path: string | null }>()('@dshfiles/whiteboard/EditorAssetRoute') {
  static readonly layer = (directory: string) =>
    Layer.effect(
      EditorAssetRoute,
      Effect.gen(function* () {
        const webServer = yield* hostService('webServer').pipe(Effect.option)
        if (Option.isNone(webServer)) return EditorAssetRoute.of({ path: null })
        const server = webServer.value
        const services = yield* DshxPlugin.detachedContext<FileSystem.FileSystem | Path.Path>()
        const handler = createEditorAssetHandler({ directory, run: Effect.runPromiseWith(services) })
        yield* Effect.acquireRelease(
          Effect.sync(() => server.register({ kind: 'prefix', path: EDITOR_ASSET_ROUTE, handler })),
          unregister => Effect.sync(unregister),
        )
        return EditorAssetRoute.of({ path: EDITOR_ASSET_ROUTE })
      }),
    )
}

/** One definition per call: a definition activates once per process and opens its own handle on `boards.db`. */
export const createWhiteboardPlugin = (options: { readonly editorDirectory?: string } = {}) =>
  DshxPlugin.make({
    name: '@dshfiles/whiteboard',
    layer: Layer.mergeAll(
      BoardStore.layer.pipe(Layer.provide(Layer.mergeAll(BoardStoreFile.fromDshHome, nodeFileSystemLayer, nodePathLayer))),
      EditorAssetRoute.layer(options.editorDirectory ?? defaultEditorDirectory()).pipe(Layer.provide(Layer.mergeAll(nodeFileSystemLayer, nodePathLayer))),
    ),
    apis: [Api.bind(whiteboardApi, whiteboardHandlers)],
  })

export default createWhiteboardPlugin()

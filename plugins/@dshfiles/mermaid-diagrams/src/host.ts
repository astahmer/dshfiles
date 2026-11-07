import type {} from '@deepseek-ai/dsh-host-webserver'
import { DshxPlugin, hostServiceChanges } from '@dshfiles/dshx/effect'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, type FileSystem, Layer, Option, type Path, Ref, Stream } from 'effect'
import { createRendererAssetHandler, defaultRendererDirectory } from './renderer-assets.js'
import { RENDERER_ROUTE } from './renderer-route.js'

/**
 * The diagram renderer is ~270 KB gzipped, so it is not in `client.js` (which every page downloads at boot): the Client
 * imports it from this route the first time a diagram shows. The route serves only pele's open-source build, the same
 * trust class as the `/plugins/<id>/client.js` DSH itself serves.
 *
 * This plugin injects no service, so it can activate before the Host's web server exists: the route is registered
 * whenever `webServer` appears and withdrawn when it goes, instead of read once at activation.
 */
const rendererAssetRoute = (directory: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const services = yield* DshxPlugin.detachedContext<FileSystem.FileSystem | Path.Path>()
      const handler = createRendererAssetHandler({ directory, run: Effect.runPromiseWith(services) })
      const changes = yield* hostServiceChanges('webServer')
      const registered = yield* Ref.make<Option.Option<() => void>>(Option.none())
      const unregister = Effect.flatMap(Ref.getAndSet(registered, Option.none()), current =>
        Effect.sync(() => {
          if (Option.isSome(current)) current.value()
        }),
      )
      yield* Stream.runForEach(changes, availability =>
        Effect.gen(function* () {
          yield* unregister
          if (Option.isNone(availability)) return
          const server = availability.value
          yield* Ref.set(registered, Option.some(server.register({ kind: 'prefix', path: RENDERER_ROUTE, handler })))
        }),
      ).pipe(Effect.forkScoped)
      yield* Effect.addFinalizer(() => unregister)
    }),
  )

export default DshxPlugin.make({
  name: '@dshfiles/mermaid-diagrams',
  layer: rendererAssetRoute(defaultRendererDirectory()).pipe(Layer.provide(Layer.mergeAll(nodeFileSystemLayer, nodePathLayer))),
})

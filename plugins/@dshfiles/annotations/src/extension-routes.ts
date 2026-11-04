import type {} from '@deepseek-ai/dsh-host-webserver'
import { DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option } from 'effect'
import { enrichDrafts } from './enrich.js'
import { extensionOrigins } from './extension.js'
import { createIngestHandler } from './ingest.js'
import { INGEST_PATH, PAIR_PATH } from './limits.js'
import { createPairHandler, createPairing, type PairingStatus } from './pairing.js'
import type { AnnotationDraft } from './schema.js'
import { AnnotationStore } from './store.js'

/**
 * The extension's two loopback routes, registered on the DSH web server for the plugin's lifetime: `ingest` takes
 * feedback with the bearer token, `pair` hands that token over once while the user-armed window is open.
 */
export class ExtensionRoutes extends Context.Service<
  ExtensionRoutes,
  {
    readonly arm: Effect.Effect<PairingStatus>
    readonly status: Effect.Effect<PairingStatus>
  }
>()('@dshfiles/annotations/ExtensionRoutes') {
  static readonly layer = Layer.effect(
    ExtensionRoutes,
    Effect.gen(function* () {
      const pairing = createPairing({})
      const token = yield* DshxPlugin.callback(() => AnnotationStore.use(store => store.token))
      const ingest = yield* DshxPlugin.callback((input: { readonly drafts: readonly AnnotationDraft[]; readonly extensionOrigin: string }) =>
        Effect.flatMap(enrichDrafts(input.drafts), drafts => AnnotationStore.use(store => store.ingest({ drafts, extensionOrigin: input.extensionOrigin }))),
      )
      const allowedOrigins = () => extensionOrigins({ env: process.env })
      const webServer = yield* hostService('webServer').pipe(Effect.option)
      if (Option.isSome(webServer)) {
        const server = webServer.value
        yield* Effect.acquireRelease(
          Effect.sync(() => [
            server.register({ kind: 'exact', path: INGEST_PATH, handler: createIngestHandler({ token, allowedOrigins, ingest }) }),
            server.register({ kind: 'exact', path: PAIR_PATH, handler: createPairHandler({ pairing, token, allowedOrigins }) }),
          ]),
          unregister => Effect.sync(() => unregister.forEach(remove => remove())),
        )
      }
      return ExtensionRoutes.of({ arm: Effect.sync(() => pairing.arm()), status: Effect.sync(() => pairing.status()) })
    }),
  )
}

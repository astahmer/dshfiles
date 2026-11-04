import type {} from '@deepseek-ai/dsh-host-webserver'
import { DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { Effect, Layer, Schema } from 'effect'
import { injectAfterHead, SHARED_EVENT_SOURCE_WORKER, SHARED_EVENT_SOURCE_WORKER_PATH, sharedEventSourceScript } from './shim.js'

/** A missing row config still decodes to the enabled-by-default configuration. */
const SharedStreamsConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
}).pipe(Schema.withDecodingDefaultType(Effect.succeed({ enabled: true })))

class SharedStreamsSetupFailure extends Schema.TaggedError<SharedStreamsSetupFailure>()('SharedStreamsSetupFailure', {
  operation: Schema.Literals(['worker-route', 'index-tap']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Shared streams could not install its ${this.operation}; every tab keeps its own EventSource. Check the Host log, then restart DSH.`
  }
}

const serveSharedEventSource = Effect.fn('shared streams setup')(function* (config: typeof SharedStreamsConfig.Type) {
  if (!config.enabled) return
  const webServer = yield* hostService('webServer')
  const markup = `<script>${sharedEventSourceScript()}</script>`
  yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        webServer.register({
          kind: 'exact',
          path: `/${SHARED_EVENT_SOURCE_WORKER_PATH}`,
          handler: (_request, response) => {
            response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
            response.end(SHARED_EVENT_SOURCE_WORKER)
          },
        }),
      catch: cause => new SharedStreamsSetupFailure({ operation: 'worker-route', cause }),
    }),
    unregister => Effect.sync(unregister),
  )
  yield* Effect.acquireRelease(
    Effect.try({
      try: () => webServer.tapIndex(html => injectAfterHead(html, markup)),
      catch: cause => new SharedStreamsSetupFailure({ operation: 'index-tap', cause }),
    }),
    untap => Effect.sync(untap),
  )
})

export default DshxPlugin.make({
  name: '@dshfiles/shared-streams',
  inject: ['webServer'],
  Config: SharedStreamsConfig,
  layer: config => Layer.effectDiscard(serveSharedEventSource(config)),
})

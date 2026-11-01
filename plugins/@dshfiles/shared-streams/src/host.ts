import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { injectAfterHead, SHARED_EVENT_SOURCE_WORKER, SHARED_EVENT_SOURCE_WORKER_PATH, sharedEventSourceScript } from './shim.js'

const rowConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
}).pipe(Schema.withDecodingDefaultType(Effect.succeed({ enabled: true })))

/** A missing row config still decodes to the enabled-by-default configuration. */
const standardRowConfig = Schema.toStandardSchemaV1(rowConfig)
export const Config = { '~standard': standardRowConfig['~standard'] }
type SharedStreamsConfig = typeof rowConfig.Type

class SharedStreamsSetupFailure extends Schema.TaggedError<SharedStreamsSetupFailure>()('SharedStreamsSetupFailure', {
  message: Schema.String,
}) {}

class SharedStreamsHost extends EffectContext.Service<SharedStreamsHost, { readonly webServer: NonNullable<Context['webServer']> }>()(
  '@dshfiles/shared-streams/Host',
) {}

const rootLayer = (ctx: Context) =>
  Layer.effect(
    SharedStreamsHost,
    Effect.try({
      try: () => {
        const webServer = ctx.get('webServer')
        if (webServer === undefined) throw new Error('The web server service is unavailable.')
        return { webServer }
      },
      catch: error => new SharedStreamsSetupFailure({ message: error instanceof Error ? error.message : String(error) }),
    }),
  )

const setupSharedStreams = Effect.fn('shared streams setup')((config: SharedStreamsConfig) => {
  if (!config.enabled) return Effect.void
  return Effect.gen(function* () {
    const runtime = yield* SharedStreamsHost
    const markup = `<script>${sharedEventSourceScript()}</script>`
    yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const unregisterRoute = runtime.webServer.register({
            kind: 'exact',
            path: `/${SHARED_EVENT_SOURCE_WORKER_PATH}`,
            handler: (_request, response) => {
              response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
              response.end(SHARED_EVENT_SOURCE_WORKER)
            },
          })
          const untapIndex = runtime.webServer.tapIndex(html => injectAfterHead(html, markup))
          return () => {
            unregisterRoute()
            untapIndex()
          }
        },
        catch: error => new SharedStreamsSetupFailure({ message: error instanceof Error ? error.message : String(error) }),
      }),
      cleanup => Effect.sync(cleanup),
    )
  })
})

const effectPlugin = DshxEffect.plugin({ layer: rootLayer, setup: (_ctx: Context, config: SharedStreamsConfig) => setupSharedStreams(config) })

const setupHost = (ctx: Context, config: SharedStreamsConfig) =>
  Effect.runPromise(
    Effect.tryPromise({
      try: () => effectPlugin.setup(ctx, config),
      catch: error => new SharedStreamsSetupFailure({ message: error instanceof Error ? error.message : String(error) }),
    }),
  )

export default defineHost({
  name: '@dshfiles/shared-streams',
  inject: ['webServer'],
  Config,
  setup: setupHost,
})

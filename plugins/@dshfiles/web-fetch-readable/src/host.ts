import { DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Effect, Layer, Schema } from 'effect'
import { DEFAULT_FETCH_OPTIONS, ReadableFetchProvider, type FetchOptions } from './provider.js'
import { readableFetchSettings, type ReadableFetchSettings } from './settings.js'

const FetchSettings = Settings.Tag<ReadableFetchSettings>(readableFetchSettings.namespace)

class ReadableProviderRegistrationFailed extends Schema.TaggedError<ReadableProviderRegistrationFailed>()('ReadableProviderRegistrationFailed', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'The readable web fetch provider could not register with DSH web; another plugin may own the "readable" fetch provider. Disable one of them, then restart DSH.'
  }
}

/** Read per fetch, so a settings change reaches the next call without a restart. */
const fetchOptions = Effect.fn('web fetch options')(function* () {
  const settings = yield* Effect.flatMap(FetchSettings, current => current.get)
  return {
    ...DEFAULT_FETCH_OPTIONS,
    readable: settings.readable,
    maxRedirects: settings.maxRedirects,
    timeoutMs: settings.timeoutMs,
    maxResponseBytes: settings.maxResponseBytes,
    maxBodyChars: settings.maxBodyChars,
  } satisfies FetchOptions
})

const FetchProvider = Layer.effectDiscard(
  Effect.gen(function* () {
    const web = yield* hostService('web')
    const options = yield* DshxPlugin.callback(fetchOptions)
    yield* Effect.acquireRelease(
      Effect.try({
        try: () => web.registerFetchProvider(new ReadableFetchProvider(options)),
        catch: cause => new ReadableProviderRegistrationFailed({ cause }),
      }),
      dispose => Effect.sync(dispose),
    )
  }),
)

export default DshxPlugin.make({
  name: '@dshfiles/web-fetch-readable',
  inject: ['web'],
  settings: [readableFetchSettings],
  layer: FetchProvider.pipe(Layer.provide(Settings.layer(readableFetchSettings))),
})

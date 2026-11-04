import { WebError } from '@deepseek-ai/dsh-web'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Config, Effect, Layer, Option, Schema } from 'effect'
import { BraveSearchModel, type BraveSearchOptions } from './brave.js'
import { braveSearchSettings, type BraveSearchSettings } from './settings.js'

const PROVIDER_ID = 'brave'
const ENV_KEY = 'BRAVE_API_KEY'

const BraveSettings = Settings.Tag<BraveSearchSettings>(braveSearchSettings.namespace)

class BraveProviderRegistrationFailed extends Schema.TaggedError<BraveProviderRegistrationFailed>()('BraveProviderRegistrationFailed', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'Brave search could not register with DSH web search; another plugin may own the "brave" provider. Disable one of them, then restart DSH.'
  }
}

/** Read per search, so a key stored or rotated in the Secret Catalog reaches the next call without a restart. */
const searchOptions = Effect.fn('brave search options')(function* () {
  const settings = yield* Effect.flatMap(BraveSettings, current => current.get)
  const resolver = yield* SecretReferenceResolver
  const environmentValue = yield* Config.option(Config.String(ENV_KEY))
  const apiKey = yield* resolver.resolve({ referenceText: settings.apiKey, environmentValue: Option.getOrUndefined(environmentValue) })
  if (Option.isNone(apiKey) || apiKey.value.trim() === '')
    return yield* Effect.fail(
      new WebError('Brave search needs a key: bind a Secret Catalog alias in Settings or set BRAVE_API_KEY.', 'WEB_PROVIDER_CREDENTIAL_MISSING'),
    )
  return { apiKey: apiKey.value, count: settings.count, safesearch: settings.safesearch } satisfies BraveSearchOptions
})

const SearchProvider = Layer.effectDiscard(
  Effect.gen(function* () {
    const web = yield* hostService('web')
    const options = yield* DshxPlugin.callback(searchOptions)
    yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          web.registerSearchProvider({
            id: PROVIDER_ID,
            available: () => true,
            search: async (request, signal) => BraveSearchModel.search(request, await options(), signal),
          }),
        catch: cause => new BraveProviderRegistrationFailed({ cause }),
      }),
      dispose => Effect.sync(dispose),
    )
  }),
)

export default DshxPlugin.make({
  name: '@dshfiles/web-search-brave',
  inject: ['web'],
  settings: [braveSearchSettings],
  layer: SearchProvider.pipe(Layer.provide(Layer.mergeAll(Settings.layer(braveSearchSettings), SecretReferenceResolver.layer))),
})

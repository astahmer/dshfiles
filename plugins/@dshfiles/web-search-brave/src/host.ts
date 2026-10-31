import { Context as EffectContext, Effect, Layer } from 'effect'
import type { Context } from '@deepseek-ai/cordis'
import { WebError, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { SecretReferenceResolver, type SecretCatalogValues } from '@dshfiles/credential-port'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { BraveSearchModel } from './brave.js'
import { braveSearchSettings, type BraveSearchSettings } from './settings.js'

const PROVIDER_ID = 'brave'
const ENV_KEY = 'BRAVE_API_KEY'

let settingsScope: SettingsScope<BraveSearchSettings> | undefined
const defaultSettings: BraveSearchSettings = braveSearchSettings.schema({})

const currentSettings = (): BraveSearchSettings => {
  try {
    return settingsScope?.get() ?? defaultSettings
  } catch {
    return defaultSettings
  }
}

const ownedSettings = braveSearchSettings.host({
  setup: scope => {
    settingsScope = scope
    return () => {
      if (settingsScope === scope) settingsScope = undefined
    }
  },
})

/** Resolved per search, so a key stored or rotated in the Secret Catalog reaches the next call without a restart. */
const resolveApiKey = (values: SecretCatalogValues | undefined): Promise<string | undefined> =>
  SecretReferenceResolver.resolve({
    referenceText: currentSettings().apiKey,
    values,
    environmentValue: process.env[ENV_KEY],
  })

const provider = (values: SecretCatalogValues | undefined): WebSearchProvider => ({
  id: PROVIDER_ID,
  available: () => true,
  search: async (request, signal) => {
    const apiKey = await resolveApiKey(values)
    if (apiKey === undefined || apiKey.trim() === '') {
      throw new WebError('Brave search needs a key: bind a Secret Catalog alias in Settings or set BRAVE_API_KEY.', 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    const settings = currentSettings()
    return BraveSearchModel.search(request, { apiKey, count: settings.count, safesearch: settings.safesearch }, signal)
  },
})

class BraveSearchHost extends EffectContext.Service<BraveSearchHost, { readonly secretValues: SecretCatalogValues | undefined }>()(
  '@dshfiles/web-search-brave/BraveSearchHost',
) {}

const effectPlugin = DshxEffect.plugin({
  layer: (ctx: Context) => Layer.succeed(BraveSearchHost, { secretValues: ctx.get('secretCatalogValues') }),
  setup: (ctx: Context) =>
    Effect.gen(function* () {
      const host = yield* BraveSearchHost
      yield* Effect.sync(() => ctx.effect(() => ctx.web.registerSearchProvider(provider(host.secretValues)), 'web-search-brave: provider'))
    }),
})

export default defineHost({
  name: '@dshfiles/web-search-brave',
  inject: ['web'],
  settings: [ownedSettings],
  setup: effectPlugin.setup,
})

import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import plugin from '../src/host.js'
import { braveSearchSettings } from '../src/settings.js'

const testHost = Effect.acquireRelease(
  Effect.promise(() => createTestHost()),
  host => Effect.promise(() => host.dispose()),
)

describe('the web-search-brave Host', () => {
  it.effect('registers the brave provider for the plugin lifetime and asks for a key when none is bound', () =>
    Effect.gen(function* () {
      const host = yield* testHost
      const providers = new Map<string, WebSearchProvider>()
      host.ctx.provide('settings', {
        configure: () => () => undefined,
        describe: () => [{ ns: braveSearchSettings.namespace, value: { apiKey: '', count: 5, safesearch: 'moderate' }, revision: 1 }],
        update: async () => undefined,
        replace: async () => undefined,
      })
      host.ctx.provide('web', {
        registerSearchProvider: (provider: WebSearchProvider) => {
          providers.set(provider.id, provider)
          return () => providers.delete(provider.id)
        },
      })
      const mounted = yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/web-search-brave' }))
      const brave = providers.get('brave')
      expect(brave?.available()).toBe(true)

      const missingKey = yield* Effect.promise(() =>
        Promise.resolve(brave?.search({ query: 'effect', maxResults: 3 }, new AbortController().signal)).then(
          () => undefined,
          (error: unknown) => error,
        ),
      )
      expect(missingKey).toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })

      yield* Effect.promise(() => mounted.dispose())
      expect(providers.has('brave')).toBe(false)
    }).pipe(Effect.scoped),
  )
})

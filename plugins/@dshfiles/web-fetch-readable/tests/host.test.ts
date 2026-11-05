import type { WebFetchProvider } from '@deepseek-ai/dsh-web'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import plugin from '../src/host.js'
import { readableFetchSettings } from '../src/settings.js'

const testHost = Effect.acquireRelease(
  Effect.promise(() => createTestHost()),
  host => Effect.promise(() => host.dispose()),
)

describe('the web-fetch-readable Host', () => {
  it.effect('registers the readable fetch provider for the plugin lifetime and validates URLs with the current settings', () =>
    Effect.gen(function* () {
      const host = yield* testHost
      const providers = new Map<string, WebFetchProvider>()
      host.ctx.provide('settings', {
        configure: () => () => undefined,
        describe: () => [
          {
            ns: readableFetchSettings.namespace,
            value: { readable: true, maxRedirects: 8, timeoutMs: 30_000, maxResponseBytes: 5_000_000, maxBodyChars: 100_000 },
            revision: 1,
          },
        ],
        update: async () => undefined,
        replace: async () => undefined,
      })
      host.ctx.provide('web', {
        registerFetchProvider: (provider: WebFetchProvider) => {
          providers.set(provider.id, provider)
          return () => providers.delete(provider.id)
        },
      })
      const mounted = yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/web-fetch-readable' }))
      const readable = providers.get('readable')
      expect(readable?.available()).toBe(true)

      const refused = yield* Effect.promise(() =>
        Promise.resolve(readable?.fetch({ url: 'ftp://example.com/file' }, new AbortController().signal)).then(
          () => undefined,
          (error: unknown) => error,
        ),
      )
      expect(refused).toMatchObject({ code: 'WEB_INVALID_URL' })

      yield* Effect.promise(() => mounted.dispose())
      expect(providers.has('readable')).toBe(false)
    }).pipe(Effect.scoped),
  )
})

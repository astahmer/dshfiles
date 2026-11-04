import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import plugin from '../src/host.js'

const packageId = '@dshfiles/rich-composer'

const warmHost = (sessionController: { readonly resolveAgent: (sessionId: string) => Promise<object> } | undefined) =>
  Effect.gen(function* () {
    const host = yield* Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      testHost => Effect.promise(() => testHost.dispose()),
    )
    host.ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [],
      update: async () => undefined,
      replace: async () => undefined,
    })
    if (sessionController !== undefined) host.ctx.provide('sessionController', sessionController)
    yield* Effect.promise(() => host.mount(plugin, { packageId }))
    return (sessionId: string) =>
      Effect.promise(() =>
        host.connection.requestApi({ packageId, apiId: 'agent-warmup', method: 'warm', version: 1, input: { sessionId } }).then(response => response.json()),
      )
  })

describe('agent warmup Host API', () => {
  it.effect('reports whether the thread Agent resumed, and the failure code when resuming throws', () =>
    Effect.gen(function* () {
      const warm = yield* warmHost({
        resolveAgent: async sessionId => {
          if (sessionId === 'broken') throw new Error('store offline')
          return sessionId === 'live' ? { agent: {} } : { error: { message: 'gone' } }
        },
      })
      expect(yield* warm('live')).toMatchObject({ result: { ok: true, value: { output: { live: true } } } })
      expect(yield* warm('missing')).toMatchObject({ result: { ok: true, value: { output: { live: false } } } })
      expect(yield* warm('broken')).toMatchObject({ result: { ok: false, error: { code: 'agent-warmup-failure', details: { sessionId: 'broken' } } } })
    }).pipe(Effect.scoped),
  )

  it.effect('answers not live when this Host runs no Session controller', () =>
    Effect.gen(function* () {
      const warm = yield* warmHost(undefined)
      expect(yield* warm('live')).toMatchObject({ result: { ok: true, value: { output: { live: false } } } })
    }).pipe(Effect.scoped),
  )
})

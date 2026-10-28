import { createApiClient } from '@dshfiles/dshx/api/client'
import { describe, expect, it } from 'vitest'
import { jujutsuApi } from './api.js'
import { openGraphRepository } from './repository-opening.js'

const registered = { repoId: '2f22ea1b-48fd-4db1-a267-3d7e8fc2fe7f', root: '/work/repo' }

const clientFor = (open: 'new' | 'missing' | 'legacy' | 'denied' | 'cancelled') => {
  const calls: string[] = []
  const api = createApiClient(
    {
      get: () => ({
        rpc: {
          call: async (_channel: string, method: string) => {
            calls.push(method.split('/').at(-1) ?? '')
            if (method.endsWith('/openRepository')) {
              if (open === 'missing') throw new Error('HTTP 404')
              if (open === 'legacy') return { ok: false, error: { code: 'bad-request', message: 'Unknown API method openRepository.' } }
              if (open === 'denied') return { ok: false, error: { code: 'plugin', message: 'Repository cannot be initialized.' } }
              if (open === 'cancelled') return { ok: false, error: { code: 'aborted' } }
              return { ok: true, value: { version: 1, output: { ...registered, initialized: true } } }
            }
            return { ok: true, value: { version: 1, output: registered } }
          },
        },
      }),
    },
    jujutsuApi,
  )
  return { api, calls }
}

describe('opening the graph across Host versions', () => {
  it('uses the explicit write method and returns its initialization receipt', async () => {
    const { api, calls } = clientFor('new')
    await expect(openGraphRepository(api, registered.root)).resolves.toEqual({ ...registered, initialized: true })
    expect(calls).toEqual(['openRepository'])
  })

  for (const failure of ['missing', 'legacy'] as const) {
    it(`falls back to read-only registration when an old Host reports ${failure}`, async () => {
      const { api, calls } = clientFor(failure)
      await expect(openGraphRepository(api, registered.root)).resolves.toEqual(registered)
      expect(calls).toEqual(['openRepository', 'registerRepository'])
    })
  }

  for (const failure of ['denied', 'cancelled'] as const) {
    it(`does not retry or hide a ${failure} initialization`, async () => {
      const { api, calls } = clientFor(failure)
      await expect(openGraphRepository(api, registered.root)).rejects.toMatchObject({ remoteCode: failure === 'denied' ? 'plugin' : 'aborted' })
      expect(calls).toEqual(['openRepository'])
    })
  }
})

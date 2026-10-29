import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApi, isApiOwnerMissing, method, PluginApiError } from '../src/api/index.js'
import { defineHost } from '../src/host/index.js'
import { connectDshxApiClient } from '../src/platform/index.js'
import { createTestHost } from '../src/testing/index.js'

const notesApi = defineApi({
  id: 'notes',
  version: 2,
  owner: '@test/notes',
  methods: {
    get: method({ input: z.object({ id: z.string().min(1) }), output: z.object({ id: z.string(), text: z.string() }) }),
    count: method<void, number>(),
  },
})

const notesHost = defineHost({
  apis: [
    notesApi.host({
      get: ({ input }) => {
        if (input.id !== 'a') throw new PluginApiError(`No note ${input.id}.`, { code: 'not-found' })
        return { id: 'a', text: 'first' }
      },
      count: () => 1,
    }),
  ],
})

describe('connectDshxApiClient', () => {
  it('calls a Host API out of the browser with the same methods, safe results and error kinds as a Client', async () => {
    const host = await createTestHost()
    try {
      await host.mount(notesHost, { packageId: '@test/notes' })
      const notes = await connectDshxApiClient(notesApi, { origin: 'http://dshx.test', fetch: host.connection.fetch })
      await expect(notes.get({ id: 'a' })).resolves.toEqual({ id: 'a', text: 'first' })
      await expect(notes.count()).resolves.toBe(1)
      await expect(notes.get({ id: 'b' })).rejects.toMatchObject({ name: 'ApiError', kind: 'remote', remoteCode: 'not-found', message: 'No note b.' })
      await expect(notes.get({ id: '' })).rejects.toMatchObject({ kind: 'contract' })
      expect(await notes.safe.get({ id: 'b' })).toMatchObject({ ok: false, error: { kind: 'remote', remoteCode: 'not-found' } })
      const controller = new AbortController()
      controller.abort()
      await expect(notes.count(undefined, { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' })
    } finally {
      await host.dispose()
    }
  })

  it('reports an owner that is not loaded the way isApiOwnerMissing expects', async () => {
    const host = await createTestHost()
    try {
      const notes = await connectDshxApiClient(notesApi, { origin: 'http://dshx.test', fetch: host.connection.fetch })
      const result = await notes.safe.count()
      expect(result.ok).toBe(false)
      expect(!result.ok && isApiOwnerMissing(result.error)).toBe(true)
    } finally {
      await host.dispose()
    }
  })

  it('needs a contract owner to address the route', async () => {
    const ownerless = defineApi({ id: 'ownerless', version: 1, methods: { ping: method<void, string>() } })
    await expect(connectDshxApiClient(ownerless, { origin: 'http://dshx.test' })).rejects.toThrow('declares no owner')
  })
})

import { describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import { defineApi, isApiOwnerMissing, method, PluginApiError } from '../src/api/index.js'
import type { ApiPayload } from '../src/api/registry.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'
import { defineHost } from '../src/host/index.js'
import { connectDshxApiClient } from '../src/platform/index.js'
import { createTestHost } from '../src/testing/index.js'

const notesApi = defineApi({
  id: 'notes',
  version: 2,
  owner: '@test/notes',
  methods: {
    get: method({
      input: Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1)) }),
      output: Schema.Struct({ id: Schema.String, text: Schema.String }),
    }),
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

const echoApi = defineApi({
  id: 'echo',
  version: 1,
  owner: '@test/echo',
  methods: {
    find: method({
      input: Schema.Struct({ id: Schema.String, tag: Schema.optional(Schema.String), scope: Schema.Struct({ project: Schema.optional(Schema.String) }) }),
      output: Schema.Struct({ ok: Schema.Boolean }),
    }),
  },
})

const clientOf = (call: (request: { readonly input?: ApiPayload }) => ApiPayload) =>
  ApiRuntimeModel.createClient(
    { get: () => ({ rpc: { call: async (_path: string, _endpoint: string, request: { readonly input?: ApiPayload }) => call(request) } }) },
    echoApi,
    '@test/echo',
  )

describe('Client input JSON normalization', () => {
  it('drops an object member written as undefined the way the JSON on the wire does', async () => {
    const sent: unknown[] = []
    const api = clientOf(request => {
      sent.push(request.input)
      return { ok: true, value: { version: echoApi.version, output: { ok: true } } }
    })

    await api.find({ id: 'a', tag: undefined, scope: { project: undefined } })

    expect(sent).toEqual([{ id: 'a', scope: {} }])
  })

  it('still rejects a Host output that carries undefined', async () => {
    const api = clientOf(() => ({ ok: true, value: { version: echoApi.version, output: { ok: undefined } } }))

    await expect(api.find({ id: 'a', scope: {} })).rejects.toMatchObject({
      kind: 'contract',
      message: 'API payload must contain only JSON values; undefined is permitted only for a void root.',
    })
  })
})

import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { createResourcePacksPlugin } from '../src/host.js'
import { packDefinitionSchema, resourceSchema } from '../src/model.js'
import { isolatedDshHome, owner, requestApi, testHost } from './host-layers.js'
import { platformLayer } from './store-layers.js'

const decodeResourceResponse = Schema.decodeUnknownEffect(
  Schema.Struct({ result: Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: resourceSchema }) }) }),
)
const decodeErrorResponse = Schema.decodeUnknownEffect(
  Schema.Struct({
    result: Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  }),
)

const mountedHost = Effect.gen(function* () {
  yield* isolatedDshHome
  const host = yield* testHost
  yield* Effect.promise(() => host.mount(createResourcePacksPlugin(), { packageId: owner }))
  // oxlint-disable-next-line antislop/no-unknown-parameters -- deliberately invalid wire input must reach the real API validator.
  return (method: string, input: unknown) => requestApi(host, method, input)
})

describe('authoritative API validation', () => {
  it.effect.each([
    ['list', { limit: 201 }],
    ['list', { limit: 0 }],
    ['list', { query: 'x'.repeat(501) }],
    ['registerResource', { ref: { provider: 'native', kind: 'file', id: '' }, label: 'Invalid' }],
    ['registerResource', { ref: { provider: 'native', kind: 'file', id: 'Opaque', extra: 'rejected' }, label: 'Invalid' }],
    ['registerResource', { ref: { provider: 'native', kind: 'file', id: 'Opaque' }, label: 'Invalid', owner: '@test/spoofed' }],
    ['get', { resourceId: 'not-a-uuid' }],
    [
      'registerPack',
      {
        definition: {
          id: 'defaults',
          version: 1,
          label: 'Default',
          properties: [{ id: 'select', type: 'select', label: 'Select', default: 'impossible', options: [{ id: 'one', label: 'One' }] }],
        },
      },
    ],
  ] as const)('refuses invalid wire input without mutation: %s %j', ([method, input]) =>
    Effect.gen(function* () {
      const call = yield* mountedHost
      expect((yield* decodeErrorResponse(yield* call(method, input))).result.error.code).toBe('contract')
      expect(yield* call('list', {})).toMatchObject({ result: { ok: true, value: { output: { total: 0, resources: [] } } } })
      expect(yield* call('catalog', undefined)).toMatchObject({ result: { ok: true, value: { output: { packs: [{ definition: { id: 'tracking' } }] } } } })
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('returns bounded useful domain errors without echoing submitted values or opaque ids', () =>
    Effect.gen(function* () {
      const call = yield* mountedHost
      const registered = (yield* decodeResourceResponse(
        yield* call('registerResource', { ref: { provider: 'native', kind: 'conversation', id: 'Native/SecretId' }, label: 'Explicit label' }),
      )).result.value.output
      const attached = (yield* decodeResourceResponse(
        yield* call('attach', { resourceId: registered.id, expectedRevision: registered.revision, packId: 'tracking' }),
      )).result.value.output
      const input = { resourceId: registered.id, expectedRevision: attached.revision, packId: 'tracking' }
      const before = yield* call('get', { resourceId: registered.id })
      for (const values of [
        { status: 'secret:DO_NOT_ECHO' },
        { absent: 'secret:DO_NOT_ECHO' },
        { related: { provider: 'native', kind: 'conversation', id: '', payload: 'secret:DO_NOT_ECHO' } },
      ]) {
        const response = yield* call('setValues', { ...input, values })
        const error = (yield* decodeErrorResponse(response)).result.error
        expect(error.code).not.toBe('internal')
        expect(error.message.length).toBeLessThanOrEqual(500)
        expect(JSON.stringify(response)).not.toContain('DO_NOT_ECHO')
        expect(JSON.stringify(response)).not.toContain('Native/SecretId')
        expect(yield* call('get', { resourceId: registered.id })).toEqual(before)
      }
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('computes user ownership for GUI registration and refuses builtin namespace takeover', () =>
    Effect.gen(function* () {
      const call = yield* mountedHost
      const definition = Schema.decodeUnknownSync(packDefinitionSchema)({
        id: 'user-pack',
        version: 1,
        label: 'User pack',
        properties: [{ id: 'note', label: 'Note', type: 'text' }],
      })
      expect(yield* call('registerPack', { definition })).toMatchObject({ result: { ok: true, value: { output: { owner: 'user' } } } })
      expect((yield* decodeErrorResponse(yield* call('registerPack', { definition: { ...definition, id: 'tracking' } }))).result.error.code).toBe(
        'owner-conflict',
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('names the domain failure of every refused write on the wire', () =>
    Effect.gen(function* () {
      const call = yield* mountedHost
      const registered = (yield* decodeResourceResponse(
        yield* call('registerResource', { ref: { provider: 'native', kind: 'file', id: 'Opaque' }, label: 'Codes' }),
      )).result.value.output
      const base = { resourceId: registered.id, expectedRevision: registered.revision, packId: 'tracking' }
      // oxlint-disable-next-line antislop/no-unknown-parameters -- the wire input is the boundary under test.
      const codeOf = (method: string, input: unknown) => Effect.map(Effect.flatMap(call(method, input), decodeErrorResponse), response => response.result.error)
      expect(yield* codeOf('setValues', { ...base, values: { status: 'todo' } })).toMatchObject({
        code: 'pack-not-attached',
        message: 'Attach this pack before setting its properties.',
      })
      expect(yield* codeOf('get', { resourceId: '00000000-0000-4000-8000-000000000000' })).toMatchObject({ code: 'unknown-resource' })
      const attached = (yield* decodeResourceResponse(yield* call('attach', base))).result.value.output
      const current = { ...base, expectedRevision: attached.revision }
      expect(yield* codeOf('setValues', { ...current, values: { status: 'missing-option' } })).toMatchObject({
        code: 'invalid-value',
        message: 'The value does not match the declared select property type or options.',
      })
      expect(yield* codeOf('setValues', { ...current, values: { undeclared: 'x' } })).toMatchObject({ code: 'unknown-property' })
    }).pipe(Effect.provide(platformLayer)),
  )
})

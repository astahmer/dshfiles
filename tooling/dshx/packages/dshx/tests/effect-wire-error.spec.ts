import { describe, expect, it } from '@effect/vitest'
import { Cause, Effect, Schema } from 'effect'
import { defineApi, isApiError, method } from '../src/api/index.js'
import { DshxEffect } from '../src/effect/index.js'
import { thrownForApi, wireFailure } from '../src/effect/wire-error.js'
import { createHostApiClient, defineHost } from '../src/host/index.js'
import { TestHost } from './effect-test-host.js'

class NoteNotFound extends Schema.TaggedError<NoteNotFound>()('NoteNotFound', { id: Schema.String }, { dshxWireCode: 'note-not-found' }) {
  override get message(): string {
    return `No note ${this.id}.`
  }
}

class LegacyMissing extends Schema.TaggedError<LegacyMissing>()('LegacyMissing', { message: Schema.String }) {}

class WarnedOnce extends Schema.TaggedError<WarnedOnce>()('WarnedOnce', { message: Schema.String }) {}

class StorageCorrupt extends Schema.TaggedError<StorageCorrupt>()('StorageCorrupt', { path: Schema.String }) {}

const notesApi = defineApi({
  id: 'wire-notes',
  version: 1,
  owner: '@test/wire-notes',
  methods: {
    exposed: method({ input: Schema.Struct({ id: Schema.String }), output: Schema.String }),
    legacy: method({ input: Schema.Void, output: Schema.String }),
    defect: method({ input: Schema.Void, output: Schema.String }),
    interrupted: method({ input: Schema.Void, output: Schema.String }),
  },
})

const mountNotes = Effect.gen(function* () {
  const host = yield* TestHost
  yield* Effect.promise(() =>
    host.mount(
      defineHost({
        apis: [
          DshxEffect.host(notesApi, {
            exposed: ({ input }) => Effect.fail(new NoteNotFound({ id: input.id })),
            legacy: () => Effect.fail(new LegacyMissing({ message: 'Nothing here.' })),
            defect: () => Schema.decodeUnknownEffect(Schema.Number)('secret-input').pipe(Effect.orDie, Effect.as('unreachable')),
            interrupted: () => Effect.interrupt,
          }),
        ],
      }),
      { packageId: '@test/wire-notes' },
    ),
  )
  return createHostApiClient(host.ctx, notesApi, '@test/caller')
})

const rejection = (call: () => Promise<unknown>) =>
  Effect.flip(
    Effect.tryPromise({ try: call, catch: error => (isApiError(error) ? error : new Error('The call failed without an ApiError.', { cause: error })) }),
  )

describe('Effect failures on the wire', () => {
  it.effect('exposes an annotated failure with its code, message and encoded fields', () =>
    Effect.gen(function* () {
      const notes = yield* mountNotes
      const error = yield* rejection(() => notes.exposed({ id: 'n1' }))
      expect(error).toMatchObject({ kind: 'remote', remoteCode: 'note-not-found', message: 'No note n1.', remoteDetails: { _tag: 'NoteNotFound', id: 'n1' } })
      const decoded = yield* Schema.decodeUnknownEffect(NoteNotFound)(isApiError(error) ? error.remoteDetails : undefined)
      expect(decoded).toBeInstanceOf(NoteNotFound)
      expect(decoded.id).toBe('n1')
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('keeps the kebab-case code of an unannotated tagged failure for compatibility', () =>
    Effect.gen(function* () {
      const notes = yield* mountNotes
      expect(yield* rejection(() => notes.legacy())).toMatchObject({ kind: 'remote', remoteCode: 'legacy-missing', message: 'Nothing here.' })
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('keeps a defect such as a SchemaError internal', () =>
    Effect.gen(function* () {
      const notes = yield* mountNotes
      const error = yield* rejection(() => notes.defect())
      expect(error).toMatchObject({ kind: 'remote', remoteCode: 'internal', message: 'API handler failed. See Host diagnostics.' })
      expect(JSON.stringify(error)).not.toContain('secret-input')
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('reports an interrupted handler as aborted', () =>
    Effect.gen(function* () {
      const notes = yield* mountNotes
      expect(yield* rejection(() => notes.interrupted())).toMatchObject({ kind: 'aborted', remoteCode: 'aborted' })
    }).pipe(Effect.provide(TestHost.layer)),
  )
})

describe('wireFailure', () => {
  it.effect('classifies every cause shape', () =>
    Effect.gen(function* () {
      expect(wireFailure(Cause.interrupt())).toEqual({ kind: 'aborted' })
      expect(wireFailure(Cause.fail(new StorageCorrupt({ path: '/x' })))).toMatchObject({ kind: 'legacy-tagged', tag: 'StorageCorrupt' })
      expect(wireFailure(Cause.fail('plain string'))).toMatchObject({ kind: 'internal' })
      const schemaError = yield* Effect.flip(Schema.decodeUnknownEffect(Schema.Number)('secret-input'))
      const defect = wireFailure(Cause.die(schemaError))
      expect(defect.kind).toBe('internal')
      expect(defect.kind === 'internal' && defect.report).toContain('SchemaError: Expected number')
      expect(wireFailure(Cause.fail(new NoteNotFound({ id: 'a' })))).toMatchObject({
        kind: 'exposed',
        error: { code: 'note-not-found', details: { _tag: 'NoteNotFound', id: 'a' } },
      })
    }),
  )

  it('warns once per unannotated tag and logs nothing for annotated or internal failures', () => {
    const warnings: string[] = []
    const thrown = (cause: Cause.Cause<unknown>) => thrownForApi({ cause, apiId: 'wire', method: 'm', warn: message => warnings.push(message) })
    thrown(Cause.fail(new WarnedOnce({ message: 'a' })))
    thrown(Cause.fail(new WarnedOnce({ message: 'b' })))
    thrown(Cause.fail(new NoteNotFound({ id: 'a' })))
    expect(thrown(Cause.die(new Error('boom')))).toMatchObject({ name: 'EffectHandlerFailure' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("{ dshxWireCode: 'warned-once' }")
  })
})

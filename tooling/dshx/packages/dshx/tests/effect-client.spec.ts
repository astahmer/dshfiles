import { describe, expect, it } from '@effect/vitest'
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema } from 'effect'
import { defineApi, method } from '../src/api/index.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'
import { Api, DshxPlugin } from '../src/effect/index.js'
import { createHostApiClient } from '../src/host/index.js'
import { TestHost } from './effect-test-host.js'

class NoteNotFound extends Schema.TaggedError<NoteNotFound>()('NoteNotFound', { id: Schema.String }, { dshxWireCode: 'note-not-found' }) {
  override get message(): string {
    return `No note ${this.id}.`
  }
}

class NoteLocked extends Schema.TaggedError<NoteLocked>()('NoteLocked', { id: Schema.String }, { dshxWireCode: 'note-locked' }) {}

const notesApi = defineApi({
  id: 'client-notes',
  version: 1,
  owner: '@test/client-notes',
  methods: {
    get: method({ input: Schema.Struct({ id: Schema.String }), output: Schema.String }),
    hang: method({ input: Schema.Void, output: Schema.String }),
    defect: method({ input: Schema.Void, output: Schema.String }),
    cancelled: method({ input: Schema.Void, output: Schema.String }),
  },
})

class Notes extends Context.Service<Notes, { readonly first: string }>()('@dshfiles/dshx/tests/Notes') {
  static readonly layer = Layer.succeed(Notes, Notes.of({ first: 'first' }))
}

const serveNotes = (hanging: Deferred.Deferred<void>, interrupted: Deferred.Deferred<void>) =>
  DshxPlugin.make({
    name: 'test-client-notes',
    layer: Notes.layer,
    apis: [
      Api.bind(notesApi, {
        get: input =>
          input.id === 'locked'
            ? Effect.fail(new NoteLocked({ id: input.id }))
            : input.id === 'a'
              ? Notes.useSync(notes => notes.first)
              : Effect.fail(new NoteNotFound({ id: input.id })),
        hang: () =>
          Deferred.succeed(hanging, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
        defect: () => Effect.die(new Error('boom')),
        cancelled: () => Effect.interrupt,
      }),
    ],
  })

const notesClient = Effect.gen(function* () {
  const host = yield* TestHost
  const hanging = yield* Deferred.make<void>()
  const interrupted = yield* Deferred.make<void>()
  yield* Effect.promise(() => host.mount(serveNotes(hanging, interrupted), { packageId: '@test/client-notes' }))
  const notes = Api.client({ contract: notesApi, api: createHostApiClient(host.ctx, notesApi, '@test/caller'), errors: [NoteNotFound] })
  return { notes, hanging, interrupted }
})

describe('Api.client', () => {
  it.effect('decodes a declared error and keeps other exposed failures as ApiRemoteError', () =>
    Effect.gen(function* () {
      const { notes } = yield* notesClient
      expect(yield* notes.get({ id: 'a' })).toBe('first')
      const missing = yield* Effect.flip(notes.get({ id: 'b' }))
      expect(missing).toBeInstanceOf(NoteNotFound)
      expect(missing).toMatchObject({ _tag: 'NoteNotFound', id: 'b' })
      expect(yield* Effect.flip(notes.get({ id: 'locked' }))).toMatchObject({
        _tag: 'ApiRemoteError',
        code: 'note-locked',
        details: { _tag: 'NoteLocked', id: 'locked' },
      })
      expect(yield* Effect.flip(notes.defect())).toMatchObject({ _tag: 'ApiRemoteError', code: 'internal' })
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('fails with ApiContractError for input the contract rejects', () =>
    Effect.gen(function* () {
      const { notes } = yield* notesClient
      // @ts-expect-error the contract input needs an id
      expect(yield* Effect.flip(notes.get({}))).toMatchObject({ _tag: 'ApiContractError', apiId: 'client-notes', method: 'get' })
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('fails with ApiUnavailableError when the owner is not loaded', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const notes = Api.client({ contract: notesApi, api: createHostApiClient(host.ctx, notesApi, '@test/caller') })
      expect(yield* Effect.flip(notes.get({ id: 'a' }))).toMatchObject({ _tag: 'ApiUnavailableError', ownerMissing: true })
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('aborts the call when the fiber is interrupted and interrupts when the Host reports an abort', () =>
    Effect.gen(function* () {
      const { notes, hanging, interrupted } = yield* notesClient
      const fiber = yield* Effect.forkChild(notes.hang())
      yield* Deferred.await(hanging)
      yield* Fiber.interrupt(fiber)
      yield* Deferred.await(interrupted)
      const cancelled = yield* Effect.exit(notes.cancelled())
      expect(Exit.isFailure(cancelled) && Cause.hasInterruptsOnly(cancelled.cause)).toBe(true)
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('fails with ApiTransportError on a transport failure and dies on a non-ApiError throw', () =>
    Effect.gen(function* () {
      const broken = ApiRuntimeModel.createClient(
        { get: (name: string) => (name === 'connection' ? { rpc: { call: () => Promise.reject(new Error('socket closed')) } } : undefined) },
        notesApi,
        '@test/caller',
      )
      const notes = Api.client({ contract: notesApi, api: broken })
      expect(yield* Effect.flip(notes.get({ id: 'a' }))).toMatchObject({ _tag: 'ApiTransportError', apiId: 'client-notes', method: 'get' })
      const throwing = Api.client({
        contract: notesApi,
        api: { ...broken, get: () => Promise.reject(new TypeError('client bug')) },
      })
      const died = yield* Effect.exit(throwing.get({ id: 'a' }))
      expect(Exit.isFailure(died) && Cause.hasDies(died.cause)).toBe(true)
    }),
  )
})

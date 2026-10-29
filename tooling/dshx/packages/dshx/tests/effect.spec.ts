import { Context as Services, Effect, Exit, Fiber, Layer, ManagedRuntime, Schema, Stream } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineApi, event, method } from '../src/api/index.js'
import { ApiProtocolModel } from '../src/api/common.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'
import { DshxEffect } from '../src/effect/index.js'
import { createHostApiClient, defineHost } from '../src/host/index.js'
import { createTestHost } from '../src/testing/index.js'

class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { message: Schema.String }) {}

class Greeting extends Services.Service<Greeting, { readonly prefix: string }>()('test/Greeting') {}

const notesApi = defineApi({
  id: 'notes',
  version: 1,
  owner: '@test/notes',
  methods: {
    get: method({ input: z.object({ id: z.string() }), output: z.object({ id: z.string(), text: z.string() }) }),
    slow: method<void, string>(),
  },
  events: { changed: event({ schema: z.object({ id: z.string() }) }) },
})

const greetApi = defineApi({ id: 'greet', version: 1, owner: '@test/greet', methods: { hello: method<{ readonly name: string }, string>() } })

describe('@dshfiles/dshx/effect', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves Effect handlers and turns a tagged failure into a remote code the caller can match', async () => {
    const host = await createTestHost()
    await host.mount(
      defineHost({
        apis: [
          DshxEffect.host(notesApi, {
            get: ({ input }) =>
              input.id === 'a' ? Effect.succeed({ id: 'a', text: 'first' }) : Effect.fail(new NotFound({ message: `No note ${input.id}.` })),
            slow: () => Effect.succeed('done'),
          }),
        ],
      }),
      { packageId: '@test/notes' },
    )
    const notes = createHostApiClient(host.ctx, notesApi, '@test/caller')
    await expect(notes.get({ id: 'a' })).resolves.toEqual({ id: 'a', text: 'first' })
    await expect(notes.get({ id: 'b' })).rejects.toMatchObject({ kind: 'remote', remoteCode: 'not-found', message: 'No note b.' })

    const effectNotes = DshxEffect.client(notes)
    expect(await Effect.runPromise(effectNotes.get({ id: 'a' }))).toEqual({ id: 'a', text: 'first' })
    const failure = await Effect.runPromise(Effect.flip(effectNotes.get({ id: 'b' })))
    expect(failure).toMatchObject({ _tag: 'ApiCallError', kind: 'remote', remoteCode: 'not-found', apiId: 'notes', method: 'get' })
    await host.dispose()
  })

  it('interrupts the handler fiber when the call is aborted', async () => {
    const host = await createTestHost()
    const interrupted = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    await host.mount(
      defineHost({
        apis: [
          DshxEffect.host(notesApi, {
            get: () => Effect.fail(new NotFound({ message: 'unused' })),
            slow: () =>
              Effect.sync(() => started.resolve()).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() => Effect.sync(() => interrupted.resolve())),
              ),
          }),
        ],
      }),
      { packageId: '@test/notes' },
    )
    const controller = new AbortController()
    const pending = createHostApiClient(host.ctx, notesApi, '@test/caller').slow(undefined, { signal: controller.signal })
    await started.promise
    controller.abort()
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' })
    await interrupted.promise
    await host.dispose()
  })

  it('provides handler services from a ManagedRuntime', async () => {
    const host = await createTestHost()
    const runtime = ManagedRuntime.make(Layer.succeed(Greeting, { prefix: 'Hello' }))
    await host.mount(
      defineHost({
        apis: [
          DshxEffect.host(
            greetApi,
            {
              hello: ({ input }) =>
                Effect.gen(function* () {
                  const greeting = yield* Greeting
                  return `${greeting.prefix} ${input.name}`
                }),
            },
            { runtime },
          ),
        ],
      }),
      { packageId: '@test/greet' },
    )
    await expect(createHostApiClient(host.ctx, greetApi, '@test/caller').hello({ name: 'Ada' })).resolves.toBe('Hello Ada')
    await runtime.dispose()
    await host.dispose()
  })

  it('fails a client Effect with ApiCallError when the owner is not loaded', async () => {
    const host = await createTestHost()
    const failure = await Effect.runPromise(Effect.flip(DshxEffect.client(createHostApiClient(host.ctx, greetApi, '@test/caller')).hello({ name: 'Ada' })))
    expect(failure).toMatchObject({ _tag: 'ApiCallError', kind: 'unavailable', apiId: 'greet', method: 'hello' })
    await host.dispose()
  })

  it('ties the plugin lifetime to a Scope: release on unload, reacquire on reload', async () => {
    const log: string[] = []
    const host = await createTestHost()
    const plugin = await host.mount(
      defineHost({
        setup: DshxEffect.setup(() =>
          Effect.acquireRelease(
            Effect.sync(() => log.push('acquire')),
            () => Effect.sync(() => log.push('release')),
          ),
        ),
      }),
    )
    expect(log).toEqual(['acquire'])
    await plugin.reload()
    expect(log).toEqual(['acquire', 'release', 'acquire'])
    await plugin.dispose()
    expect(log).toEqual(['acquire', 'release', 'acquire', 'release'])
    await host.dispose()
  })

  it('fails activation and closes the scope when setup fails', async () => {
    const log: string[] = []
    const failing = DshxEffect.setup(() =>
      Effect.acquireRelease(
        Effect.sync(() => log.push('acquire')),
        (_, exit) => Effect.sync(() => log.push(Exit.isFailure(exit) ? 'release after failure' : 'release')),
      ).pipe(Effect.andThen(Effect.fail(new NotFound({ message: 'no config' })))),
    )
    const host = await createTestHost()
    await expect(failing(host.ctx, {})).rejects.toMatchObject({ _tag: 'NotFound' })
    expect(log).toEqual(['acquire', 'release after failure'])
    await host.dispose()
  })

  it('publishes Host events from Effects and reads them in the browser as a Stream', async () => {
    const host = await createTestHost()
    const mounted = await host.mount(defineHost({ apis: [DshxEffect.host(notesApi, { get: () => Effect.die('unused'), slow: () => Effect.succeed('') })] }), {
      packageId: '@test/notes',
    })
    await Effect.runPromise(Stream.runForEach(Stream.make({ id: 'a' }, { id: 'b' }), payload => DshxEffect.publish(mounted.ctx, notesApi, 'changed', payload)))
    // @ts-expect-error the contract declares no such event
    const refused = await Effect.runPromise(Effect.flip(DshxEffect.publish(mounted.ctx, notesApi, 'removed', {})))
    expect(refused).toMatchObject({ _tag: 'PublishEventError', apiId: 'notes', event: 'removed' })
    await host.dispose()

    const sources: { onmessage: ((event: { readonly data: string }) => void) | null; close: () => void; closed: boolean }[] = []
    vi.stubGlobal(
      'EventSource',
      class {
        readyState = 1
        onmessage: ((event: { readonly data: string }) => void) | null = null
        onerror: (() => void) | null = null
        closed = false
        constructor() {
          sources.push(this)
        }
        close() {
          this.closed = true
        }
      },
    )
    const browser = ApiRuntimeModel.createClient({ get: () => ({ rpc: { call: vi.fn() } }) }, notesApi, '@test/viewer')
    const collected = Effect.runFork(Stream.runCollect(Stream.take(DshxEffect.events(browser, 'changed'), 2)))
    await vi.waitFor(() => expect(sources).toHaveLength(1))
    const key = ApiProtocolModel.eventKey('@test/notes', 'notes', 'changed')
    const send = (
      value:
        | { readonly type: 'catalog'; readonly events: readonly string[] }
        | { readonly type: 'event'; readonly key: string; readonly version: number; readonly data: { readonly id: string } },
    ) => sources[0]?.onmessage?.({ data: JSON.stringify(value) })
    send({ type: 'catalog', events: [key] })
    send({ type: 'event', key, version: 1, data: { id: 'a' } })
    send({ type: 'event', key, version: 1, data: { id: 'b' } })
    expect([...(await Effect.runPromise(Fiber.join(collected)))]).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(sources[0]?.closed).toBe(true)
  })
})

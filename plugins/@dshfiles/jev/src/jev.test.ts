import { defineApi } from '@dshfiles/dshx/api'
import { Api, DshxEffect, DshxPlugin } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { HostContext } from '@dshfiles/dshx/effect/host-context'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { type JevUsageRecord, usageApi } from '@dshfiles/usage/api'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Redacted, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { Jev, type JevRequest } from './jev.js'

const jevUsageApi = defineApi({
  id: usageApi.id,
  version: usageApi.version,
  owner: '@dshfiles/usage',
  methods: { recordJevUsage: usageApi.methods.recordJevUsage },
})

const request: JevRequest = {
  question: { name: 'signal', instructions: 'Is it durable?', criteria: { true: 'yes', false: 'no' } },
  text: 'remember: deploys run on Fridays',
  credential: { apiKey: Redacted.make('test-key'), label: 'Other credentials' },
  source: 'memory',
  timeout: '2 seconds',
}

const answer = { model: 'jev-1', answers: { verdict: { type: 'noul', noul: 0.82 } }, usage: { input_tokens: 31, output_tokens: 2 } }

type Sent = { readonly authorization: string | undefined; readonly body: unknown }

const fakeJev = (respond: (sent: Sent) => Effect.Effect<Response>) =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<readonly Sent[]>([])
    const client = HttpClient.make(request =>
      Effect.gen(function* () {
        const body = request.body._tag === 'Uint8Array' ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined
        const entry = { authorization: request.headers['authorization'], body }
        yield* Ref.update(sent, all => [...all, entry])
        return HttpClientResponse.fromWeb(request, yield* respond(entry))
      }),
    )
    return { sent, client }
  })

const usageHost = (served: boolean) =>
  Effect.gen(function* () {
    const records = yield* Ref.make<readonly JevUsageRecord[]>([])
    const host = yield* Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      created => Effect.promise(() => created.dispose()),
    )
    if (served) {
      const recorder = DshxPlugin.make({
        name: '@dshfiles/usage',
        layer: Layer.empty,
        apis: [Api.bind(jevUsageApi, { recordJevUsage: input => Ref.update(records, all => [...all, input]).pipe(Effect.as({ accepted: true as const })) })],
      })
      yield* Effect.promise(() => host.mount(recorder, { packageId: '@dshfiles/usage' }))
    }
    return { records, hostContext: Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/memory' })) }
  })

const askWith = (options: { readonly served: boolean; readonly respond: (sent: Sent) => Effect.Effect<Response> }) =>
  Effect.gen(function* () {
    const usage = yield* usageHost(options.served)
    const fake = yield* fakeJev(options.respond)
    const jev = yield* Effect.provide(
      Jev,
      Jev.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, fake.client)), Layer.provide(HostApis.layer), Layer.provide(usage.hostContext)),
    )
    return { jev, records: usage.records, sent: fake.sent }
  })

const json = (status: number, body: string) => Effect.sync(() => new Response(body, { status, headers: { 'content-type': 'application/json' } }))

describe('Jev', () => {
  it.live('asks one Noul question and records a successful call with its tokens', () =>
    Effect.gen(function* () {
      const { jev, records, sent } = yield* askWith({ served: true, respond: () => json(200, JSON.stringify(answer)) })
      const verdict = yield* jev.ask(request)
      expect(verdict).toMatchObject({ probability: 0.82, inputTokens: 31, outputTokens: 2 })
      const [call] = yield* Ref.get(sent)
      expect(call?.authorization).toBe('Bearer test-key')
      expect(call?.body).toEqual({
        model: 'jev-latest',
        state: { role: 'user', content: request.text },
        questions: { verdict: { type: 'noul', instructions: 'Is it durable?', criteria: { true: 'yes', false: 'no' } } },
      })
      expect(yield* Ref.get(records)).toMatchObject([
        { source: 'memory', credential: 'Other credentials', outcome: 'success', inputTokens: 31, outputTokens: 2 },
      ])
    }).pipe(Effect.scoped),
  )

  it.live('records a jev classify client span with the question and token counts', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const { jev } = yield* askWith({ served: false, respond: () => json(200, JSON.stringify(answer)) })
      yield* jev.ask(request)
      const span = recorder.span('jev classify')
      expect(span.kind).toBe('client')
      expect(span.attributes).toMatchObject({
        'jev.question': 'signal',
        'gen_ai.provider.name': 'typesafe',
        'gen_ai.usage.input_tokens': 31,
        'http.response.status_code': 200,
      })
      expect(JSON.stringify(span.attributes)).not.toContain('test-key')
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )

  it.live('fails with the HTTP status and records a failed call', () =>
    Effect.gen(function* () {
      const { jev, records } = yield* askWith({ served: true, respond: () => json(503, JSON.stringify({ error: 'busy' })) })
      const failure = yield* Effect.flip(jev.ask(request))
      expect(failure).toMatchObject({ _tag: 'JevStatusRejected', status: 503, message: 'Jev answered HTTP 503.' })
      expect(yield* Ref.get(records)).toMatchObject([{ outcome: 'failure', inputTokens: null, outputTokens: null }])
    }).pipe(Effect.scoped),
  )

  it.live('refuses an answer outside the Noul schema', () =>
    Effect.gen(function* () {
      const { jev } = yield* askWith({ served: true, respond: () => json(200, JSON.stringify({ answers: { verdict: { type: 'noul', noul: 2 } } })) })
      const failure = yield* Effect.flip(jev.ask(request))
      expect(failure._tag).toBe('JevAnswerInvalid')
    }).pipe(Effect.scoped),
  )

  it.effect('times out a call that never answers', () =>
    Effect.gen(function* () {
      const { jev, records } = yield* askWith({ served: true, respond: () => Effect.never })
      const fiber = yield* Effect.forkChild(Effect.flip(jev.ask(request)))
      yield* TestClock.adjust('2 seconds')
      const failure = yield* Fiber.join(fiber)
      expect(failure).toMatchObject({ _tag: 'JevTimedOut', timeoutMs: 2_000 })
      expect(yield* Ref.get(records)).toMatchObject([{ outcome: 'failure', durationMs: 2_000 }])
    }).pipe(Effect.scoped),
  )

  it.live('answers even when no plugin records usage', () =>
    Effect.gen(function* () {
      const { jev } = yield* askWith({ served: false, respond: () => json(200, JSON.stringify(answer)) })
      expect((yield* jev.ask(request)).probability).toBe(0.82)
    }).pipe(Effect.scoped),
  )
})

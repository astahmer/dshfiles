import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { defineApi, method } from '../src/api/index.js'
import { DshxEffect } from '../src/effect/index.js'
import { createHostApiClient, defineHost } from '../src/host/index.js'
import { recordSpans } from '../src/tracing/index.js'
import { TestHost } from './effect-test-host.js'

const pingApi = defineApi({
  id: 'span-ping',
  version: 1,
  owner: '@test/span-ping',
  methods: { ping: method({ input: Schema.Struct({ name: Schema.String }), output: Schema.String }) },
})

describe('Effect API handler spans', () => {
  it.effect('records one server span per call and parents handler work under it', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans.stop()),
      )
      yield* Effect.promise(() =>
        host.mount(
          defineHost({ apis: [DshxEffect.host(pingApi, { ping: ({ input }) => Effect.succeed(`pong ${input.name}`).pipe(Effect.withSpan('ping reply')) })] }),
          { packageId: '@test/span-ping' },
        ),
      )
      expect(yield* Effect.promise(() => createHostApiClient(host.ctx, pingApi, '@test/caller').ping({ name: 'a' }))).toBe('pong a')
      const server = recorder.span('span-ping/ping')
      expect(recorder.named('span-ping/ping')).toHaveLength(1)
      expect(recorder.spans.filter(span => span.name.startsWith('dshx-effect'))).toEqual([])
      expect(recorder.children(server)).toContain(recorder.span('ping reply'))
    }).pipe(Effect.provide(TestHost.layer)),
  )
})

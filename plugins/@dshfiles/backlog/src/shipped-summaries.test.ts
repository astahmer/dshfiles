import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Jev } from '@dshfiles/jev'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { AiActivity } from './ai-activity.js'
import { ShippedSummaryUnconfigured } from './errors.js'
import type { BacklogSettings } from './settings.js'
import { ShippedSummaries } from './shipped-summaries.js'
import { BacklogStore } from './store.js'
import { backlogStoreLayer } from './test-support.js'
import { Triage } from './triage-service.js'

const user = { kind: 'user' } as const
const agent = { kind: 'agent', sessionId: 'session-shipped' } as const
const DAY = 86_400_000

const summariesLayer = (input: { readonly settings: Partial<BacklogSettings>; readonly calls: string[] }) =>
  ShippedSummaries.layer.pipe(
    Layer.provideMerge(Triage.layer),
    Layer.provideMerge(backlogStoreLayer({ settings: input.settings })),
    Layer.provideMerge(AiActivity.layer),
    Layer.provideMerge(Layer.succeed(Jev, Jev.of({ ask: () => Effect.die('unused') }))),
    Layer.provideMerge(
      Layer.succeed(
        Llm,
        Llm.of({
          complete: (request: { readonly provider: string; readonly model: string; readonly input: string }) =>
            Effect.sync(() => {
              input.calls.push(request.input)
              return `  Shipped ${String(input.calls.length)}: ${request.provider}/${request.model}  `
            }),
        } as never),
      ),
    ),
    Layer.provideMerge(
      Layer.succeed(SecretReferenceResolver, SecretReferenceResolver.of({ resolve: () => Effect.succeedNone, resolveWithLabel: () => Effect.succeedNone })),
    ),
  )

describe('shipped summaries', () => {
  it.effect('generates with the triage model, caches per bucket, marks a changed bucket stale and regenerates on request, in one span each', () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans.stop()),
      )
      yield* TestClock.setTime(10 * DAY + 3_600_000)
      const store = yield* BacklogStore
      const summaries = yield* ShippedSummaries
      const first = yield* store.capture({ text: 'Ship the digest', project: '/repo/app', actor: user })
      const second = yield* store.capture({ text: 'Agent fix', project: '/repo/app', actor: agent })
      yield* store.update({ id: first.item.id, status: 'done', actor: user })
      yield* store.update({ id: second.item.id, status: 'done', actor: agent })

      const digest = yield* summaries.digest({ period: 'day', count: 2 })
      const today = digest.buckets[0]
      expect(today).toMatchObject({ count: 2, previousCount: 0, summary: null })
      expect(today?.projects[0]?.items.map(item => item.byAgent).sort()).toEqual([false, true])
      const bucket = { period: 'day' as const, start: today?.start ?? 0, end: today?.end ?? 0 }

      const generated = yield* summaries.summarize(bucket)
      expect(generated).toMatchObject({ text: 'Shipped 1: deepseek/flash', cached: false, stale: false, provider: 'deepseek', model: 'flash' })
      expect(calls[0]).toContain(`b:${first.item.ref ?? ''} [task] Ship the digest`)
      expect(yield* summaries.summarize(bucket)).toMatchObject({ text: 'Shipped 1: deepseek/flash', cached: true })
      expect(calls).toHaveLength(1)
      expect((yield* summaries.digest({ period: 'day', count: 2 })).buckets[0]?.summary).toMatchObject({ text: 'Shipped 1: deepseek/flash', stale: false })
      expect((yield* summaries.digest({ period: 'day', count: 2, projects: ['/repo/app'] })).buckets[0]?.summary).toBeNull()

      yield* store.update({ id: first.item.id, title: 'Ship the shipped digest', actor: user })
      expect((yield* summaries.digest({ period: 'day', count: 2 })).buckets[0]?.summary?.stale).toBe(true)
      expect(yield* summaries.summarize(bucket)).toMatchObject({ text: 'Shipped 2: deepseek/flash', cached: false })
      expect(yield* summaries.summarize({ ...bucket, regenerate: true })).toMatchObject({ text: 'Shipped 3: deepseek/flash', cached: false })
      expect(calls).toHaveLength(3)

      const span = recorder.span('backlog shipped summary')
      expect(span.attributes).toMatchObject({ 'dshx.backlog.shipped.period': 'day', 'dshx.backlog.shipped.items': 2 })
    }).pipe(
      Effect.provide(summariesLayer({ settings: { triageProvider: 'deepseek', triageModel: 'flash', autoTriage: false }, calls })),
      Effect.scoped,
      Effect.provide(DshxEffect.tracerLayer),
    )
  })

  it.effect('asks for a triage model when none is set, and refuses an empty period', () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      yield* TestClock.setTime(10 * DAY)
      const store = yield* BacklogStore
      const summaries = yield* ShippedSummaries
      const created = yield* store.capture({ text: 'Done thing', actor: user })
      yield* store.update({ id: created.item.id, status: 'done', actor: user })
      const unconfigured = yield* Effect.flip(summaries.summarize({ period: 'day', start: 10 * DAY, end: 11 * DAY }))
      expect(unconfigured instanceof ShippedSummaryUnconfigured && unconfigured.message).toContain('Backlog settings › Triage')
      const empty = yield* Effect.flip(summaries.summarize({ period: 'day', start: 8 * DAY, end: 9 * DAY }))
      expect(empty).toMatchObject({ _tag: 'ShippedSummaryEmpty' })
      expect(calls).toHaveLength(0)
    }).pipe(Effect.provide(summariesLayer({ settings: { autoTriage: false }, calls })), Effect.scoped)
  })
})

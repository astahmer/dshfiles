import type { StoredEntry } from '@dshfiles/dshx/api'
import type { JsonValue } from '@dshfiles/dshx/json'
import { PluginStorage } from '@dshfiles/dshx/effect/plugin-storage'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Layer, Option, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import type { ScheduledSend } from './scheduled-send-api.js'
import { ScheduledSendStore } from './scheduled-send-store.js'
import { RETRY_DELAY_MS, ScheduledSendDelivery, ScheduledSends, type DeliveryOutcome } from './scheduled-sends.js'

/** Plugin storage over one Map: a second layer over the same Map is a Host that restarted. */
const memoryStorage = (entries: Map<string, JsonValue>) =>
  PluginStorage.of({
    namespace: 'test',
    get: key => Effect.sync(() => Option.map(Option.fromNullishOr(entries.get(key)), (value): StoredEntry => ({ key, value, updatedAt: 0 }))),
    set: (key, value) =>
      Effect.sync(() => {
        entries.set(key, value)
        return { key, value, updatedAt: 0 }
      }),
    delete: key => Effect.sync(() => entries.delete(key)),
    list: () => Effect.die('unused'),
    listAll: input =>
      Effect.sync(() => [...entries].filter(([key]) => key.startsWith(input?.prefix ?? '')).map(([key, value]) => ({ key, value, updatedAt: 0 }))),
    changes: () => Stream.empty,
  })

/** A thread as the session controller presents it: a prompt carrying a request id it already holds is not added again. */
const thread = () => {
  const messages: { readonly text: string; readonly requestId: string; readonly model: string | undefined }[] = []
  const state = { model: 'model-a', queueBusy: false, crashAfterSend: false }
  const deliver = (send: ScheduledSend): Effect.Effect<DeliveryOutcome> =>
    Effect.gen(function* () {
      if (send.model !== undefined && send.model.model !== state.model) {
        if (state.queueBusy) return { kind: 'wait', note: 'busy queue' }
        state.model = send.model.model
      }
      if (!messages.some(message => message.requestId === send.requestId)) messages.push({ text: send.text, requestId: send.requestId, model: state.model })
      if (state.crashAfterSend) return yield* Effect.die('Host stopped before the send was settled')
      return { kind: 'sent' }
    })
  return { messages, state, delivery: ScheduledSendDelivery.of({ deliver }) }
}

const run = <A, E>(
  input: { readonly entries: Map<string, JsonValue>; readonly delivery: ScheduledSendDelivery['Service'] },
  effect: Effect.Effect<A, E, ScheduledSends>,
) =>
  effect.pipe(
    Effect.provide(
      ScheduledSends.layer.pipe(
        Layer.provide(ScheduledSendStore.layerWithoutStorage),
        Layer.provide(Layer.succeed(PluginStorage, memoryStorage(input.entries))),
        Layer.provide(Layer.succeed(ScheduledSendDelivery, input.delivery)),
      ),
    ),
  )

const HOUR = 60 * 60 * 1000

describe('ScheduledSends', () => {
  it.effect('sends a scheduled message once at its time, and only then', () =>
    Effect.gen(function* () {
      const entries = new Map<string, JsonValue>()
      const target = thread()
      yield* TestClock.setTime(1_000_000)
      const sends = yield* run({ entries, delivery: target.delivery }, ScheduledSends.use(Effect.succeed))

      const refused = yield* Effect.exit(sends.create({ sessionId: 's1', text: 'too late', sendAt: 999_000 }))
      expect(Exit.isFailure(refused)).toBe(true)

      const send = yield* sends.create({ sessionId: 's1', text: 'Check the deploy', sendAt: 1_000_000 + HOUR })
      yield* sends.tick(1_000_000 + HOUR - 1)
      expect(target.messages).toEqual([])

      yield* sends.tick(1_000_000 + HOUR)
      yield* sends.tick(1_000_000 + HOUR + 1)
      expect(target.messages.map(message => message.text)).toEqual(['Check the deploy'])
      expect(target.messages[0]?.requestId).toBe(send.requestId)
      expect((yield* sends.list({})).sends).toEqual([])
    }),
  )

  it.effect('keeps a send across a Host restart and delivers it exactly once after a crash mid-send', () =>
    Effect.gen(function* () {
      const entries = new Map<string, JsonValue>()
      const target = thread()
      yield* TestClock.setTime(1_000_000)
      const before = yield* run({ entries, delivery: target.delivery }, ScheduledSends.use(Effect.succeed))
      yield* before.create({ sessionId: 's1', text: 'Morning summary', sendAt: 1_000_000 + HOUR })

      target.state.crashAfterSend = true
      const crashed = yield* Effect.exit(before.tick(1_000_000 + HOUR))
      expect(Exit.isFailure(crashed)).toBe(true)
      expect(target.messages).toHaveLength(1)

      target.state.crashAfterSend = false
      const restarted = yield* run({ entries, delivery: target.delivery }, ScheduledSends.use(Effect.succeed))
      expect((yield* restarted.list({ sessionId: 's1' })).sends.map(send => send.status)).toEqual(['sending'])
      yield* restarted.tick(1_000_000 + HOUR + 5)
      expect(target.messages.map(message => message.text)).toEqual(['Morning summary'])
      expect((yield* restarted.list({})).sends).toEqual([])
    }),
  )

  it.effect('edits the time, text, model and effort, waits for a busy queue before switching model, and cancels', () =>
    Effect.gen(function* () {
      const entries = new Map<string, JsonValue>()
      const target = thread()
      yield* TestClock.setTime(1_000_000)
      const sends = yield* run({ entries, delivery: target.delivery }, ScheduledSends.use(Effect.succeed))
      const first = yield* sends.create({ sessionId: 's1', text: 'Draft v1', sendAt: 1_000_000 + HOUR })
      const edited = yield* sends.update({
        id: first.id,
        text: 'Draft v2',
        sendAt: 1_000_000 + 2 * HOUR,
        model: { provider: 'p', model: 'model-b', reasoningEffort: 'high' },
      })
      expect(edited).toMatchObject({
        text: 'Draft v2',
        sendAt: 1_000_000 + 2 * HOUR,
        model: { model: 'model-b', reasoningEffort: 'high' },
        requestId: first.requestId,
      })

      target.state.queueBusy = true
      yield* sends.tick(1_000_000 + 2 * HOUR)
      const waiting = (yield* sends.list({})).sends[0]
      expect(waiting).toMatchObject({ status: 'scheduled', note: 'busy queue', retryAt: 1_000_000 + 2 * HOUR + RETRY_DELAY_MS })
      expect(target.messages).toEqual([])

      target.state.queueBusy = false
      yield* sends.tick(1_000_000 + 2 * HOUR + RETRY_DELAY_MS)
      expect(target.messages).toEqual([{ text: 'Draft v2', requestId: first.requestId, model: 'model-b' }])

      const second = yield* sends.create({ sessionId: 's1', text: 'Never mind', sendAt: 1_000_000 + 3 * HOUR })
      const cancelled = yield* sends.cancel({ id: second.id })
      expect(cancelled.text).toBe('Never mind')
      yield* sends.tick(1_000_000 + 4 * HOUR)
      expect(target.messages).toHaveLength(1)
      expect(Exit.isFailure(yield* Effect.exit(sends.cancel({ id: second.id })))).toBe(true)
    }),
  )

  it.effect('sends now on request, and turns a send that cannot be delivered into a failed row the user can edit', () =>
    Effect.gen(function* () {
      const entries = new Map<string, JsonValue>()
      const messages: string[] = []
      const delivery = ScheduledSendDelivery.of({
        deliver: send =>
          send.sessionId === 'archived'
            ? Effect.succeed({ kind: 'failed', note: 'thread archived', retryable: false })
            : Effect.sync(() => {
                messages.push(send.text)
                return { kind: 'sent' }
              }),
      })
      yield* TestClock.setTime(1_000_000)
      const sends = yield* run({ entries, delivery }, ScheduledSends.use(Effect.succeed))
      const later = yield* sends.create({ sessionId: 's1', text: 'Right away', sendAt: 1_000_000 + HOUR })
      yield* sends.sendNow({ id: later.id })
      yield* sends.tick(1_000_000)
      expect(messages).toEqual(['Right away'])

      const lost = yield* sends.create({ sessionId: 'archived', text: 'Into the void', sendAt: 1_000_000 + HOUR })
      yield* sends.tick(1_000_000 + HOUR)
      expect((yield* sends.list({})).sends).toMatchObject([{ id: lost.id, status: 'failed', note: 'thread archived' }])
      yield* sends.tick(1_000_000 + 2 * HOUR)
      const rescheduled = yield* sends.update({ id: lost.id, sendAt: 1_000_000 + 3 * HOUR })
      expect(rescheduled).toMatchObject({ status: 'scheduled', attempts: 0 })
      expect(rescheduled.note).toBeUndefined()
    }),
  )
})

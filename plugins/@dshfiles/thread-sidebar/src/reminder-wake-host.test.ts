import { DshxEffect } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { ScheduleId } from '@deepseek-ai/dsh-schedule'
import { Effect, Layer, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import type { ScannedReminder } from './reminder-wake.js'
import { REMINDER_WAKE_BOOT_DELAY, REMINDER_WAKE_INTERVAL, ReminderWake, ReminderWakeSources } from './reminder-wake-host.js'
import { threadSidebarSettings } from './settings.js'
import { SidebarSettings, type SidebarSettingsValue } from './sidebar-settings.js'

const MINUTE = 60_000
const BOOT = 1_000_000_000

const settingsValue = (overrides: Partial<SidebarSettingsValue> = {}): SidebarSettingsValue => ({ ...threadSidebarSettings.schema({}), ...overrides })

interface WakeHost {
  readonly calls: Ref.Ref<ReadonlyArray<string>>
  readonly reminders: Ref.Ref<ReadonlyArray<ScannedReminder>>
  readonly settled: Ref.Ref<ReadonlySet<string>>
  readonly archived: Ref.Ref<ReadonlySet<string>>
}

/** The Host a wake pass reads and writes: in-memory reminders, statuses and one call log. */
const fakeSources = (host: WakeHost) =>
  Layer.effect(
    ReminderWakeSources,
    Effect.sync(() =>
      ReminderWakeSources.of({
        snapshot: Effect.gen(function* () {
          return {
            reminders: yield* Ref.get(host.reminders),
            settledSessionIds: yield* Ref.get(host.settled),
            archivedSessionIds: yield* Ref.get(host.archived),
          }
        }),
        unsettle: sessionIds => Ref.update(host.calls, calls => [...calls, ...sessionIds.map(sessionId => `unsettle ${sessionId}`)]),
        restore: sessionIds => Ref.update(host.calls, calls => [...calls, ...sessionIds.map(sessionId => `restore ${sessionId}`)]),
        deliver: reminders => Ref.update(host.calls, calls => [...calls, ...reminders.map(reminder => `deliver ${reminder.id}`)]),
      }),
    ),
  )

const withWake = <A, E>(
  input: { readonly settings?: Partial<SidebarSettingsValue>; readonly reminders: readonly ScannedReminder[]; readonly scheduled?: boolean },
  body: (host: WakeHost) => Effect.Effect<A, E, ReminderWake | SidebarSettings | Settings.SettingsOf<SidebarSettingsValue>>,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(BOOT)
    const host: WakeHost = {
      calls: yield* Ref.make<ReadonlyArray<string>>([]),
      reminders: yield* Ref.make(input.reminders),
      settled: yield* Ref.make<ReadonlySet<string>>(new Set()),
      archived: yield* Ref.make<ReadonlySet<string>>(new Set()),
    }
    const service = ReminderWake.layer.pipe(Layer.provideMerge(fakeSources(host)))
    const withLoop = input.scheduled === true ? ReminderWake.schedule().pipe(Layer.provideMerge(service)) : service
    const layer = withLoop.pipe(
      Layer.provideMerge(SidebarSettings.layer),
      Layer.provideMerge(Settings.layerTest<SidebarSettingsValue>('thread-sidebar', settingsValue(input.settings))),
    )
    return yield* body(host).pipe(Effect.provide(layer))
  })

const calls = (host: WakeHost) => Ref.get(host.calls)

describe('ReminderWake', () => {
  it.effect('wakes a settled thread whose reminder is due, then waits one interval', () =>
    withWake({ reminders: [{ id: ScheduleId('task-1'), sessionId: 'a', scheduledAt: BOOT, active: true }], scheduled: true }, host =>
      Effect.gen(function* () {
        yield* Ref.set(host.settled, new Set(['a']))
        yield* Effect.yieldNow
        yield* TestClock.adjust(REMINDER_WAKE_BOOT_DELAY)
        expect(yield* calls(host)).toEqual(['unsettle a', 'deliver task-1'])

        yield* TestClock.adjust(REMINDER_WAKE_INTERVAL)
        expect(yield* calls(host)).toEqual(['unsettle a', 'deliver task-1', 'unsettle a', 'deliver task-1'])
      }),
    ),
  )

  it.effect('restores an archived thread whose reminder already passed and runs it again', () =>
    withWake({ reminders: [{ id: ScheduleId('task-1'), sessionId: 'a', scheduledAt: BOOT - MINUTE, active: true }] }, host =>
      Effect.gen(function* () {
        yield* Ref.set(host.archived, new Set(['a']))
        yield* ReminderWake.use(wake => wake.wake)
        expect(yield* calls(host)).toEqual(['restore a', 'deliver task-1'])
      }),
    ),
  )

  it.effect('leaves a thread alone while its reminder is beyond the wake window', () =>
    withWake({ reminders: [{ id: ScheduleId('task-1'), sessionId: 'a', scheduledAt: BOOT + 2 * MINUTE, active: true }] }, host =>
      Effect.gen(function* () {
        yield* Ref.set(host.settled, new Set(['a']))
        yield* Ref.set(host.archived, new Set(['a']))
        yield* ReminderWake.use(wake => wake.wake)
        expect(yield* calls(host)).toEqual([])
      }),
    ),
  )

  it.effect('does nothing while the reminder wake is switched off', () =>
    withWake({ settings: { remindersWakeEnabled: false }, reminders: [{ id: ScheduleId('task-1'), sessionId: 'a', scheduledAt: BOOT, active: true }] }, host =>
      Effect.gen(function* () {
        yield* Ref.set(host.settled, new Set(['a']))
        yield* Ref.set(host.archived, new Set(['a']))
        yield* ReminderWake.use(wake => wake.wake)
        expect(yield* calls(host)).toEqual([])
      }),
    ),
  )

  it.effect('records one reminder wake span with the lifted counts', () =>
    withWake({ reminders: [{ id: ScheduleId('task-1'), sessionId: 'a', scheduledAt: BOOT - MINUTE, active: true }] }, host =>
      Effect.gen(function* () {
        yield* Ref.set(host.archived, new Set(['a']))
        using recorder = recordSpans()
        yield* ReminderWake.use(wake => wake.wake).pipe(Effect.provide(DshxEffect.tracerLayer))
        const spans = recorder.spans.filter(span => span.name === 'reminder wake')
        expect(spans).toHaveLength(1)
        expect(spans[0]?.attributes).toMatchObject({
          'thread_sidebar.reminders.unsettled': 0,
          'thread_sidebar.reminders.restored': 1,
          'thread_sidebar.reminders.delivered': 1,
        })
      }),
    ),
  )
})

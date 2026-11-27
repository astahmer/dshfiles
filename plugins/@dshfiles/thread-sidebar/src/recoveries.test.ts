import { Settings } from '@dshfiles/dshx/effect/settings'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { Recoveries } from './recoveries.js'
import { RecoveryStore } from './restart-recovery.js'
import { threadSidebarSettings } from './settings.js'
import { fakeSidebarHost, makeFakeHost, type FakeHost } from './sidebar-host.test-support.js'
import { SidebarSettings, type SidebarSettingsValue } from './sidebar-settings.js'
import { temporaryStateFiles } from './state-files.test-support.js'

const BOOT = 1_700_000_000_000

const stored = (overrides: Partial<SidebarSettingsValue>): SidebarSettingsValue => ({ ...threadSidebarSettings.schema({}), ...overrides })

/** Recoveries over a real recovery store, a fake Host and in-memory sidebar settings. */
const withRecoveries = <A, E>(
  input: { readonly settings?: Partial<SidebarSettingsValue>; readonly archived?: readonly string[]; readonly interrupted?: readonly string[] },
  body: (host: FakeHost) => Effect.Effect<A, E, Recoveries | RecoveryStore | SidebarSettings>,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(BOOT)
    const fake = yield* makeFakeHost
    yield* Ref.set(fake.archived, input.archived ?? [])
    const layer = Recoveries.layer.pipe(
      Layer.provideMerge(RecoveryStore.layer),
      Layer.provideMerge(
        Layer.mergeAll(
          fakeSidebarHost(fake),
          SidebarSettings.layer.pipe(Layer.provide(Settings.layerTest<SidebarSettingsValue>('thread-sidebar', stored(input.settings ?? {})))),
        ),
      ),
    )
    return yield* Effect.gen(function* () {
      const store = yield* RecoveryStore
      yield* store.record({ sessionIds: input.interrupted ?? ['interrupted-thread'], reason: 'interrupted' })
      return yield* body(fake)
    }).pipe(Effect.provide(layer))
  }).pipe(Effect.provide(temporaryStateFiles))

const settledIds = SidebarSettings.use(settings => settings.settledSessionIds)

describe('recoveries resume', () => {
  it.effect('unsettles the thread it resumes, so the continuation step is not rejected', () =>
    withRecoveries({ settings: { settledSessionIds: ['interrupted-thread'], settledAt: { 'interrupted-thread': 1 } } }, fake =>
      Effect.gen(function* () {
        expect(yield* Recoveries.use(recoveries => recoveries.resume('interrupted-thread'))).toBe(true)
        expect(yield* settledIds).toEqual([])
        expect(yield* Ref.get(fake.prompts)).toHaveLength(1)
      }),
    ),
  )

  it.effect('restores an archived thread before it resends the continuation', () =>
    withRecoveries({ archived: ['interrupted-thread'] }, fake =>
      Effect.gen(function* () {
        yield* Recoveries.use(recoveries => recoveries.resume('interrupted-thread'))
        expect(yield* Ref.get(fake.unarchived)).toEqual(['interrupted-thread'])
        expect(yield* Ref.get(fake.archived)).toEqual([])
        expect(yield* Ref.get(fake.prompts)).toHaveLength(1)
      }),
    ),
  )

  it.effect('leaves the status alone and queues nothing for a thread no longer waiting', () =>
    withRecoveries({ settings: { settledSessionIds: ['gone'], settledAt: { gone: 1 } } }, fake =>
      Effect.gen(function* () {
        expect(yield* Recoveries.use(recoveries => recoveries.resume('gone'))).toBe(false)
        expect(yield* settledIds).toEqual(['gone'])
        expect(yield* Ref.get(fake.prompts)).toEqual([])
        expect(yield* Ref.get(fake.unarchived)).toEqual([])
      }),
    ),
  )
})

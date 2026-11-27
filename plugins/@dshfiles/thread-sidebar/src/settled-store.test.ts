import { NodeServices } from '@effect/platform-node'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, FileSystem, Layer, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { threadSidebarSettings } from './settings.js'
import { SettledStore } from './settled-store.js'
import { SidebarSettings, ThreadSidebarSettings, type SidebarSettingsValue } from './sidebar-settings.js'
import { jsonStorageDomain } from './storage.test-support.js'

const defaults = (): SidebarSettingsValue => threadSidebarSettings.schema({})

const temporaryRoot = Effect.flatMap(FileSystem.FileSystem, fs => fs.makeTempDirectoryScoped({ prefix: 'settled-store-' })).pipe(
  Effect.provide(NodeServices.layer),
)

class Faults extends Context.Service<Faults, { readonly failUpdates: Ref.Ref<boolean>; readonly updates: Ref.Ref<number> }>()('test/SettledFaults') {
  static readonly layer = Layer.effect(Faults, Effect.all({ failUpdates: Ref.make(false), updates: Ref.make(0) }))
}

/** In-memory settings with revision checks whose writes can all fail, as a Host stopping between the two migration steps. */
const settingsWithFaults = (initial: SidebarSettingsValue) =>
  Layer.effect(
    ThreadSidebarSettings,
    Effect.gen(function* () {
      const real = yield* ThreadSidebarSettings
      const faults = yield* Faults
      return ThreadSidebarSettings.of({
        ...real,
        update: (patch, expectedRevision) =>
          Effect.gen(function* () {
            yield* Ref.update(faults.updates, count => count + 1)
            if (yield* Ref.get(faults.failUpdates))
              return yield* new Settings.SettingsWriteFailed({ namespace: 'thread-sidebar', operation: 'update', cause: new Error('Host stopped') })
            return yield* real.update(patch, expectedRevision)
          }),
      })
    }),
  ).pipe(Layer.provide(Settings.layerTest<SidebarSettingsValue>('thread-sidebar', initial)), Layer.provideMerge(Faults.layer))

/** One Host start: the sidebar settings service (and its settled store) over a durable root and a settings value. */
const hostStart = (root: string, settings: SidebarSettingsValue, options: { readonly failUpdates?: boolean } = {}) =>
  SidebarSettings.layer.pipe(
    Layer.provideMerge(
      Layer.effectDiscard(Effect.flatMap(Faults, faults => Ref.set(faults.failUpdates, options.failUpdates === true))).pipe(
        Layer.provideMerge(settingsWithFaults(settings)),
      ),
    ),
    Layer.provideMerge(jsonStorageDomain(root)),
  )

const legacy = (): SidebarSettingsValue => ({
  ...defaults(),
  settledSessionIds: ['session-c', 'session-a', 'session-b'],
  settledAt: { 'session-c': 3_000, 'session-a': 1_000 },
  parkedSessionIds: ['session-p'],
})

/** Poll on real timers: the JSON backend and the background migration settle outside the test clock. */
const waitUntil = <E, R>(done: Effect.Effect<boolean, E, R>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (yield* done) return
      yield* Effect.promise(() => new Promise(resolve => setTimeout(resolve, 10)))
    }
    throw new Error('condition not reached in 3 s')
  })

const settingsWrites = Effect.flatMap(Faults, faults => Ref.get(faults.updates))

const readBoth = Effect.gen(function* () {
  const store = yield* SettledStore
  const settings = yield* ThreadSidebarSettings
  const value = yield* settings.get
  const snapshot = yield* store.snapshot
  return { settledSessionIds: snapshot.settledSessionIds, settledAt: snapshot.settledAt, settingsIds: value.settledSessionIds, settingsAt: value.settledAt, value }
})

describe('SettledStore', () => {
  it.effect('moves the settled ids out of Settings, in order and with their instants, and keeps them across a restart', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      const first = yield* Effect.gen(function* () {
        // The ids are settled from the first read on, before the background move has written them.
        expect((yield* SidebarSettings).settledSessionIdsNow()).toEqual(['session-c', 'session-a', 'session-b'])
        yield* waitUntil(Effect.map(readBoth, read => read.settingsIds.length === 0))
        return yield* readBoth
      }).pipe(Effect.provide(hostStart(root, legacy())))
      expect(first.settledSessionIds).toEqual(['session-c', 'session-a', 'session-b'])
      expect(first.settledAt).toEqual({ 'session-c': 3_000, 'session-a': 1_000 })
      expect(first.settingsIds).toEqual([])
      expect(first.settingsAt).toEqual({})
      // Unrelated fields stay where they were.
      expect(first.value.parkedSessionIds).toEqual(['session-p'])

      const restarted = yield* readBoth.pipe(Effect.provide(hostStart(root, first.value)))
      expect(restarted.settledSessionIds).toEqual(['session-c', 'session-a', 'session-b'])
      expect(restarted.settledAt).toEqual({ 'session-c': 3_000, 'session-a': 1_000 })
    }),
  )

  it.effect('reruns an interrupted migration without losing or doubling an id', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      // The Host stops after the records were written, before the fields were cleared.
      const interrupted = yield* Effect.gen(function* () {
        yield* waitUntil(Effect.map(settingsWrites, count => count >= 1))
        return yield* readBoth
      }).pipe(Effect.provide(hostStart(root, legacy(), { failUpdates: true })))
      expect(interrupted.settledSessionIds).toEqual(['session-c', 'session-a', 'session-b'])
      expect(interrupted.settingsIds).toEqual(['session-c', 'session-a', 'session-b'])

      const rerun = yield* Effect.gen(function* () {
        yield* waitUntil(Effect.map(readBoth, read => read.settingsIds.length === 0))
        return yield* readBoth
      }).pipe(Effect.provide(hostStart(root, interrupted.value)))
      expect(rerun.settledSessionIds).toEqual(['session-c', 'session-a', 'session-b'])
      expect(rerun.settledAt).toEqual({ 'session-c': 3_000, 'session-a': 1_000 })
      expect(rerun.settingsIds).toEqual([])
      expect(rerun.settingsAt).toEqual({})
    }),
  )

  it.effect('never settles again a thread unsettled while its legacy copy is still being moved', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      const after = yield* Effect.gen(function* () {
        yield* (yield* SidebarSettings).unsettle(['session-a'])
        yield* waitUntil(Effect.map(readBoth, read => read.settingsIds.length === 0))
        return yield* readBoth
      }).pipe(Effect.provide(hostStart(root, legacy())))
      expect(after.settledSessionIds).toEqual(['session-c', 'session-b'])
      const restarted = yield* readBoth.pipe(Effect.provide(hostStart(root, after.value)))
      expect(restarted.settledSessionIds).toEqual(['session-c', 'session-b'])
    }),
  )

  it.effect('writes nothing to Settings on a Host without legacy settled ids', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      const updates = yield* Effect.gen(function* () {
        yield* (yield* SettledStore).migrate
        yield* Effect.promise(() => new Promise(resolve => setTimeout(resolve, 50)))
        return yield* settingsWrites
      }).pipe(Effect.provide(hostStart(root, defaults())))
      expect(updates).toBe(0)
    }),
  )

  it.effect('moves ids an older page writes to Settings after the migration', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      const after = yield* Effect.gen(function* () {
        const settings = yield* ThreadSidebarSettings
        yield* settings.update({ settledSessionIds: ['session-old'], settledAt: { 'session-old': 9_000 } })
        // The worker that follows settings changes runs the migration again.
        yield* waitUntil(Effect.map(settings.get, value => value.settledSessionIds.length === 0))
        return yield* readBoth
      }).pipe(Effect.provide(hostStart(root, defaults())))
      expect(after.settledSessionIds).toEqual(['session-old'])
      expect(after.settledAt).toEqual({ 'session-old': 9_000 })
      expect(after.settingsIds).toEqual([])
    }),
  )

  it.effect('keeps per-thread state out of the settings namespace, which settings/describe sends twice per read', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      const value = yield* Effect.gen(function* () {
        const sidebar = yield* SidebarSettings
        yield* TestClock.setTime(50_000)
        const ids = Array.from({ length: 1_200 }, (_, index) => `session-${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`)
        yield* sidebar.settle(ids.slice(0, 600))
        yield* sidebar.settle(ids.slice(600))
        yield* sidebar.unsettle(ids.slice(0, 10))
        expect(yield* sidebar.settledSessionIds).toHaveLength(1_190)
        expect(sidebar.settledSessionIdsNow()).toHaveLength(1_190)
        return yield* (yield* ThreadSidebarSettings).get
      }).pipe(Effect.provide(hostStart(root, { ...defaults(), parkedSessionIds: ['session-00000005-0000-4000-8000-000000000000'] })))
      const stored = JSON.stringify(value)
      expect(stored).not.toMatch(/session-\d{8}-0000-4000-8000-000000000000/)
      expect(value.settledSessionIds).toEqual([])
      expect(value.settledAt).toEqual({})
      // Settling still drops the parked mark, which stays a setting.
      expect(value.parkedSessionIds).toEqual([])
      expect(stored.length).toBeLessThan(JSON.stringify(defaults()).length + 200)
    }),
  )
})

import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { PluginControls, type PluginInfoLike, type PluginManagerSurface } from './plugin-controls.js'

const entries: PluginInfoLike<string>[] = [
  { entryId: 'dshfiles-backlog', moduleName: '@dshfiles/backlog', enabled: true, fiberPhase: 'active' },
  { entryId: 'ui-cordis', moduleName: '@deepseek-ai/dsh-ui-cordis', enabled: true, fiberPhase: 'active', readOnlyReason: 'management-required' },
]

const controlsFor = (manager: PluginManagerSurface<string> | undefined) =>
  Effect.map(Layer.build(PluginControls.layerFrom(() => manager)), Context.get(PluginControls))

describe('plugin controls', () => {
  it.effect('lists entries and relays the manager verdict for a change, restart included', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls: (readonly [string, boolean])[] = []
        const controls = yield* controlsFor({
          listPlugins: async () => entries,
          setPluginEnabled: async (id, enabled) => {
            calls.push([id, enabled])
            return { changed: true, application: 'restart-required', restartReason: 'host-module', stage: 'enable', target: id, enabled }
          },
        })
        expect((yield* controls.list).map(entry => [entry.entryId, entry.readOnlyReason])).toEqual([
          ['dshfiles-backlog', undefined],
          ['ui-cordis', 'management-required'],
        ])
        const disabled = yield* controls.setEnabled({ entryId: 'dshfiles-backlog', enabled: false })
        expect(disabled).toEqual({ entryId: 'dshfiles-backlog', changed: true, enabled: false, application: 'restart-required', restartReason: 'host-module', warnings: [] })
        const reenabled = yield* controls.setEnabled({ entryId: 'dshfiles-backlog', enabled: true })
        expect(reenabled.enabled).toBe(true)
        expect(calls).toEqual([
          ['dshfiles-backlog', false],
          ['dshfiles-backlog', true],
        ])
      }),
    ),
  )

  it.effect('refuses an unknown entry, a missing manager and a manager failure with a recovery', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const controls = yield* controlsFor({
          listPlugins: async () => entries,
          setPluginEnabled: async () => {
            throw new Error('profile locked')
          },
        })
        const unknown = yield* Effect.flip(controls.setEnabled({ entryId: 'nope', enabled: false }))
        expect(unknown._tag).toBe('PluginEntryUnknown')
        expect(unknown.message).toMatch(/plugin_inventory/)
        const failed = yield* Effect.flip(controls.setEnabled({ entryId: 'dshfiles-backlog', enabled: false }))
        expect(failed.message).toMatch(/profile locked.*cordis\.patch\.yml/)
        const missing = yield* Effect.flip((yield* controlsFor(undefined)).list)
        expect(missing._tag).toBe('PluginManagerMissing')
        expect(missing.message).toMatch(/restart DSH/)
      }),
    ),
  )
})

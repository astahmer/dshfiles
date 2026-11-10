import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option } from 'effect'
import { PluginControls, seedRegionEntries, type PluginInfoLike, type PluginManagerSurface } from './plugin-controls.js'

const entries: PluginInfoLike<string>[] = [
  { entryId: 'dshfiles-backlog', moduleName: '@dshfiles/backlog', enabled: true, fiberPhase: 'active' },
  { entryId: 'ui-cordis', moduleName: '@deepseek-ai/dsh-ui-cordis', enabled: true, fiberPhase: 'active', readOnlyReason: 'management-required' },
]

const controlsFor = (manager: PluginManagerSurface<string> | undefined, patch?: string) =>
  Effect.map(Layer.build(PluginControls.layerFrom(() => manager, Effect.succeed(Option.fromUndefinedOr(patch)))), Context.get(PluginControls))

const profilePatch = [
  '- id: ui-settings-general',
  '  disabled: true',
  '# BEGIN NIX-MANAGED DSH PLUGINS',
  '- id: hmr',
  '  disabled: true',
  '- id: web',
  '  config: {}',
  '# END NIX-MANAGED DSH PLUGINS',
  '- id: web',
  '  disabled: false',
].join('\n')

describe('plugin controls', () => {
  it.effect('lists entries and relays the manager verdict for a change, restart included', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls: (readonly [string, boolean])[] = []
        const controls = yield* controlsFor({
          listPlugins: async () => entries,
          setPluginEnabled: async (id, enabled) => {
            calls.push([id, enabled])
            return { changed: true, application: 'restart-required', restartReason: 'host-module', enabled }
          },
        })
        expect((yield* controls.list).map(entry => [entry.entryId, entry.readOnlyReason])).toEqual([
          ['dshfiles-backlog', null],
          ['ui-cordis', 'management-required'],
        ])
        const disabled = yield* controls.setEnabled({ entryId: 'dshfiles-backlog', enabled: false })
        expect(disabled).toEqual({
          entryId: 'dshfiles-backlog',
          changed: true,
          enabled: false,
          application: 'restart-required',
          restartReason: 'host-module',
          error: null,
          warnings: [],
        })
        const reenabled = yield* controls.setEnabled({ entryId: 'dshfiles-backlog', enabled: true })
        expect(reenabled.enabled).toBe(true)
        expect(calls).toEqual([
          ['dshfiles-backlog', false],
          ['dshfiles-backlog', true],
        ])
      }),
    ),
  )

  it('names the rows whose last override sits in the seed region, which profile:sync restores', () => {
    expect([...seedRegionEntries(profilePatch)]).toEqual(['hmr'])
  })

  it.effect("names each entry's bundle, the bundles that reconfigure it, the seed region and what waits for a restart", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const rows: PluginInfoLike<string>[] = [
          { entryId: 'dshfiles-backlog', moduleName: '@dshfiles/backlog', enabled: true, fiberPhase: 'active' },
          { entryId: 'include:ui-settings-general', moduleName: '@deepseek-ai/dsh-client-ui-settings-general', enabled: false, fiberPhase: null },
          { entryId: 'include:hmr', moduleName: '@deepseek-ai/dsh-client-hmr', enabled: false, fiberPhase: 'active' },
        ]
        const controls = yield* controlsFor(
          {
            listPlugins: async () => rows,
            listBundles: async () => [
              { name: '@dshfiles/backlog', rows: [{ rowId: 'dshfiles-backlog', entryId: 'dshfiles-backlog' }], overrides: [] },
              { name: '@dshfiles/settings-shell', rows: [{ rowId: 'dshfiles-settings-shell' }], overrides: ['ui-settings-general'] },
            ],
            setPluginEnabled: async (_id, enabled) => ({ changed: true, application: 'restart-required', restartReason: 'host-module', enabled }),
          },
          profilePatch,
        )
        const before = yield* controls.list
        expect(before.map(entry => [entry.entryId, entry.bundle, entry.configuredBy, entry.pendingRestart, entry.seedRegion])).toEqual([
          ['dshfiles-backlog', '@dshfiles/backlog', [], null, false],
          ['include:ui-settings-general', null, ['@dshfiles/settings-shell'], null, false],
          ['include:hmr', null, [], 'disable', true],
        ])
        yield* controls.setEnabled({ entryId: 'dshfiles-backlog', enabled: false })
        expect((yield* controls.list)[0]?.pendingRestart).toBe('disable')
        yield* controls.setEnabled({ entryId: 'dshfiles-backlog', enabled: true })
        expect((yield* controls.list)[0]?.pendingRestart).toBeNull()
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

import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { NativeSettings, type SettingsRow, type SettingsSurface, type SettingsUnsetOp } from './native-settings-promise.js'
import { SettingsTools } from './settings-tools.js'

const row = (ns: string, value: SettingsRow['value'], overrides: Partial<SettingsRow> = {}): SettingsRow => ({
  ns,
  autoGenerate: true,
  value,
  revision: 4,
  ...overrides,
})

/** The Host settings forms are external to the plugin; each test supplies the surface they would serve. */
const createSurface = (overrides: Partial<SettingsSurface> = {}): SettingsSurface => ({
  writable: true,
  describe: () => [row('agent-loop', { maxRounds: 3 }, { revision: 7 }), row('ui-theme', { mode: 'dark' })],
  update: async () => undefined,
  mutate: async () => undefined,
  ...overrides,
})

const toolsFor = (surface: SettingsSurface | undefined) =>
  Effect.map(Layer.build(SettingsTools.layer.pipe(Layer.provide(NativeSettings.layerFrom(() => surface)))), Context.get(SettingsTools))

describe('settings tools: list', () => {
  it.effect('lists namespaces without their values and adds one on request', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tools = yield* toolsFor(createSurface())
        const all = yield* tools.list({})
        expect(all.writable).toBe(true)
        expect(all.namespaces).toEqual([
          { namespace: 'agent-loop', revision: 7, autoGenerate: true, secretFields: 0 },
          { namespace: 'ui-theme', revision: 4, autoGenerate: true, secretFields: 0 },
        ])
        expect((yield* tools.list({ namespace: 'ui-theme' })).namespaces).toEqual([
          { namespace: 'ui-theme', revision: 4, autoGenerate: true, secretFields: 0, value: '{"mode":"dark"}' },
        ])
      }),
    ),
  )

  it.effect('filters by query and refuses an unknown namespace by name', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tools = yield* toolsFor(createSurface())
        expect((yield* tools.list({ query: 'THEME' })).namespaces.map(entry => entry.namespace)).toEqual(['ui-theme'])
        const unknown = yield* Effect.flip(tools.list({ namespace: 'nope' }))
        expect(unknown._tag).toBe('SettingsNamespaceUnknown')
        expect(unknown.message).toMatch(/Known namespaces include agent-loop, ui-theme/)
      }),
    ),
  )

  it.effect('searches the section entries the browser last published, only for a query', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tools = yield* toolsFor(createSurface())
        const developerTools = { sectionId: 'general', sectionLabel: 'General', id: 'developer-tools', title: 'Show coding view', keywords: 'devtools' }
        expect(yield* tools.publishSearchEntries([developerTools])).toEqual({ count: 1 })
        expect(yield* tools.list({ query: 'DEVTOOLS' })).toEqual({ writable: true, namespaces: [], entries: [developerTools] })
        expect((yield* tools.list({})).entries).toBeUndefined()
        expect((yield* tools.list({ query: 'theme' })).entries).toBeUndefined()
        yield* tools.publishSearchEntries([])
        expect((yield* tools.list({ query: 'devtools' })).entries).toBeUndefined()
      }),
    ),
  )

  it.effect('omits a value too large for the model and reports it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tools = yield* toolsFor(createSurface({ describe: () => [row('ai-accounts', { blob: 'x'.repeat(70 * 1024) })] }))
        expect((yield* tools.list({ namespace: 'ai-accounts' })).namespaces[0]).toEqual({
          namespace: 'ai-accounts',
          revision: 4,
          autoGenerate: true,
          secretFields: 0,
          valueTooLarge: true,
        })
      }),
    ),
  )

  it.effect('refuses every call when the Host serves no settings service', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tools = yield* toolsFor(undefined)
        expect(yield* Effect.flip(tools.list({}))).toMatchObject({ _tag: 'SettingsServiceMissing', message: 'This Host serves no settings service.' })
      }),
    ),
  )
})

describe('settings tools: write', () => {
  it.effect('merges a patch at the revision the descriptor reported', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const writes: Array<{ ns: string; patch: object; revision: number | undefined }> = []
        const tools = yield* toolsFor(
          createSurface({
            update: async (ns, patch, revision) => {
              writes.push({ ns, patch, revision })
            },
          }),
        )
        expect(yield* tools.set({ namespace: 'agent-loop', patch: { maxRounds: 5, stalledRounds: 2 } })).toEqual({
          namespace: 'agent-loop',
          applied: ['maxRounds', 'stalledRounds'],
          revision: 7,
        })
        expect(writes).toEqual([{ ns: 'agent-loop', patch: { maxRounds: 5, stalledRounds: 2 }, revision: 7 }])
      }),
    ),
  )

  it.effect('resets one field with a path op instead of restating the section', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const ops: Array<{ ns: string; ops: readonly SettingsUnsetOp[]; revision: number | undefined }> = []
        const tools = yield* toolsFor(
          createSurface({
            mutate: async (ns, operations, revision) => {
              ops.push({ ns, ops: operations, revision })
            },
          }),
        )
        expect(yield* tools.unset({ namespace: 'ui-theme', path: ['mode'] })).toEqual({ namespace: 'ui-theme', path: ['mode'] })
        expect(ops).toEqual([{ ns: 'ui-theme', ops: [{ op: 'unset', path: ['mode'] }], revision: 4 }])
      }),
    ),
  )

  it.effect('refuses to write when the profile is read-only', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tools = yield* toolsFor(createSurface({ writable: false }))
        expect((yield* Effect.flip(tools.set({ namespace: 'ui-theme', patch: { mode: 'light' } })))._tag).toBe('SettingsReadOnly')
      }),
    ),
  )

  it.effect('turns a lost revision race into a readable conflict', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const conflict = Object.assign(new Error('agent-loop changed'), { code: 'SETTINGS_CONFLICT' })
        const tools = yield* toolsFor(createSurface({ update: async () => Promise.reject(conflict) }))
        const failed = yield* Effect.flip(tools.set({ namespace: 'agent-loop', patch: { maxRounds: 2 } }))
        expect(failed._tag).toBe('SettingsWriteConflict')
        expect(failed.message).toBe('agent-loop changed since it was read; read it again with settings_list and retry.')
      }),
    ),
  )

  it.effect('passes a schema rejection through as the Host message', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const rejected = Object.assign(new Error('maxRounds: expected a number'), { code: 'EINVALID' })
        const tools = yield* toolsFor(createSurface({ update: async () => Promise.reject(rejected) }))
        const failed = yield* Effect.flip(tools.set({ namespace: 'agent-loop', patch: { maxRounds: 'many' } }))
        expect(failed).toMatchObject({ _tag: 'SettingsWriteRejected', message: 'maxRounds: expected a number' })
      }),
    ),
  )
})

describe('settings-shell tool exposure', () => {
  it('exposes the release check and settings read, merge and reset tools', async () => {
    const { settingsShellApi } = await import('./shell-api.js')
    const tools = Object.values(settingsShellApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name)).toEqual(['dsh_release_status', 'settings_list', 'settings_set', 'settings_unset'])
    expect(tools.filter(tool => tool.readOnly === true).map(tool => tool.name)).toEqual(['dsh_release_status', 'settings_list'])
    for (const method of Object.values(settingsShellApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description).toBeTruthy()
    }
  })
})

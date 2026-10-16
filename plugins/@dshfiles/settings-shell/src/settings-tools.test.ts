import { PluginApiError } from '@dshfiles/dshx/api'
import { describe, expect, test } from 'vitest'
import { createSettingsTools, type SettingsRow, type SettingsSurface, type SettingsUnsetOp } from './settings-tools.js'

const row = (ns: string, value: SettingsRow['value'], overrides: Partial<SettingsRow> = {}): SettingsRow => ({
  ns,
  autoGenerate: true,
  value,
  revision: 4,
  ...overrides,
})

const createSurface = (overrides: Partial<SettingsSurface> = {}): SettingsSurface => ({
  writable: true,
  describe: () => [row('agent-loop', { maxRounds: 3 }, { revision: 7 }), row('ui-theme', { mode: 'dark' })],
  update: async () => undefined,
  mutate: async () => undefined,
  ...overrides,
})

const tools = (surface: SettingsSurface) => createSettingsTools(() => surface)

describe('settings tools: list', () => {
  test('lists namespaces without their values and adds one on request', () => {
    const surface = createSurface()

    const all = tools(surface).list({ input: {} })
    expect(all.writable).toBe(true)
    expect(all.namespaces).toEqual([
      { namespace: 'agent-loop', revision: 7, autoGenerate: true, secretFields: 0 },
      { namespace: 'ui-theme', revision: 4, autoGenerate: true, secretFields: 0 },
    ])

    const one = tools(surface).list({ input: { namespace: 'ui-theme' } })
    expect(one.namespaces).toEqual([{ namespace: 'ui-theme', revision: 4, autoGenerate: true, secretFields: 0, value: '{"mode":"dark"}' }])
  })

  test('filters by query and refuses an unknown namespace by name', () => {
    const surface = createSurface()
    expect(
      tools(surface)
        .list({ input: { query: 'THEME' } })
        .namespaces.map(entry => entry.namespace),
    ).toEqual(['ui-theme'])
    expect(() => tools(surface).list({ input: { namespace: 'nope' } })).toThrow(/Known namespaces include agent-loop, ui-theme/)
  })

  test('omits a value too large for the model and reports it', () => {
    const surface = createSurface({
      describe: () => [row('ai-accounts', { blob: 'x'.repeat(70 * 1024) })],
    })
    expect(tools(surface).list({ input: { namespace: 'ai-accounts' } }).namespaces[0]).toEqual({
      namespace: 'ai-accounts',
      revision: 4,
      autoGenerate: true,
      secretFields: 0,
      valueTooLarge: true,
    })
  })
})

describe('settings tools: write', () => {
  test('merges a patch at the revision the descriptor reported', async () => {
    const writes: Array<{ ns: string; patch: object; revision: number | undefined }> = []
    const surface = createSurface({
      update: async (ns, patch, revision) => {
        writes.push({ ns, patch, revision })
      },
    })

    expect(await tools(surface).set({ input: { namespace: 'agent-loop', patch: { maxRounds: 5, stalledRounds: 2 } } })).toEqual({
      namespace: 'agent-loop',
      applied: ['maxRounds', 'stalledRounds'],
      revision: 7,
    })
    expect(writes).toEqual([{ ns: 'agent-loop', patch: { maxRounds: 5, stalledRounds: 2 }, revision: 7 }])
  })

  test('resets one field with a path op instead of restating the section', async () => {
    const ops: Array<{ ns: string; ops: readonly SettingsUnsetOp[]; revision: number | undefined }> = []
    const surface = createSurface({
      mutate: async (ns, operations, revision) => {
        ops.push({ ns, ops: operations, revision })
      },
    })

    expect(await tools(surface).unset({ input: { namespace: 'ui-theme', path: ['mode'] } })).toEqual({
      namespace: 'ui-theme',
      path: ['mode'],
    })
    expect(ops).toEqual([{ ns: 'ui-theme', ops: [{ op: 'unset', path: ['mode'] }], revision: 4 }])
  })

  test('refuses to write when the profile is read-only', async () => {
    const surface = createSurface({ writable: false })
    await expect(tools(surface).set({ input: { namespace: 'ui-theme', patch: { mode: 'light' } } })).rejects.toSatisfy(
      error => error instanceof PluginApiError && error.code === 'settings-read-only',
    )
  })

  test('turns a lost revision race into a readable conflict', async () => {
    const conflict = Object.assign(new Error('agent-loop changed'), { code: 'SETTINGS_CONFLICT' })
    const surface = createSurface({ update: async () => Promise.reject(conflict) })
    await expect(tools(surface).set({ input: { namespace: 'agent-loop', patch: { maxRounds: 2 } } })).rejects.toSatisfy(
      error => error instanceof PluginApiError && error.code === 'settings-conflict',
    )
  })

  test('passes a schema rejection through as the Host message', async () => {
    const rejected = Object.assign(new Error('maxRounds: expected a number'), { code: 'EINVALID' })
    const surface = createSurface({ update: async () => Promise.reject(rejected) })
    await expect(tools(surface).set({ input: { namespace: 'agent-loop', patch: { maxRounds: 'many' } } })).rejects.toThrow('maxRounds: expected a number')
  })
})

describe('settings-shell tool exposure', () => {
  test('exposes exactly the settings read, merge and reset tools', async () => {
    const { settingsShellApi } = await import('./shell-api.js')
    const tools = Object.values(settingsShellApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name)).toEqual(['settings_list', 'settings_set', 'settings_unset'])
    expect(tools.filter(tool => tool.readOnly === true).map(tool => tool.name)).toEqual(['settings_list'])
    for (const method of Object.values(settingsShellApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description).toBeTruthy()
    }
  })
})

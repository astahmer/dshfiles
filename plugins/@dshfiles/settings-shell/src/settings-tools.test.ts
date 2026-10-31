import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import type { SectionEntryRow } from './settings-search.js'
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

const noEntries = { read: () => [], replace: () => {} }
const tools = (surface: SettingsSurface) => createSettingsTools({ settings: () => surface, searchEntries: noEntries })

describe('settings tools: list', () => {
  test('lists namespaces without their values and adds one on request', async () => {
    const surface = createSurface()

    const all = await Effect.runPromise(tools(surface).list({ input: {} }))
    expect(all.writable).toBe(true)
    expect(all.namespaces).toEqual([
      { namespace: 'agent-loop', revision: 7, autoGenerate: true, secretFields: 0 },
      { namespace: 'ui-theme', revision: 4, autoGenerate: true, secretFields: 0 },
    ])

    const one = await Effect.runPromise(tools(surface).list({ input: { namespace: 'ui-theme' } }))
    expect(one.namespaces).toEqual([{ namespace: 'ui-theme', revision: 4, autoGenerate: true, secretFields: 0, value: '{"mode":"dark"}' }])
  })

  test('filters by query and refuses an unknown namespace by name', async () => {
    const surface = createSurface()
    expect((await Effect.runPromise(tools(surface).list({ input: { query: 'THEME' } }))).namespaces.map(entry => entry.namespace)).toEqual(['ui-theme'])
    await expect(Effect.runPromise(tools(surface).list({ input: { namespace: 'nope' } }))).rejects.toThrow(/Known namespaces include agent-loop, ui-theme/)
  })

  test('searches the section entries the browser last published, only for a query', async () => {
    let published: readonly SectionEntryRow[] = []
    const searchEntries = { read: () => published, replace: (entries: readonly SectionEntryRow[]) => (published = entries) }
    const withEntries = createSettingsTools({ settings: () => createSurface(), searchEntries })
    const developerTools = { sectionId: 'general', sectionLabel: 'General', id: 'developer-tools', title: 'Show coding view', keywords: 'devtools' }
    expect(await Effect.runPromise(withEntries.publishSearchEntries({ input: { entries: [developerTools] } }))).toEqual({ count: 1 })
    expect(await Effect.runPromise(withEntries.list({ input: { query: 'DEVTOOLS' } }))).toEqual({ writable: true, namespaces: [], entries: [developerTools] })
    expect((await Effect.runPromise(withEntries.list({ input: {} }))).entries).toBeUndefined()
    expect((await Effect.runPromise(withEntries.list({ input: { query: 'theme' } }))).entries).toBeUndefined()
    await Effect.runPromise(withEntries.publishSearchEntries({ input: { entries: [] } }))
    expect((await Effect.runPromise(withEntries.list({ input: { query: 'devtools' } }))).entries).toBeUndefined()
  })

  test('omits a value too large for the model and reports it', async () => {
    const surface = createSurface({
      describe: () => [row('ai-accounts', { blob: 'x'.repeat(70 * 1024) })],
    })
    expect((await Effect.runPromise(tools(surface).list({ input: { namespace: 'ai-accounts' } }))).namespaces[0]).toEqual({
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

    expect(await Effect.runPromise(tools(surface).set({ input: { namespace: 'agent-loop', patch: { maxRounds: 5, stalledRounds: 2 } } }))).toEqual({
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

    expect(await Effect.runPromise(tools(surface).unset({ input: { namespace: 'ui-theme', path: ['mode'] } }))).toEqual({
      namespace: 'ui-theme',
      path: ['mode'],
    })
    expect(ops).toEqual([{ ns: 'ui-theme', ops: [{ op: 'unset', path: ['mode'] }], revision: 4 }])
  })

  test('refuses to write when the profile is read-only', async () => {
    const surface = createSurface({ writable: false })
    await expect(Effect.runPromise(tools(surface).set({ input: { namespace: 'ui-theme', patch: { mode: 'light' } } }))).rejects.toMatchObject({
      _tag: 'SettingsReadOnly',
    })
  })

  test('turns a lost revision race into a readable conflict', async () => {
    const conflict = Object.assign(new Error('agent-loop changed'), { code: 'SETTINGS_CONFLICT' })
    const surface = createSurface({ update: async () => Promise.reject(conflict) })
    await expect(Effect.runPromise(tools(surface).set({ input: { namespace: 'agent-loop', patch: { maxRounds: 2 } } }))).rejects.toMatchObject({
      _tag: 'SettingsConflict',
    })
  })

  test('passes a schema rejection through as the Host message', async () => {
    const rejected = Object.assign(new Error('maxRounds: expected a number'), { code: 'EINVALID' })
    const surface = createSurface({ update: async () => Promise.reject(rejected) })
    await expect(Effect.runPromise(tools(surface).set({ input: { namespace: 'agent-loop', patch: { maxRounds: 'many' } } }))).rejects.toThrow(
      'maxRounds: expected a number',
    )
  })
})

describe('settings-shell tool exposure', () => {
  test('exposes the release check and settings read, merge and reset tools', async () => {
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

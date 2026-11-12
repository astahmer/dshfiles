import { describe, expect, it, vi } from 'vitest'
import { ModeChipCatalog, ModeChipModel, type ModeChipHost } from './mode-chip-model.ts'
import { CONTEXT_METER_VISIBLE_FROM, contextTone } from './context-tone.ts'

const catalogValue = {
  options: [
    { value: 'read-only', name: 'read-only' },
    { value: 'workspace-write', name: 'workspace-write' },
    { value: 'danger-full-access', name: 'danger-full-access' },
    { value: 'team-review', name: 'team-review', description: 'Team policy.' },
  ],
  defaultOptions: [],
  defaultPreset: 'workspace-write',
}

describe('the composer mode chip (b:v9yh)', () => {
  it('names file access in plain words, never the preset keys', () => {
    expect(ModeChipModel.accessLabel('workspace-write', 'workspace-write')).toBe('Can edit')
    expect(ModeChipModel.accessLabel('read-only')).toBe('Read only')
    expect(ModeChipModel.accessLabel('danger-full-access')).toBe('Full access')
    expect(ModeChipModel.accessLabel('auto')).toBe('Auto review')
    expect(ModeChipModel.accessLabel('team-review', 'team-review')).toBe('Team review')
    expect(ModeChipModel.accessLabel('custom-1', 'My Policy')).toBe('My Policy')
  })

  it('reads plan mode first, then the access', () => {
    expect(ModeChipModel.chipLabel({ plan: false, access: 'Can edit' })).toBe('Can edit')
    expect(ModeChipModel.chipLabel({ plan: true, access: 'Read only' })).toBe('Plan · Read only')
    expect(ModeChipModel.chipLabel({ plan: false, access: 'Full access' })).toBe('Full access')
  })

  it('writes plan mode and access through their own slash commands', () => {
    expect(ModeChipModel.planLine(true)).toBe('/plan')
    expect(ModeChipModel.planLine(false)).toBe('/plan off')
    expect(ModeChipModel.isRisky('danger-full-access')).toBe(true)
    expect(ModeChipModel.isRisky('auto')).toBe(true)
    expect(ModeChipModel.isRisky('workspace-write')).toBe(false)
  })

  it('describes the built-in presets and keeps a Host description for the others', () => {
    expect(ModeChipModel.accessDetail({ value: 'workspace-write', name: 'workspace-write' })).toMatch(/workspace/u)
    expect(ModeChipModel.accessDetail({ value: 'team-review', name: 'team-review', description: 'Team policy.' })).toBe('Team policy.')
  })

  it('reads the catalog once for its subscribers and again after a change event', async () => {
    let changed: () => void = () => undefined
    const host: ModeChipHost = {
      catalog: vi.fn(async () => ({ ok: true as const, value: catalogValue })),
      onCatalogChanged: listener => {
        changed = listener
        return () => undefined
      },
      run: async () => null,
    }
    const catalog = new ModeChipCatalog(host)
    const seen = vi.fn()
    const stop = catalog.subscribe(seen)
    await catalog.refresh()
    expect(catalog.get()?.options).toHaveLength(4)
    expect(host.catalog).toHaveBeenCalledTimes(1)
    changed()
    await catalog.refresh()
    expect(host.catalog).toHaveBeenCalledTimes(2)
    expect(seen).toHaveBeenCalled()
    stop()
    catalog.dispose()
  })

  it('keeps the last good catalog when a read fails', async () => {
    let fail = false
    const host: ModeChipHost = {
      catalog: async () => (fail ? { ok: false as const, error: { message: 'down' } } : { ok: true as const, value: catalogValue }),
      onCatalogChanged: () => () => undefined,
      run: async () => null,
    }
    const catalog = new ModeChipCatalog(host)
    await catalog.refresh()
    fail = true
    await catalog.refresh()
    expect(catalog.get()?.defaultPreset).toBe('workspace-write')
  })
})

describe('the context meter (b:v9yh)', () => {
  it('stays out of the bar below a quarter and turns amber, then red, near full', () => {
    expect(CONTEXT_METER_VISIBLE_FROM).toBe(25)
    expect(contextTone(60)).toBe('neutral')
    expect(contextTone(80)).toBe('warn')
    expect(contextTone(94)).toBe('warn')
    expect(contextTone(95)).toBe('danger')
  })
})

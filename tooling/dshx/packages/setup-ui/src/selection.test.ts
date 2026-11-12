import { describe, expect, it } from 'vitest'
import type { SetupState } from './api.js'
import { SelectionModel } from './selection.js'

const presets = [
  { id: 'essentials', title: 'Essentials', packs: [] },
  { id: 'daily', title: 'Daily work', packs: ['transcript', 'versioning'] },
]
const state = (defaults: SetupState['defaults']): SetupState => ({
  checks: [],
  blocking: false,
  packs: [],
  presets,
  profiles: [],
  dshHome: '/tmp/home',
  defaults,
})

describe('preset selection', () => {
  it('starts from the CLI packs, else the CLI preset', () => {
    expect(SelectionModel.initial(state({ profile: 'main', preset: 'daily' })).packs).toEqual(['transcript', 'versioning'])
    expect(SelectionModel.initial(state({ profile: 'main', preset: '', packs: ['knowledge'] })).packs).toEqual(['knowledge'])
  })

  it('names the preset only while the packs match it exactly, in any order', () => {
    const daily = SelectionModel.withPreset({ profile: 'main', packs: [], extend: false }, presets, 'daily')
    expect(SelectionModel.presetOf({ ...daily, packs: ['versioning', 'transcript'] }, presets)?.id).toBe('daily')
    const edited = SelectionModel.toggle(daily, 'knowledge', true)
    expect(SelectionModel.presetOf(edited, presets)).toBeUndefined()
    expect(SelectionModel.presetOf(SelectionModel.toggle(edited, 'knowledge', false), presets)?.id).toBe('daily')
  })

  it('accepts only plain directory names for the profile', () => {
    expect(SelectionModel.validName('main')).toBe(true)
    expect(SelectionModel.validName('../web')).toBe(false)
    expect(SelectionModel.validName('')).toBe(false)
  })
})

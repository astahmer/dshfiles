import { describe, expect, it } from 'vitest'
import { Origin } from './origin.js'

describe('bundle origin', () => {
  it('tells dshfiles, stock DSH and community bundles apart', () => {
    expect(Origin.ofBundle({ name: '@dshfiles/agent-loop', official: true })).toBe('dshfiles')
    expect(Origin.ofBundle({ name: '@deepseek-ai/dsh-base' })).toBe('dsh')
    expect(Origin.ofBundle({ name: 'dsh-official-extra', official: true })).toBe('dsh')
    expect(Origin.ofBundle({ name: 'dshmarket', official: false })).toBe('community')
  })

  it('counts every bundle that is not stock DSH as a plugin in Settings', () => {
    expect(Origin.settingsOfBundle({ name: '@deepseek-ai/dsh-base' })).toBe('dsh')
    expect(Origin.settingsOfBundle({ name: '@dshfiles/main-tabs' })).toBe('plugin')
    expect(Origin.settingsOfBundle({ name: 'dshmarket' })).toBe('plugin')
  })
})

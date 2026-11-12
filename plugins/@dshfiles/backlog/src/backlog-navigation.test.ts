import { describe, expect, it } from 'vitest'

import { BacklogNavigation } from './backlog-navigation.js'

describe('backlog navigation', () => {
  it('leaves the Workbench to show its own Backlog tab instead of selecting the native main panel', async () => {
    const selected: number[] = []
    const shown = await BacklogNavigation.show({
      workbench: async () => ({ kind: 'workbench', panelId: 'panel:backlog' }),
      selectMainPanel: () => selected.push(1),
    })
    expect(shown).toBe('workbench')
    expect(selected).toEqual([])
  })

  it('selects the native main panel when no Workbench owns the page', async () => {
    const selected: number[] = []
    const shown = await BacklogNavigation.show({
      workbench: async () => ({ kind: 'native' }),
      selectMainPanel: () => selected.push(1),
    })
    expect(shown).toBe('native')
    expect(selected).toEqual([1])
  })
})

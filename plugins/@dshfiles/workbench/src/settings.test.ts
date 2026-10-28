import { describe, expect, it } from 'vitest'
import { workbenchSettings } from './settings.js'

describe('unified pane settings', () => {
  it('decodes legacy preferences without exposing selectable native surfaces', () => {
    expect(workbenchSettings.schema({ mainSurface: 'native', rightPanel: 'native', headerToggle: false })).toMatchObject({ bottomPanel: 'hidden' })
    const fields = workbenchSettings.schema.dict ?? {}
    expect(fields.mainSurface?.meta.hidden).toBe(true)
    expect(fields.rightPanel?.meta.hidden).toBe(true)
    expect(fields.headerToggle?.meta.hidden).toBe(true)
  })

  it('keeps bottom and developer panel controls visible', () => {
    const fields = workbenchSettings.schema.dict ?? {}
    expect(fields.bottomPanel?.meta.hidden).not.toBe(true)
    expect(fields.demoPanels?.meta.hidden).not.toBe(true)
  })
})

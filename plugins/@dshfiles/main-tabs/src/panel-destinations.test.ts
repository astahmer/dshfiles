import { describe, expect, it } from 'vitest'
import { PanelDestinationsModel } from './panel-destinations.js'

describe('PanelDestinationsModel (round five B4)', () => {
  it('places a page under the destination the rail lists it in, with that destination\'s glyph', () => {
    expect(PanelDestinationsModel.of('dshfiles-backlog-panel')).toEqual({ id: 'work', icon: 'list-todo' })
    expect(PanelDestinationsModel.of('attention-inbox')).toEqual({ id: 'inbox', icon: 'inbox' })
    expect(PanelDestinationsModel.of('dshfiles-usage')).toEqual({ id: 'observe', icon: 'activity' })
    expect(PanelDestinationsModel.of('diffs-review')).toEqual({ id: 'land', icon: 'git-merge' })
    expect(PanelDestinationsModel.of('plugins')).toEqual({ id: 'settings', icon: 'settings' })
  })

  it('puts the Settings page, a developer page and an unmapped page in Settings', () => {
    expect(PanelDestinationsModel.of('dshfiles-settings')).toEqual({ id: 'settings', icon: 'settings' })
    expect(PanelDestinationsModel.of('component-gallery')).toEqual({ id: 'settings', icon: 'settings' })
    expect(PanelDestinationsModel.of('someone-elses-page')).toEqual({ id: 'settings', icon: 'settings' })
  })

  it('lets a contributed section win over the built-in table', () => {
    expect(PanelDestinationsModel.of('dshfiles-usage', [{ panelId: 'dshfiles-usage', destination: 'knowledge', label: 'Usage' }])).toEqual({ id: 'knowledge', icon: 'library' })
  })
})

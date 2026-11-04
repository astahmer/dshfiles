import { describe, expect, it } from 'vitest'
import { PanelTitlesModel } from './panel-titles.js'

describe('main tab titles', () => {
  const titles = PanelTitlesModel.destinationTitles([{ panelId: 'my-page', destination: 'observe', label: 'My page' }])

  it('names a destination section by its section label, never by its plugin', () => {
    expect(PanelTitlesModel.titleOf('dshfiles-usage', 'Usage: Analytics', titles)).toBe('Usage')
    expect(PanelTitlesModel.titleOf('dshfiles-jujutsu', 'Jujutsu: Revision graph', titles)).toBe('History')
    expect(PanelTitlesModel.titleOf('my-page', 'Mine: Page', titles)).toBe('My page')
  })

  it('drops the plugin prefix of any other page and keeps a plain label', () => {
    expect(PanelTitlesModel.titleOf('unknown', 'Some Plugin: Things', titles)).toBe('Things')
    expect(PanelTitlesModel.titleOf('unknown', 'Things', titles)).toBe('Things')
    expect(PanelTitlesModel.titleOf('unknown', undefined, titles)).toBeUndefined()
  })
})

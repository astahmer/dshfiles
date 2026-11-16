import { describe, expect, it } from 'vitest'
import { lastKnownPanelTitle, missingPanelMessage } from './missing-panel.js'

describe('lastKnownPanelTitle', () => {
  it('keeps the saved title and refuses an id that stands in for one', () => {
    const id = 'dshfiles-resource/session-2e1cc08c/tab2'
    expect(lastKnownPanelTitle(id, 'Changes')).toBe('Changes')
    expect(lastKnownPanelTitle(id, id)).toBeUndefined()
    expect(lastKnownPanelTitle('gone', ' ')).toBeUndefined()
    expect(lastKnownPanelTitle('gone', undefined)).toBeUndefined()
    expect(lastKnownPanelTitle('gone', 'dshfiles-resource/session-other/tab1')).toBeUndefined()
  })
})

describe('missingPanelMessage', () => {
  it('tells a thread page that is gone from a panel waiting for its plugin', () => {
    expect(missingPanelMessage('dshfiles-resource/session-2e1cc08c/tab2', 'Changes')).toEqual({ key: 'missingThreadPanelNamed', params: { title: 'Changes' } })
    expect(missingPanelMessage('dshfiles-resource/session-2e1cc08c/tab2', undefined)).toEqual({ key: 'missingThreadPanel' })
    expect(missingPanelMessage('dshfiles-editor.main', 'Editor')).toEqual({ key: 'missingPanelNamed', params: { title: 'Editor' } })
    expect(missingPanelMessage('gone', 'gone')).toEqual({ key: 'missingPanel' })
  })
})

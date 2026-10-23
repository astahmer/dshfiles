import { ActivityIcon, ListIcon } from '@dshfiles/plugin-ui/icons'
import { describe, expect, it } from 'vitest'
import { threadViewPresetCompactLabel } from './thread-view-manager.js'
import { DEFAULT_THREAD_VIEW_PRESETS } from './thread-view-preferences.js'
import { viewTabsNeedCompactLabels } from './thread-view-tabs.js'

describe('view tab row', () => {
  it('keeps full names while every tab fits and switches to compact labels once the row is narrower', () => {
    expect(viewTabsNeedCompactLabels({ rowWidth: 600, tabCount: 4 })).toBe(false)
    expect(viewTabsNeedCompactLabels({ rowWidth: 492, tabCount: 4 })).toBe(false)
    expect(viewTabsNeedCompactLabels({ rowWidth: 415, tabCount: 4 })).toBe(true)
    expect(viewTabsNeedCompactLabels({ rowWidth: 240, tabCount: 5 })).toBe(true)
  })

  it('never compacts a hidden or empty row', () => {
    expect(viewTabsNeedCompactLabels({ rowWidth: 0, tabCount: 5 })).toBe(false)
    expect(viewTabsNeedCompactLabels({ rowWidth: 200, tabCount: 0 })).toBe(false)
  })

  it('gives built-in views an icon and custom views their initial', () => {
    expect(threadViewPresetCompactLabel(DEFAULT_THREAD_VIEW_PRESETS[0])).toEqual({ kind: 'icon', icon: ListIcon })
    expect(threadViewPresetCompactLabel(DEFAULT_THREAD_VIEW_PRESETS[1])).toEqual({ kind: 'icon', icon: ActivityIcon })
    expect(threadViewPresetCompactLabel({ ...DEFAULT_THREAD_VIEW_PRESETS[0], id: 'later', name: '  later today' })).toEqual({ kind: 'initial', initial: 'L' })
    expect(threadViewPresetCompactLabel({ ...DEFAULT_THREAD_VIEW_PRESETS[1], name: 'Busy' })).toEqual({ kind: 'initial', initial: 'B' })
  })
})

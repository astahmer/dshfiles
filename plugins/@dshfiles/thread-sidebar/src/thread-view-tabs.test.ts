import { ActivityIcon, ListIcon } from '@dshfiles/plugin-ui/icons'
import { describe, expect, it } from 'vitest'
import { threadViewPresetCompactLabel } from './thread-view-manager.js'
import { DEFAULT_THREAD_VIEW_PRESETS } from './thread-view-preferences.js'
import { viewTabsNeedCompactLabels } from './thread-view-tabs.js'

describe('view tab row', () => {
  it('keeps full names while the measured full tabs fit and switches to compact labels once the row is narrower', () => {
    expect(viewTabsNeedCompactLabels({ rowWidth: 400, requiredWidth: 330 })).toBe(false)
    expect(viewTabsNeedCompactLabels({ rowWidth: 330, requiredWidth: 330 })).toBe(false)
    expect(viewTabsNeedCompactLabels({ rowWidth: 329, requiredWidth: 330 })).toBe(true)
  })

  it('never compacts a hidden row or before the full tabs are measured', () => {
    expect(viewTabsNeedCompactLabels({ rowWidth: 0, requiredWidth: 330 })).toBe(false)
    expect(viewTabsNeedCompactLabels({ rowWidth: 200, requiredWidth: 0 })).toBe(false)
  })

  it('gives built-in views an icon and custom views their initial', () => {
    expect(threadViewPresetCompactLabel(DEFAULT_THREAD_VIEW_PRESETS[0])).toEqual({ kind: 'icon', icon: ListIcon })
    expect(threadViewPresetCompactLabel(DEFAULT_THREAD_VIEW_PRESETS[1])).toEqual({ kind: 'icon', icon: ActivityIcon })
    expect(threadViewPresetCompactLabel({ ...DEFAULT_THREAD_VIEW_PRESETS[0], id: 'later', name: '  later today' })).toEqual({ kind: 'initial', initial: 'L' })
    expect(threadViewPresetCompactLabel({ ...DEFAULT_THREAD_VIEW_PRESETS[1], name: 'Busy' })).toEqual({ kind: 'initial', initial: 'B' })
  })
})

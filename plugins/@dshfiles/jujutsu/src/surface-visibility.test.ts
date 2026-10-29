import { describe, expect, it } from 'vitest'
import { SurfaceVisibility } from './surface-visibility.js'

const selectingPanel =
  (activePanelId: string | null) =>
  (selector: (info: { readonly activePanelId: string | null }) => boolean): boolean =>
    selector({ activePanelId })

describe('SurfaceVisibility', () => {
  it('shows a main entry only while it is the selected main panel', () => {
    expect(SurfaceVisibility.useMainPanelVisible({ usePanelInfo: selectingPanel('dshfiles-jujutsu'), panelId: 'dshfiles-jujutsu' })).toBe(true)
    expect(SurfaceVisibility.useMainPanelVisible({ usePanelInfo: selectingPanel('plugins'), panelId: 'dshfiles-jujutsu' })).toBe(false)
    expect(SurfaceVisibility.useMainPanelVisible({ usePanelInfo: selectingPanel(null), panelId: 'dshfiles-jujutsu' })).toBe(false)
  })

  it('follows the right-pane tab visibility the sidebar reports', () => {
    expect(SurfaceVisibility.useSideTabVisible(() => ({ tab: { visible: true } }))).toBe(true)
    expect(SurfaceVisibility.useSideTabVisible(() => ({ tab: { visible: false } }))).toBe(false)
  })
})

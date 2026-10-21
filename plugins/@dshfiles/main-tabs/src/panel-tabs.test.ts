// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { OPEN_PANEL_TAB_EVENT, PANEL_SCOPE_EVENT, PANEL_TAB_TITLE_EVENT, PanelTabs } from './panel-tabs.js'

const received: { readonly type: string; readonly detail: unknown }[] = []
const record = (event: Event): void => {
  received.push({ type: event.type, detail: event instanceof CustomEvent ? event.detail : undefined })
}

afterEach(() => {
  window.removeEventListener(OPEN_PANEL_TAB_EVENT, record)
  window.removeEventListener(PANEL_SCOPE_EVENT, record)
  window.removeEventListener(PANEL_TAB_TITLE_EVENT, record)
  received.length = 0
})

describe('panel tabs with their own scope', () => {
  it('asks for a tab on one panel scope and names it', () => {
    window.addEventListener(OPEN_PANEL_TAB_EVENT, record)

    PanelTabs.request({ panelId: 'dshfiles-jujutsu', scope: 'tab:one', title: 'Jujutsu · welii' })

    expect(received).toEqual([{ type: OPEN_PANEL_TAB_EVENT, detail: { panelId: 'dshfiles-jujutsu', scope: 'tab:one', title: 'Jujutsu · welii' } }])
  })

  it('reads a malformed request as no request, and keeps the scope id on the tab', () => {
    const malformed = new CustomEvent(OPEN_PANEL_TAB_EVENT, { detail: { panelId: '', scope: 'a' } })

    expect(PanelTabs.readRequest(malformed)).toBeUndefined()
    expect(PanelTabs.readRequest(new Event(OPEN_PANEL_TAB_EVENT))).toBeUndefined()
    expect(PanelTabs.tabId('dshfiles-jujutsu', 'tab:one')).toBe('panel:dshfiles-jujutsu#tab:one')
  })

  it('announces the scope the main view shows, and none for the panel default', () => {
    window.addEventListener(PANEL_SCOPE_EVENT, record)

    PanelTabs.announce({ panelId: 'dshfiles-jujutsu', scope: 'tab:one' })
    PanelTabs.announce({ panelId: 'dshfiles-jujutsu' })

    expect(received.map(entry => entry.detail)).toEqual([
      { panelId: 'dshfiles-jujutsu', scope: 'tab:one' },
      { panelId: 'dshfiles-jujutsu', scope: null },
    ])
  })

  it('retitles a scoped tab from the panel that owns it', () => {
    window.addEventListener(PANEL_TAB_TITLE_EVENT, record)

    PanelTabs.publishTitle({ panelId: 'dshfiles-jujutsu', scope: 'tab:one', title: 'Jujutsu · dshfiles' })

    expect(PanelTabs.readTitle(new CustomEvent(PANEL_TAB_TITLE_EVENT, { detail: received[0]?.detail }))).toEqual({
      panelId: 'dshfiles-jujutsu',
      scope: 'tab:one',
      title: 'Jujutsu · dshfiles',
    })
  })

  it('reports the scoped tab on screen as what the main view shows, and a bare panel when another tab is active', () => {
    const scoped = { kind: 'panel' as const, panelId: 'dshfiles-jujutsu', scope: 'tab:one' }
    const active = { kind: 'panel' as const, panelId: 'dshfiles-jujutsu', scope: 'tab:two' }

    expect(PanelTabs.visibleTarget(scoped, active)).toEqual({ kind: 'panel', panelId: 'dshfiles-jujutsu', scope: 'tab:two' })
    expect(PanelTabs.visibleTarget({ kind: 'panel', panelId: 'dshfiles-jujutsu' }, { kind: 'thread', sessionId: 's' })).toEqual({
      kind: 'panel',
      panelId: 'dshfiles-jujutsu',
    })
    expect(PanelTabs.visibleTarget({ kind: 'panel', panelId: 'other' }, scoped)).toEqual({ kind: 'panel', panelId: 'other' })
    expect(PanelTabs.visibleTarget({ kind: 'thread', sessionId: 's' }, scoped)).toEqual({ kind: 'thread', sessionId: 's' })
    expect(PanelTabs.visibleTarget(null, scoped)).toBeNull()
  })
})

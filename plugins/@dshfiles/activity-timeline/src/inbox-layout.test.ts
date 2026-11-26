import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')

describe('inbox page layout', () => {
  it('shows a load failure with the kit LoadError, and no row claims aria-selected', () => {
    expect(panel).toContain('<LoadError subject=')
    expect(panel).not.toMatch(/aria-selected=/u)
  })

  it('fills its pane: no centred max-width column on the page (DESIGN.md, Layout)', () => {
    const pages = panel.match(/<Page\b[^>]*>/gu) ?? []
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) expect(page).not.toMatch(/mx-auto|max-w-/u)
  })

  it('keeps a readable measure on the text of a row instead', () => {
    // Council round 17 C1: one 36rem measure for the well, the prose and the answers.
    expect(InboxView.TEXT_MEASURE).toBe('dshx:max-w-xl')
    expect(panel).toContain('InboxView.TEXT_MEASURE')
  })

  it('keeps device alert settings behind the page menu, one step from the header, never under the list', () => {
    expect(InboxView.pageActions({ triagePrimary: false, alertSettings: true })).toEqual([
      { id: 'triage', placement: 'inline' },
      { id: 'alerts', placement: 'overflow' },
    ])
    // On a phone Start triage is the page's primary button; a browser with no alerts to set offers no entry.
    expect(InboxView.pageActions({ triagePrimary: true, alertSettings: true })).toEqual([{ id: 'alerts', placement: 'overflow' }])
    expect(InboxView.pageActions({ triagePrimary: false, alertSettings: false })).toEqual([{ id: 'triage', placement: 'inline' }])
    expect(panel).not.toMatch(/<InboxNotifications\.Toggle|<InboxPush\.Control/u)
    // Nothing open to triage: Start triage is not offered, rather than drawn disabled.
    expect(InboxView.pageActions({ triagePrimary: false, alertSettings: false, triageable: false })).toEqual([])
  })
})

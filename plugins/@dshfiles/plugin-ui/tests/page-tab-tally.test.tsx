// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Page, type PageTab } from '../src/components/page.js'

afterEach(cleanup)

const classes = (element: Element | null): readonly string[] => element?.className.split(/\s+/u) ?? []
const page = (needsYou: PageTab) =>
  render(
    <Page heading="Inbox" tabs={{ label: 'View', value: 'needs', onValueChange: () => undefined, items: [needsYou, { value: 'all', label: 'All', count: 9 }] }}>
      body
    </Page>,
  )

describe('a page tab whose count names its statuses (council round 10, phone Inbox)', () => {
  it('draws a StatusCount tally, attention first, on the phone shell only, and the plain count elsewhere', () => {
    const view = page({ value: 'needs', label: 'Needs you', count: 3, statusCounts: { failed: 1, 'needs-you': 2 } })
    const tab = view.getByRole('tab', { name: /Needs you/u })
    const tally = tab.querySelector('[data-slot="page-tab-status-counts"]')!
    expect(classes(tally)).toEqual(expect.arrayContaining(['dshx:hidden', 'dshx:in-data-shell-phone-nav:inline-flex']))
    expect([...tally.querySelectorAll('[data-slot="page-tab-status"]')].map(pair => [pair.getAttribute('data-status'), pair.textContent?.match(/\d+/u)?.[0]])).toEqual([
      ['needs-you', '2'],
      ['failed', '1'],
    ])
    // Compact inside a segment: glyph and number 4px apart, no pill fill or padding, a muted "·" between pairs.
    expect(tally.querySelector('[data-slot="status-count"]')).toBeNull()
    for (const pair of tally.querySelectorAll('[data-slot="page-tab-status"]')) {
      expect(classes(pair)).toContain('dshx:gap-1')
      expect(pair.className).not.toMatch(/(?:^| )dshx:(?:bg-|px-|rounded)/u)
      expect(pair.querySelector('.dshx\\:sr-only')?.textContent).toMatch(/Needs you|Failed/u)
    }
    const dots = [...tally.children].filter(child => child.getAttribute('aria-hidden') === 'true')
    expect(dots.map(dot => [dot.textContent, classes(dot)])).toEqual([['·', ['dshx:text-muted-foreground']]])
    expect(classes(tally)).toContain('dshx:tabular-nums')
    const plain = tab.querySelector('[data-slot="page-tab-count"]')!
    expect(plain.textContent).toBe('3')
    expect(classes(plain)).toContain('dshx:in-data-shell-phone-nav:hidden')
  })

  it('keeps the plain count in every shell with one status or none', () => {
    const view = page({ value: 'needs', label: 'Needs you', count: 2, statusCounts: { 'needs-you': 2, failed: 0 } })
    const tab = view.getByRole('tab', { name: /Needs you/u })
    expect(tab.querySelector('[data-slot="page-tab-status-counts"]')).toBeNull()
    expect(tab.textContent).toBe('Needs you2')
    expect(tab.innerHTML).not.toContain('in-data-shell-phone-nav')
  })

  it('leaves a tab without statusCounts as it was', () => {
    const view = page({ value: 'needs', label: 'Needs you', count: 4 })
    expect(view.getByRole('tab', { name: /Needs you/u }).querySelector('[data-slot="status-count"]')).toBeNull()
  })
})

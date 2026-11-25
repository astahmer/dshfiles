// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Page, type PageTab, type PageTabs } from '../src/components/page.js'
import { PageHeader } from '../src/components/ui/page-header.js'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'

afterEach(cleanup)

const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const classes = (element: Element | null | undefined): readonly string[] => element?.className.split(/\s+/u) ?? []
const tabs = (items: readonly PageTab[], variant?: 'underline' | 'segmented'): PageTabs => {
  const base: PageTabs = { label: 'Views', value: items[0]?.value ?? '', onValueChange: vi.fn(), items }
  return variant === undefined ? base : { ...base, variant }
}
const views = (n: number): readonly PageTab[] => Array.from({ length: n }, (_, index) => ({ value: `v${index}`, label: `View ${index}` }))

describe('page header (council round 3 A5)', () => {
  it('sets the one h1 at 22px and 650', () => {
    const view = render(<Page heading="Settings" />)
    expect(classes(view.getByRole('heading', { level: 1 }))).toEqual(expect.arrayContaining(['dshx:text-title', 'dshx:font-title']))
    expect(styles).toContain('--text-title: 1.375rem;')
    expect(styles).toContain('--text-title--line-height: 1.75rem;')
    expect(styles).toContain('--font-weight-title: 650;')
  })

  it('shows a plain count in tertiary ink', () => {
    const view = render(<Page heading="Hosts" count={3} />)
    expect(classes(view.container.querySelector('[data-slot="page-count"]'))).toContain('dshx:text-faint-foreground')
    expect(styles).toContain('--color-faint-foreground: var(--dsw-alias-label-tertiary);')
  })

  it('shows one StatusCount per status present instead, attention first, and no plain count', () => {
    const view = render(<Page heading="Inbox" count={3} statusCounts={{ ready: 4, failed: 1, 'needs-you': 2, idle: 0 }} />)
    const counts = view.container.querySelector('[data-slot="page-status-counts"]')!
    const chips = [...counts.querySelectorAll('[data-slot="status-count"]')]
    expect(chips.map(chip => chip.getAttribute('data-status'))).toEqual(['needs-you', 'failed', 'ready'])
    expect(view.container.querySelector('[data-slot="page-count"]')).toBeNull()
  })

  it.each<Scheme>(['light', 'dark'])('keeps the tertiary count at AA on bg and panel (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const step of [0, 1]) expect(PaletteMath.contrastRatio(p.neutral[8]!, p.neutral[step]!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('standalone PageHeader (council round 3 A5)', () => {
  it('follows the same rules for a page that owns its layout (Settings): h1, counts, 72ch description, trailing actions', () => {
    const view = render(
      <PageHeader heading="Settings" description="Accounts, tools, secrets and plugins." statusCounts={{ failed: 1 }}>
        <button type="button">Open config file</button>
      </PageHeader>,
    )
    const header = view.container.querySelector('[data-slot="page-header"]')!
    expect(classes(view.getByRole('heading', { level: 1 }))).toEqual(expect.arrayContaining(['dshx:text-title', 'dshx:font-title']))
    expect(classes(view.getByText('Accounts, tools, secrets and plugins.'))).toEqual(expect.arrayContaining(['dshx:max-w-[72ch]', 'dshx:text-sm']))
    expect(header.querySelector('[data-slot="status-count"]')?.getAttribute('data-status')).toBe('failed')
    expect(view.getByRole('button', { name: 'Open config file' }).closest('[data-slot="page-actions"]')).not.toBeNull()
    cleanup()
    // The old call shape still renders.
    const legacy = render(<PageHeader heading="Jobs" description="Background work." />)
    expect(legacy.getByRole('heading', { level: 1, name: 'Jobs' })).toBeTruthy()
    expect(legacy.container.querySelector('[data-slot="page-actions"]')).toBeNull()
  })
})

describe('page container (council round 3 A5)', () => {
  const container = (element: HTMLElement) => element.querySelector('[data-slot="page-container"]')

  it('caps a page at 1080px with header and body in one container, so actions sit on its trailing edge', () => {
    const view = render(
      <Page heading="Inbox" primaryAction={{ id: 'triage', label: 'Start triage', onSelect: vi.fn() }}>
        <p>body</p>
      </Page>,
    )
    const box = container(view.container)!
    expect(classes(box)).toContain('dshx:max-w-page')
    expect(view.getByRole('button', { name: 'Start triage' }).closest('[data-slot="page-container"]')).toBe(box)
    expect(view.getByText('body').closest('[data-slot="page-container"]')).toBe(box)
    expect(styles).toMatch(/--container-page: 67\.5rem;\s*--container-lane: 57\.5rem;/u)
  })

  it('takes a 920px lane for a list page and full bleed only on request (diff, chart, table)', () => {
    const lane = render(<Page heading="Plugins" width="lane" />)
    expect(classes(container(lane.container))).toContain('dshx:max-w-lane')
    cleanup()
    const full = render(<Page heading="Review" width="full" />)
    expect(classes(container(full.container)).join(' ')).not.toMatch(/max-w-/u)
  })

  it('lets a master-detail page (fill) use the whole pane unless it asks for a width', () => {
    const view = render(<Page heading="Memory" fill />)
    expect(classes(container(view.container)).join(' ')).not.toMatch(/max-w-/u)
  })
})

describe('page tabs (council round 3 A5)', () => {
  it('keeps the segmented control for up to four view modes', () => {
    const view = render(<Page heading="Inbox" tabs={tabs(views(3))} />)
    expect(view.getByRole('tablist').getAttribute('data-variant')).toBe('default')
  })

  it('draws page sections as underline tabs, with an accent bar under the active one', () => {
    const view = render(<Page heading="Backlog" tabs={tabs(views(3), 'underline')} />)
    const list = view.getByRole('tablist')
    expect(list.getAttribute('data-variant')).toBe('line')
    expect(classes(list)).toEqual(expect.arrayContaining(['dshx:border-b', 'dshx:border-border']))
    expect(classes(view.getAllByRole('tab')[0])).toContain('dshx:after:bg-info')
  })

  it('never draws a segmented control past four items', () => {
    const view = render(<Page heading="Backlog" tabs={tabs(views(7), 'segmented')} />)
    expect(view.getByRole('tablist').getAttribute('data-variant')).toBe('line')
    cleanup()
    const auto = render(<Page heading="Backlog" tabs={tabs(views(5))} />)
    expect(auto.getByRole('tablist').getAttribute('data-variant')).toBe('line')
  })
})

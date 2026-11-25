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
/**
 * A theme token's size in CSS px under the Host page, whose root font is about 12.5px rather than 16 (a rem token came
 * out at 796px instead of 1080 in a capture): px values hold, rem values scale with that root.
 */
const HOST_ROOT_PX = 12.5
const resolved = (token: string): number => {
  const value = new RegExp(`${token}: ([\\d.]+)(px|rem);`, 'u').exec(styles)
  if (value === null) return Number.NaN
  return Number(value[1]) * (value[2] === 'rem' ? HOST_ROOT_PX : 1)
}
const views = (n: number): readonly PageTab[] => Array.from({ length: n }, (_, index) => ({ value: `v${index}`, label: `View ${index}` }))

describe('page header (council round 3 A5)', () => {
  it('sets the one h1 at 22px and 650', () => {
    const view = render(<Page heading="Settings" />)
    expect(classes(view.getByRole('heading', { level: 1 }))).toEqual(expect.arrayContaining(['dshx:text-title', 'dshx:font-title']))
    expect(resolved('--text-title')).toBe(22)
    expect(resolved('--text-title--line-height')).toBe(28)
    expect(styles).toContain('--font-weight-title: 650;')
  })

  it('offers one contextual heading step, 15/20 at 600, for in-page section headings (council round 4 A4)', () => {
    expect(resolved('--text-heading')).toBe(15)
    expect(resolved('--text-heading--line-height')).toBe(20)
    expect(styles).toContain('--text-heading--font-weight: 600;')
  })

  it('offers a 16/22 query step for a palette search field, at the body weight (council round 4 B7)', () => {
    expect(resolved('--text-query')).toBe(16)
    expect(resolved('--text-query--line-height')).toBe(22)
    expect(styles).not.toContain('--text-query--font-weight')
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
    // Computed under the Host's root font: the caps are px, not rem.
    expect(resolved('--container-page')).toBe(1080)
    expect(resolved('--container-lane')).toBe(880)
    expect(resolved('--container-wide')).toBe(1200)
  })

  it('takes a 880px lane for a list page and full bleed only on request (diff, chart, table)', () => {
    const lane = render(<Page heading="Plugins" width="lane" />)
    expect(classes(container(lane.container))).toContain('dshx:max-w-lane')
    cleanup()
    const full = render(<Page heading="Review" width="full" />)
    expect(classes(container(full.container)).join(' ')).not.toMatch(/max-w-/u)
  })

  it('offers two frames (council round 5 A2): lane 880 for lists and forms, wide min(100%, 1200px) for data, same start inset', () => {
    const lane = render(<Page heading="Inbox" width="lane" />)
    const laneBox = container(lane.container)!
    cleanup()
    const wide = render(<Page heading="Usage" width="wide" primaryAction={{ id: 'refresh', label: 'Refresh', onSelect: vi.fn() }} />)
    const wideBox = container(wide.container)!
    expect(classes(wideBox)).toEqual(expect.arrayContaining(['dshx:w-full', 'dshx:max-w-wide']))
    // Neither frame centres: both start at the pane's 24px inset, so the two page kinds line up.
    for (const box of [laneBox, wideBox]) {
      expect(classes(box)).toContain('dshx:p-6')
      expect(classes(box).join(' ')).not.toMatch(/mx-auto|justify-center|items-center/u)
    }
    // Header actions sit on the frame's trailing edge.
    expect(wide.getByRole('button', { name: 'Refresh' }).closest('[data-slot="page-container"]')).toBe(wideBox)
    // At a 1440px pane: min(100%, cap). The frame is the content box plus its padding (border-box).
    const frame = (pane: number, cap: number): number => Math.min(pane, cap)
    expect(frame(1440, resolved('--container-lane'))).toBe(880)
    expect(frame(1440, resolved('--container-wide'))).toBe(1200)
    expect(frame(1000, resolved('--container-wide'))).toBe(1000)
  })

  it('caps the lane CONTENT at 880px, 960px on a pane of 1280px or more, with the padding outside (council round 6 A3)', () => {
    const lane = render(<Page heading="Inbox" width="lane" />)
    const box = container(lane.container)!
    // The cap applies to the content box: Inbox and Backlog rows end where Plugins rows (core-plugins.css) end.
    expect(classes(box)).toEqual(expect.arrayContaining(['dshx:box-content', 'dshx:max-w-lane', 'dshx:@min-pane-wide:max-w-lane-wide']))
    expect(classes(box)).toContain('dshx:p-6')
    // The pane tier is the Page root's own width (it is the @container), in px so the Host's root font cannot move it.
    expect(classes(lane.container.querySelector('[data-slot="page"]'))).toContain('dshx:@container')
    expect(resolved('--container-pane-wide')).toBe(1280)
    expect(resolved('--container-lane-wide')).toBe(960)
    // Content width at a given pane: min(pane - 2 × 24px padding, cap), the cap 960 from a 1280px pane up.
    const content = (pane: number): number => Math.min(pane - 48, pane >= resolved('--container-pane-wide') ? resolved('--container-lane-wide') : resolved('--container-lane'))
    expect(content(1440)).toBe(960)
    expect(content(1279)).toBe(880)
    expect(content(900)).toBe(852)
    // Still start-aligned, never centred.
    expect(classes(box).join(' ')).not.toMatch(/mx-auto|justify-center|items-center/u)
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

  it('draws page sections as underline tabs, with an ink bar under the active one', () => {
    const view = render(<Page heading="Backlog" tabs={tabs(views(3), 'underline')} />)
    const list = view.getByRole('tablist')
    expect(list.getAttribute('data-variant')).toBe('line')
    expect(classes(list)).toEqual(expect.arrayContaining(['dshx:border-b', 'dshx:border-border']))
    expect(classes(view.getAllByRole('tab')[0])).toContain('dshx:after:bg-foreground')
    expect(classes(view.getAllByRole('tab')[0])).not.toContain('dshx:after:bg-info')
  })

  it('never draws a segmented control past four items', () => {
    const view = render(<Page heading="Backlog" tabs={tabs(views(7), 'segmented')} />)
    expect(view.getByRole('tablist').getAttribute('data-variant')).toBe('line')
    cleanup()
    const auto = render(<Page heading="Backlog" tabs={tabs(views(5))} />)
    expect(auto.getByRole('tablist').getAttribute('data-variant')).toBe('line')
  })
})

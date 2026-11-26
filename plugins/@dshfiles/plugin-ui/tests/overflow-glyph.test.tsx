// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalRun } from '../src/components/motion/approval-run.js'
import { Page } from '../src/components/page.js'
import { BreadcrumbEllipsis } from '../src/components/ui/breadcrumb.js'
import { OverflowGlyph } from '../src/components/ui/overflow-glyph.js'
import { TooltipProvider } from '../src/components/ui/tooltip.js'

afterEach(cleanup)

/** One ⋯: lucide's horizontal ellipsis, 16px through the kit's size class and the attributes, stroke 2. */
const expectOneGlyph = (svg: Element | null | undefined): void => {
  expect(svg, 'an overflow glyph').toBeTruthy()
  expect(svg?.getAttribute('data-slot')).toBe('overflow-glyph')
  expect(svg?.getAttribute('class')).toContain('lucide-ellipsis')
  expect(svg?.getAttribute('class')?.split(/\s+/)).toContain('dshx:size-4')
  expect(svg?.getAttribute('width')).toBe('16')
  expect(svg?.getAttribute('stroke-width')).toBe('2')
  expect(svg?.getAttribute('aria-hidden')).toBe('true')
}

describe('OverflowGlyph (council round 15 A2)', () => {
  it('draws one 16px stroke-2 ⋯ and keeps its size and stroke against a caller class', () => {
    const view = render(<OverflowGlyph className="dshx:size-3 dshx:text-muted-foreground" />)
    const svg = view.container.querySelector('svg')
    expectOneGlyph(svg)
    expect(svg?.getAttribute('class')).not.toContain('dshx:size-3 ')
    expect(svg?.getAttribute('class')).toContain('dshx:text-muted-foreground')
  })

  it('is the glyph of every kit overflow trigger: the page header, an approval run (an icon-xs button) and the breadcrumb', () => {
    const page = render(<Page heading="Hosts" actions={[{ id: 'export', label: 'Export', onSelect: vi.fn(), placement: 'overflow' }]} />)
    expectOneGlyph(page.getByRole('button', { name: 'More actions' }).querySelector('svg'))
    page.unmount()

    const run = render(
      <TooltipProvider>
        <ApprovalRun heading="Deploy" state="working" steps={[]} totalSteps={1} startedAt={0} onMenu={vi.fn()} />
      </TooltipProvider>,
    )
    expectOneGlyph(run.getByRole('button', { name: 'Run actions' }).querySelector('svg'))
    run.unmount()

    const crumbs = render(<BreadcrumbEllipsis />)
    expectOneGlyph(crumbs.container.querySelector('svg'))
  })
})

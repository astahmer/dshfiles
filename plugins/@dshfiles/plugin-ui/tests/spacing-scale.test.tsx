// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Page, PageSection } from '../src/components/page.js'

afterEach(cleanup)

const classes = (element: Element | null | undefined): readonly string[] => (element?.getAttribute('class') ?? '').split(/\s+/)

describe('page spacing scale (round five K9)', () => {
  it('pads a page 24px, puts 20px between its header and sections, and stacks the body at 16px', () => {
    const view = render(
      <Page heading="Usage">
        <PageSection heading="Today">rows</PageSection>
        <PageSection heading="This week">rows</PageSection>
      </Page>,
    )
    const page = view.container.querySelector('[data-slot="page"]')
    const column = page?.firstElementChild
    expect(classes(column)).toEqual(expect.arrayContaining(['dshx:p-6', 'dshx:gap-5']))
    expect(classes(column)).not.toContain('dshx:p-5')
    // Narrow panes and phones keep the compact 12px.
    expect(classes(column)).toEqual(expect.arrayContaining(['dshx:@max-pane-narrow:p-3', 'dshx:@max-pane-narrow:gap-3']))
    expect(classes(view.container.querySelector('[data-slot="page-body"]'))).toContain('dshx:gap-4')
  })
})

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { BacklogViewSwitch } from './backlog-toolbar.js'

const tabClasses = (markup: string, current: boolean): string =>
  (current ? /<button type="button" aria-current="page" class="([^"]*)"/u : /<button type="button" class="([^"]*)"/u).exec(markup)?.[1] ?? ''

describe('Backlog view tabs (council round 6, D6)', () => {
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      <BacklogViewSwitch view="feed" onSelect={() => undefined} modifierHeld={false} />
    </TooltipProvider>,
  )
  // The kit's underline tab (`Page` tabs, plugin-ui page.tsx): a square 2 px ink bar on the strip's hairline, the
  // same as the window tab strip (council round 7, D6: indigo is attention, focus and links only).
  const kit = readFileSync(new URL('../../plugin-ui/src/components/page.tsx', import.meta.url), 'utf8')

  it('draws the kit underline bar under the active tab: 2 px, ink, square, on the hairline', () => {
    const active = tabClasses(markup, true)
    expect(kit).toContain('dshx:after:bg-foreground')
    for (const look of [
      'dshx:after:absolute',
      'dshx:after:inset-x-0',
      'dshx:after:bottom-[-1px]',
      'dshx:after:h-0.5',
      'dshx:after:bg-foreground',
      'dshx:after:opacity-100',
    ])
      expect(active).toContain(look)
    expect(active).not.toContain('--dsw-alias-state-business-primary')
    expect(active).not.toContain('dshx:after:rounded-full')
    expect(active).toContain('dshx:text-foreground')
  })

  it('draws no bar under an inactive tab', () => {
    const inactive = tabClasses(markup, false)
    expect(inactive).toContain('dshx:after:opacity-0')
    expect(inactive).toContain('dshx:text-muted-foreground')
  })
})

describe('Backlog search field (council round 6, A2)', () => {
  it("draws the fields' 3:1 boundary, like every kit field", () => {
    const panel = readFileSync(new URL('backlog-panel.tsx', import.meta.url), 'utf8')
    const search = panel.slice(panel.lastIndexOf('<label', panel.indexOf('aria-label="Search backlog"')), panel.indexOf('aria-label="Search backlog"'))
    expect(search).toContain('dshx:border-field-border')
    expect(search).not.toContain('dshx:border-input')
  })
  it("shares the kit field's 8 px corner with the View and Filter triggers beside it (council round 8, D2)", () => {
    const panel = readFileSync(new URL('backlog-panel.tsx', import.meta.url), 'utf8')
    const search = panel.slice(panel.lastIndexOf('<label', panel.indexOf('aria-label="Search backlog"')), panel.indexOf('aria-label="Search backlog"'))
    expect(search).toContain('dshx:rounded-lg')
    expect(search).not.toContain('dshx:rounded-md')
  })
})

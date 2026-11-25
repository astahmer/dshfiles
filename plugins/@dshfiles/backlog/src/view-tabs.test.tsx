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
  // The kit's underline tab (`Page` tabs, plugin-ui page.tsx): a square 2 px accent bar on the strip's hairline.
  const kit = readFileSync(new URL('../../plugin-ui/src/components/page.tsx', import.meta.url), 'utf8')

  it('draws the kit underline bar under the active tab: 2 px, accent, square, on the hairline', () => {
    const active = tabClasses(markup, true)
    // The kit bar is `bg-info`, which the kit maps to the accent token; Backlog names the token itself (a status fill
    // class outside the kit is flagged by check:design-tokens).
    expect(kit).toContain('dshx:after:bg-info')
    const styles = readFileSync(new URL('../../plugin-ui/src/styles.css', import.meta.url), 'utf8')
    expect(styles).toContain('--color-info: var(--dsw-alias-state-business-primary);')
    for (const look of [
      'dshx:after:absolute',
      'dshx:after:inset-x-0',
      'dshx:after:bottom-[-1px]',
      'dshx:after:h-0.5',
      'dshx:after:bg-(--dsw-alias-state-business-primary)',
      'dshx:after:opacity-100',
    ])
      expect(active).toContain(look)
    expect(active).not.toContain('dshx:after:rounded-full')
    expect(active).toContain('dshx:text-foreground')
  })

  it('draws no bar under an inactive tab', () => {
    const inactive = tabClasses(markup, false)
    expect(inactive).toContain('dshx:after:opacity-0')
    expect(inactive).toContain('dshx:text-muted-foreground')
  })
})

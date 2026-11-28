import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Switch } from '../src/components/ui/switch.js'
import { Tooltip, TooltipProvider, TooltipTrigger } from '../src/components/ui/tooltip.js'

const inTooltip = (control: ReactElement): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
      </Tooltip>
    </TooltipProvider>,
  )

const rootClasses = (html: string): string => /^<button[^>]*class="([^"]*)"/u.exec(html)?.[1] ?? ''

describe('kit toggles keep their on state inside a tooltip trigger (council picker round 1, C2)', () => {
  it('draws the switch track from aria-checked, since the trigger overwrites data-state', () => {
    const html = inTooltip(<Switch checked aria-label="Fast mode" />)
    // The clobbering this guards against: the root says the tooltip is closed, not that the switch is on.
    expect(html).toMatch(/^<button[^>]*data-state="closed"/u)
    expect(html).toMatch(/^<button[^>]*aria-checked="true"/u)
    const classes = rootClasses(html)
    expect(classes).toContain('dshx:aria-checked:bg-control-on')
    expect(classes).toContain('dshx:aria-[checked=false]:bg-input')
    expect(classes).not.toMatch(/data-\[state=(?:un)?checked\]:/u)
  })
})

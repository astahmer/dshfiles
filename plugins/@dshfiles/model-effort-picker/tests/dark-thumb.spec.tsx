import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { EffortControl } from '../src/effort-control.js'

describe('the dark selected effort segment stands off its track (council picker round 6, V10)', () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <EffortControl efforts={[{ id: 'low', name: 'Low' }]} onChange={() => undefined} selected="low" />
    </TooltipProvider>,
  )

  it("lifts the thumb a tone in dark within the picker's own group, not the kit token", () => {
    expect(/<div[^>]*role="radiogroup"[^>]*>/u.exec(html)?.[0]).toContain('dshx:dark:[--dshx-segment-thumb:var(--dshx-tone-5)]')
  })

  it('gives the selected segment a 1 px top highlight in dark', () => {
    expect(/<button[^>]*aria-checked="true"[^>]*>/u.exec(html)?.[0]).toContain('dshx:dark:[box-shadow:inset_0_1px_0_color-mix(in_oklab,var(--dsw-alias-label-primary)_6%,transparent)]!')
  })
})

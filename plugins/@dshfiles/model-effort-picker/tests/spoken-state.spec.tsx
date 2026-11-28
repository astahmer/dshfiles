import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { AccountRows } from '../src/account-rows.js'
import { EffortControl } from '../src/effort-control.js'

describe('spoken state (council picker round 6, V8)', () => {
  it('names an account radio with its default and its quota', () => {
    const html = renderToStaticMarkup(
      <AccountRows
        accents={new Map()}
        accounts={[
          { id: 'cc1', name: 'Command Code 1' },
          { id: 'cc2', name: 'Command Code 2' },
        ]}
        defaultId="cc1"
        onChoose={() => undefined}
        quotas={new Map([['cc1', { percent: 62, label: 'Weekly limit', onReserve: false }]])}
        selected="cc1"
      />,
    )
    expect(html).toContain('aria-label="Command Code 1, default account, 62 % weekly quota left"')
    expect(html).toContain('aria-label="Command Code 2, quota unknown"')
  })

  it('calls Xhigh "Extra high", keeping the visible word in its name', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <EffortControl efforts={[{ id: 'xhigh', name: 'Xhigh' }]} onChange={() => undefined} selected="xhigh" />
      </TooltipProvider>,
    )
    expect(html).toContain('aria-label="XHigh, Extra high"')
  })

  it('announces a staged level as staged, and moves the fallback key hint to a description', () => {
    expect(readFileSync(new URL('../src/model-details.tsx', import.meta.url), 'utf8')).toContain('staged={draft}')
    const fallbacks = readFileSync(new URL('../src/fallbacks-section.tsx', import.meta.url), 'utf8')
    expect(fallbacks).not.toContain('Alt+Arrow to reorder.`}')
    expect(fallbacks).toContain('aria-describedby={`${listId}-reorder`}')
  })
})

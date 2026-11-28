import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { EffortControl } from '../src/effort-control.js'

const levels = (count: number) => ['Off', 'Minimal', 'Low', 'Medium', 'High', 'Xhigh', 'Max'].slice(0, count).map(name => ({ id: name.toLowerCase(), name }))
const radios = (count: number): string[] =>
  [
    ...renderToStaticMarkup(
      <TooltipProvider>
        <EffortControl efforts={levels(count)} onChange={() => undefined} selected={undefined} />
      </TooltipProvider>,
    ).matchAll(/<button[^>]*role="radio"[^>]*>/gu),
  ].map(match => match[0])

describe('eight effort levels (council picker round 6, V1)', () => {
  it('gives no scrollbar width to the details body on touch, so its effort track is as wide as a still body', () => {
    const details = readFileSync(new URL('../src/model-details.tsx', import.meta.url), 'utf8')
    expect(details).toContain('dshx:pointer-coarse:[scrollbar-width:none] dshx:pointer-coarse:[&::-webkit-scrollbar]:hidden')
  })

  it('sets eight levels at 11 px with a 2 px inset on desktop, seven at 12 px', () => {
    expect(radios(7)).toHaveLength(8)
    for (const radio of radios(7)) expect(radio).toMatch(/dshx:px-0\.5 dshx:text-2xs/u)
    for (const radio of radios(6)) expect(radio).toMatch(/dshx:px-1 dshx:text-xs/u)
  })
})

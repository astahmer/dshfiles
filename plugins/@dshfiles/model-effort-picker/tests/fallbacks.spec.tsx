import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FallbackList, type FallbackRow } from '../src/fallbacks-section.js'

const text = (html: string): string => html.replace(/<[^>]+>/gu, '')
const noop = (): void => undefined
const rows: readonly FallbackRow[] = [
  {
    id: 'cc2/gpt-6-luna',
    model: 'gpt-6-luna',
    brand: 'openai',
    account: 'Command Code 2',
    tag: 'CC2',
    color: '#0E7490',
    quota: { percent: 12, label: 'Weekly limit', onReserve: false },
    serving: false,
  },
  { id: 'codex/gpt-6-luna', model: 'gpt-6-luna', brand: 'openai', account: 'Codex 1', tag: 'C1', color: '#10A37F', quota: undefined, serving: false },
]

const render = (input: { readonly rows?: readonly FallbackRow[]; readonly expanded: boolean }): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <FallbackList
        canAdd
        disabled={false}
        error={null}
        expanded={input.expanded}
        onAdd={noop}
        onExpandedChange={noop}
        onMove={noop}
        onRemove={noop}
        onReturn={noop}
        onPolicyChange={noop}
        onUseDefault={noop}
        returnPolicy="stay"
        rows={input.rows ?? rows}
        serving={null}
        threadChain
      />
    </TooltipProvider>,
  )

describe('fallbacks collapse to one line (council picker N5)', () => {
  it('collapses to "Fallbacks · 2 routes", with nothing else drawn', () => {
    const html = render({ expanded: false })
    expect(/<button[^>]*data-model-fallbacks-toggle[^>]*>/u.exec(html)?.[0]).toContain('aria-expanded="false"')
    expect(text(html)).toContain('Fallbacks · 2 routes')
    expect(html).not.toContain('<ol')
    expect(text(html)).not.toContain('Add fallback')
  })

  it('expands to one numbered list: a rank column before the mark, the account tag and the quota trailing', () => {
    const html = render({ expanded: true })
    const rungs = [...html.matchAll(/<li[^>]*data-model-fallback-rung[^>]*>.*?<\/li>/gu)].map(match => match[0])
    expect(rungs).toHaveLength(2)
    const first = rungs[0] ?? ''
    expect(/<span[^>]*data-model-fallback-rank[^>]*>/u.exec(first)?.[0]).toMatch(/dshx:w-4/u)
    expect(first.indexOf('data-model-fallback-rank')).toBeLessThan(first.indexOf('data-model-mark'))
    expect(text(first)).toMatch(/^1gpt-6-lunaCC212%/u)
    expect(text(rungs[1] ?? '')).toContain('—')
  })

  it('puts the return policy under the list and Add fallback always last', () => {
    const html = render({ expanded: true })
    expect(text(html)).toContain('After a fallback answers:')
    expect(html).toContain('data-model-fallback-policy-select')
    expect(html.indexOf('data-model-fallback-policy')).toBeGreaterThan(html.indexOf('</ol>'))
    expect(html.indexOf('data-model-fallback-add')).toBeGreaterThan(html.indexOf('data-model-fallback-policy'))
  })

  it('hides the return policy with no routes, keeping Add fallback in the same place', () => {
    const html = render({ rows: [], expanded: true })
    expect(text(html)).toContain('Fallbacks · none')
    expect(html).not.toContain('data-model-fallback-policy')
    expect(html).toContain('data-model-fallback-add')
  })

  it('offers the return policy as a visible small select and names the reset for what it does (round 3 R15)', () => {
    const html = render({ expanded: true })
    const trigger = /<button[^>]*data-model-fallback-policy-select[^>]*>.*?<\/button>/u.exec(html)?.[0] ?? ''
    expect(trigger).toContain('role="combobox"')
    expect(trigger).toContain('aria-label="After a fallback answers"')
    expect(trigger).toMatch(/<svg[^>]*lucide-chevron-down/u)
    expect(text(html)).toContain('Reset to default chain')
    expect(text(html)).not.toContain('Use default')
  })

  it('explains the chain in one sentence on touch, where the help icon is hidden (round 5 U11)', () => {
    const html = render({ expanded: true })
    expect(/<p[^>]*data-model-fallbacks-help[^>]*>([^<]*)</u.exec(html)?.[1]?.trim()).toBe(
      'Priority distribution tries these routes in order if the request fails.',
    )
    expect(/<p[^>]*data-model-fallbacks-help[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:hidden[^"]*dshx:pointer-coarse:block/u)
    expect(render({ expanded: false })).not.toContain('data-model-fallbacks-help')
  })
})

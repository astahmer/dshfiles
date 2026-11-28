import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelRow } from '../src/model-row.js'

const row = (input: { readonly active?: boolean; readonly selectSeveral?: boolean; readonly fastOn?: boolean }): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelRow
        accountTag="CC1"
        active={input.active ?? false}
        busy={false}
        current={null}
        fanOutSelected={false}
        fastOn={input.fastOn ?? false}
        group={{ id: 'cc1', name: 'Command Code 1', models: [] }}
        model={{ id: 'mistral-large-3-instruct-2512-extended-context-preview', name: 'mistral', description: '' }}
        onFanOut={() => undefined}
        onInspect={() => undefined}
        onSelect={() => undefined}
        providerLabel="Command Code"
        quota={{ percent: 62, label: 'Weekly limit', onReserve: false }}
        selectSeveral={input.selectSeveral ?? false}
      />
    </TooltipProvider>,
  )
describe('names come before labels in the list (council picker round 3, R3)', () => {
  it('labels a row with its short account tag, muted and fixed, never the service name on every row', () => {
    const html = row({})
    const tag = /<span[^>]*data-model-row-account(?!-)[^>]*>([^<]*)</u.exec(html)
    expect(tag?.[1]).toBe('CC1')
    expect(tag?.[0]).toMatch(/dshx:text-xs dshx:text-muted-foreground/u)
    expect(html).not.toContain('data-model-provider-label')
    // Round 4 T12: the account (which names its service) is in the option's accessible name.
    expect(/<div[^>]*role="option"[^>]*>/u.exec(html)?.[0]).toContain('aria-label="mistral-large-3-instruct-2512-extended-context-preview, Command Code 1"')
  })

  it('lets the name take the room first, at 13 px', () => {
    expect(/<span[^>]*data-model-picker-name[^>]*>/u.exec(row({}))?.[0]).toMatch(/dshx:min-w-0 dshx:flex-\[1_1_auto\] dshx:overflow-hidden dshx:text-sm/u)
  })

  it('reserves the check slot on every row and puts the bolt next to the name (round 4 T7 supersedes round 3)', () => {
    expect(row({})).toContain('data-model-row-check-slot')
    const html = row({ active: true, fastOn: true })
    expect(html.indexOf('data-model-fast-on')).toBeLessThan(html.indexOf('data-model-row-account-slot'))
  })

  it('keeps the brand mark after the checkbox in select mode', () => {
    const html = row({ selectSeveral: true })
    expect(html.indexOf('data-model-fan-out-check')).toBeGreaterThan(-1)
    expect(html.indexOf('data-model-mark')).toBeGreaterThan(html.indexOf('data-model-fan-out-check'))
  })
})

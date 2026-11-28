import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { AccountColor } from '../src/account-color.js'
import { ModelRow } from '../src/model-row.js'

const row = (input: { readonly active?: boolean; readonly fastOn?: boolean }): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelRow
        accountAccent={AccountColor.of({ instanceId: 'cc1' })}
        accountTag="CC1"
        active={input.active ?? false}
        busy={false}
        current={null}
        fanOutSelected={false}
        fastOn={input.fastOn ?? false}
        group={{ id: 'cc1', name: 'Command Code 1', models: [] }}
        model={{ id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' }}
        onFanOut={() => undefined}
        onInspect={() => undefined}
        onSelect={() => undefined}
        providerLabel="Command Code"
        quota={{ percent: 62, label: 'Weekly limit', onReserve: false }}
      />
    </TooltipProvider>,
  )
const trailing = (html: string): string => html.slice(html.indexOf('data-model-row-account-slot'))

describe('fixed trailing columns (council picker round 4, T7)', () => {
  it('draws the same trailing slots, in the same order, whether or not the row is in use or Fast', () => {
    const slots = (html: string): string[] =>
      [...trailing(html).matchAll(/data-model-(row-account-slot|picker-quota|row-check-slot)/gu)].map(match => match[1] ?? '')
    expect(slots(row({}))).toEqual(['row-account-slot', 'picker-quota', 'row-check-slot'])
    expect(slots(row({ active: true, fastOn: true }))).toEqual(slots(row({})))
    expect(/<span[^>]*data-model-row-account-slot[^>]*>/u.exec(row({}))?.[0]).toMatch(/dshx:w-12 dshx:shrink-0/u)
  })

  it('keeps the bolt next to the name, out of the trailing columns', () => {
    const html = row({ fastOn: true })
    expect(html.indexOf('data-model-fast-on')).toBeGreaterThan(html.indexOf('data-model-picker-name'))
    expect(trailing(html)).not.toContain('data-model-fast-on')
  })

  it("puts the account's dot before its tag in the list and the tray, as on the trigger", () => {
    const html = row({})
    expect(trailing(html).indexOf('data-account-dot')).toBeLessThan(trailing(html).search(/data-model-row-account(?!-)/u))
    expect(readFileSync(new URL('../src/fan-out-bar.tsx', import.meta.url), 'utf8')).toMatch(/<AccountDot accent=\{accent\}/u)
  })

  it('orders the trigger mark, account, name, then the bolt', () => {
    const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')
    const at = (marker: string): number => picker.indexOf(marker, picker.indexOf('data-model-trigger'))
    expect(at('data-model-picker-provider')).toBeLessThan(at('data-model-picker-text'))
    expect(at('data-model-picker-text')).toBeLessThan(at('<FastModeIndicator'))
  })
})

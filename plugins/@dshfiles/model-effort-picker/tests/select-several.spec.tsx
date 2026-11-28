import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FanOutBar } from '../src/fan-out-bar.js'
import { englishModelPicker } from '../src/locales.js'
import { ModelRow } from '../src/model-row.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const text = (html: string): string => html.replace(/<[^>]+>/gu, '')
const noop = (): void => undefined
const bar = (count: number): string => renderToStaticMarkup(<FanOutBar count={count} limit={6} onClear={noop} onFanOut={noop} t={englishModelPicker} />)
const row = (fanOutSelected: boolean): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelRow
        active={false}
        busy={false}
        current={null}
        fanOutSelected={fanOutSelected}
        group={{ id: 'cc1', name: 'Command Code 1', models: [] }}
        model={{ id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', description: '' }}
        onFanOut={noop}
        onInspect={noop}
        onSelect={noop}
        providerLabel="Command Code"
        quota={undefined}
        selectSeveral
      />
    </TooltipProvider>,
  )

describe('select several is a mode with checkboxes and an action bar (council picker N6)', () => {
  it('shows the action bar only once a row is chosen, counting against the limit', () => {
    expect(bar(0)).toBe('')
    expect(text(bar(2))).toMatch(/^2 of 6 selectedClearFan out…$/u)
    expect(/<button[^>]*>Fan out…<\/button>/u.exec(bar(2))?.[0]).not.toMatch(/\sdisabled=""/u)
  })

  it('says why Fan out waits with one model chosen', () => {
    const html = bar(1)
    expect(/<button[^>]*>Fan out…<\/button>/u.exec(html)?.[0]).toMatch(/\sdisabled=""/u)
    expect(text(html)).toContain('Choose at least two models.')
  })

  it('puts a 16 px checkbox in the mark column, with no chevron, in select mode', () => {
    const checked = row(true)
    expect(/<span[^>]*data-model-fan-out-check[^>]*>/u.exec(checked)?.[0]).toMatch(/dshx:size-4/u)
    expect(checked).not.toContain('data-model-mark')
    expect(checked).not.toContain('data-model-details-trigger')
    expect(/<div[^>]*role="option"[^>]*>/u.exec(checked)?.[0]).toContain('aria-checked="true"')
  })

  it('enters the mode from an icon button beside the search, hides the inspector and drops the shift-click tip', () => {
    const picker = source('model-effort-picker.tsx')
    expect(picker).toMatch(/aria-pressed=\{several\}[\s\S]{0,200}data-model-select-several/u)
    expect(picker.indexOf('data-model-select-several')).toBeGreaterThan(picker.indexOf('<SearchInput'))
    expect(picker.indexOf('data-model-select-several')).toBeLessThan(picker.indexOf('<ScrollArea'))
    expect(picker).toMatch(/\(catalogEmpty \|\| several\) && 'dshx:hidden'/u)
    expect(source('locales.ts')).not.toMatch(/Shift-click|long-press/u)
  })
})

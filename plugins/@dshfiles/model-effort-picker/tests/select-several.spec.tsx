import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FanOutSelection } from '../src/fan-out-bar.js'
import { englishModelPicker } from '../src/locales.js'
import { ModelRow } from '../src/model-row.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const text = (html: string): string => html.replace(/<[^>]+>/gu, '')
const noop = (): void => undefined
const groups = [
  {
    id: 'cc1',
    name: 'Command Code 1',
    models: [
      { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', description: '' },
      { id: 'google/gemini-3.8-flash', name: 'google/gemini-3.8-flash', description: '' },
    ],
  },
]
const routes = (count: number) =>
  [
    { provider: 'cc1', model: 'claude-sonnet-5-5' },
    { provider: 'cc1', model: 'google/gemini-3.8-flash' },
  ].slice(0, count)
const selection = (variant: 'bar' | 'tray', count: number): string =>
  renderToStaticMarkup(
    <FanOutSelection
      accountTagOf={() => 'CC1'}
      groups={groups}
      limit={6}
      onClear={noop}
      onFanOut={noop}
      onRemove={noop}
      routes={routes(count)}
      t={englishModelPicker}
      variant={variant}
    />,
  )
const fanOutButton = (html: string): string => /<button[^>]*>Fan out…<\/button>/u.exec(html)?.[0] ?? ''
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
  it('puts a 16 px checkbox in the mark column, with no chevron, in select mode', () => {
    const checked = row(true)
    expect(/<span[^>]*data-model-fan-out-check[^>]*>/u.exec(checked)?.[0]).toMatch(/dshx:size-4/u)
    expect(checked.indexOf('data-model-mark')).toBeGreaterThan(checked.indexOf('data-model-fan-out-check'))
    expect(checked).not.toContain('data-model-details-trigger')
    expect(/<div[^>]*role="option"[^>]*>/u.exec(checked)?.[0]).toContain('aria-checked="true"')
  })

  it('drops the shift-click tip', () => {
    expect(source('locales.ts')).not.toMatch(/Shift-click|long-press/u)
  })
})

describe('select mode keeps the list and turns details into a tray (council picker round 3, R12)', () => {
  it('keeps the 360 px list on desktop and shows the tray in the details pane, the bar only on a narrow screen', () => {
    const picker = source('model-effort-picker.tsx')
    expect(picker).not.toMatch(/several\) && 'dshx:w-full'|\(catalogEmpty \|\| several\)/u)
    expect(picker).toMatch(/\{several \? \(\s*<FanOutSelection[\s\S]{0,600}variant="tray"/u)
    expect(picker).toMatch(/className="dshx:hidden dshx:@max-pane-compact:flex"[\s\S]{0,600}variant="bar"/u)
  })

  it('lists the chosen models as chips with their marks, counts them against the limit and says why Fan out waits', () => {
    const tray = selection('tray', 1)
    expect(tray.match(/data-model-fan-out-chip(?!s)/gu) ?? []).toHaveLength(1)
    expect(tray).toContain('data-model-mark')
    expect(text(tray)).toContain('1 selected · up to 6')
    expect(fanOutButton(tray)).toMatch(/\sdisabled=""/u)
    expect(text(tray)).toContain('Choose at least two models.')
    const ready = selection('tray', 2)
    expect(fanOutButton(ready)).not.toMatch(/\sdisabled=""/u)
    expect(text(ready)).toContain('gemini-3.8-flash')
  })

  it('announces the count politely and reserves the reason line, so choosing never moves the actions', () => {
    for (const html of [selection('bar', 0), selection('bar', 2), selection('tray', 2)]) {
      expect(/<span[^>]*data-model-fan-out-count[^>]*>/u.exec(html)?.[0]).toContain('aria-live="polite"')
      expect(/<p[^>]*data-model-fan-out-reason[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:min-h-4/u)
    }
    expect(text(selection('bar', 0))).toContain('0 selected · up to 6')
  })

  it('names the mode control "Select" / "Done" in sight, pressed while on, 44 pt on touch', () => {
    const picker = source('model-effort-picker.tsx')
    const control = picker.slice(
      picker.lastIndexOf('<Button', picker.indexOf('data-model-select-several')),
      picker.indexOf('</Button>', picker.indexOf('data-model-select-several')),
    )
    expect(control).toContain('aria-pressed={several}')
    expect(control).toMatch(/dshx:pointer-coarse:h-11/u)
    expect(control).toContain("{several ? t('done') : t('select')}")
  })
})

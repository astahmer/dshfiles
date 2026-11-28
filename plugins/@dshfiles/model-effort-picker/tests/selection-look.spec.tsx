import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelRow } from '../src/model-row.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

const row = (active: boolean, fanOutSelected = false): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelRow
        active={active}
        busy={false}
        current={null}
        fanOutSelected={fanOutSelected}
        group={{ id: 'cc1', name: 'Command Code 1', models: [] }}
        model={{ id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' }}
        onFanOut={() => undefined}
        onInspect={() => undefined}
        onSelect={() => undefined}
        providerLabel="Command Code"
        quota={undefined}
      />
    </TooltipProvider>,
  )

const rowClasses = (html: string): string => /<div[^>]*class="([^"]*)"[^>]*data-model-picker-row/u.exec(html)?.[1] ?? ''

describe('selection is neutral, never indigo (council picker C4)', () => {
  it('marks the current row with the selected wash, the 1 px selected edge, the name at 550 and a 14 px ink check', () => {
    const html = row(true)
    const classes = rowClasses(html)
    expect(classes).toContain('dshx:bg-selected-wash')
    expect(classes).toContain('dshx:selected-edge')
    expect(classes).not.toMatch(/info|ring-1/u)
    expect(/<span[^>]*data-model-picker-name[^>]*>/u.exec(html)?.[0]).toContain('dshx:font-selected')
    expect(/<svg[^>]*data-model-current-check[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:size-3\.5 dshx:text-foreground/u)
  })

  it('leaves other rows plain, and a fan-out choice untinted', () => {
    expect(row(false)).not.toContain('data-model-current-check')
    expect(rowClasses(row(false))).not.toMatch(/bg-selected-wash/u)
    expect(rowClasses(row(false, true))).not.toMatch(/primary\/|info\//u)
  })

  it('draws no indigo fill or edge anywhere in the picker (indigo means Needs you; the focus ring keeps it)', () => {
    for (const name of ['model-row.tsx', 'model-effort-picker.tsx', 'model-details.tsx', 'account-rows.tsx', 'effort-control.tsx']) {
      expect([name, source(name).match(/dshx:(?:bg|border|ring|text)-info\b[^\s"']*/gu) ?? []]).toEqual([name, []])
    }
  })

  it('gives the search field the kit search input, so it draws one focus ring', () => {
    const picker = source('model-effort-picker.tsx')
    expect(picker).toMatch(/<SearchInput\b/u)
    expect(picker).not.toMatch(/focus-visible:ring-1/u)
  })
})

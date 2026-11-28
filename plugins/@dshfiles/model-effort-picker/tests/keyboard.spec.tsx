import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelPickerModel } from '../src/model-picker-model.js'
import { ModelRow } from '../src/model-row.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const tagOf = (text: string, marker: string): string => {
  const at = text.indexOf(marker)
  if (at < 0) throw new Error(`no element with ${marker}`)
  return text.slice(text.lastIndexOf('<', at), text.indexOf('>\n', at))
}

const row = (props: {
  readonly active?: boolean
  readonly selectSeveral?: boolean
  readonly fanOutSelected?: boolean
  readonly highlighted?: boolean
}): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelRow
        active={props.active ?? false}
        busy={false}
        current={null}
        fanOutSelected={props.fanOutSelected ?? false}
        group={{ id: 'cc1', name: 'Command Code 1', models: [] }}
        highlighted={props.highlighted ?? false}
        id="list-3"
        model={{ id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' }}
        onFanOut={() => undefined}
        onInspect={() => undefined}
        onSelect={() => undefined}
        providerLabel="Command Code"
        quota={{ percent: 62, label: 'Weekly limit', onReserve: false }}
        selectSeveral={props.selectSeveral ?? false}
      />
    </TooltipProvider>,
  )
const optionTag = (html: string): string => /<div[^>]*role="option"[^>]*>/u.exec(html)?.[0] ?? ''

describe('keyboard: one tab stop for the list (council picker C5)', () => {
  it('moves with Up and Down, uses with Enter, opens details with Right at the end of the query', () => {
    const key = (k: string, active: number, caretAtEnd = true) => ModelPickerModel.listKey({ key: k, active, count: 5, caretAtEnd })
    expect(key('ArrowDown', -1)).toEqual({ kind: 'move', index: 0 })
    expect(key('ArrowDown', 2)).toEqual({ kind: 'move', index: 3 })
    expect(key('ArrowDown', 4)).toEqual({ kind: 'move', index: 4 })
    expect(key('ArrowUp', 0)).toEqual({ kind: 'move', index: 0 })
    expect(key('Enter', 3)).toEqual({ kind: 'use', index: 3 })
    expect(key('Enter', -1)).toEqual({ kind: 'use', index: 0 })
    expect(key('ArrowRight', 2)).toEqual({ kind: 'inspect', index: 2 })
    expect(key('ArrowRight', 2, false)).toEqual({ kind: 'none' })
    expect(key('a', 2)).toEqual({ kind: 'none' })
    expect(ModelPickerModel.listKey({ key: 'Enter', active: -1, count: 0, caretAtEnd: true })).toEqual({ kind: 'none' })
  })

  it('makes each row an option the search points at, never a focusable button with a second one inside', () => {
    const html = row({ active: true })
    const option = optionTag(html)
    expect(option).toContain('id="list-3"')
    expect(option).toContain('aria-selected="true"')
    expect(option).not.toContain('aria-pressed')
    expect(option).not.toContain('tabindex')
    // Round 3 R10: no button inside the option; the chevron is its own control beside it, out of the tab order.
    const inside = html.slice(html.indexOf('role="option"'), html.indexOf('data-model-details-trigger'))
    expect(inside.match(/<button/gu) ?? []).toHaveLength(1)
    expect(/<button[^>]*data-model-details-trigger[^>]*>/u.exec(html)?.[0]).toContain('tabindex="-1"')
  })

  it('marks fan-out choices with aria-checked, not the aria-selected of the model in use', () => {
    const option = optionTag(row({ selectSeveral: true, fanOutSelected: true }))
    expect(option).toContain('aria-checked="true"')
    expect(option).not.toContain('aria-selected')
  })

  it('marks the row the keyboard is on with the hover wash, the focus ring staying on the search (round 3 R11)', () => {
    const rowTag = (html: string): string => /<div[^>]*data-model-picker-row[^>]*>/u.exec(html)?.[0] ?? ''
    expect(rowTag(row({ highlighted: true }))).toMatch(/dshx:bg-accent\/60/u)
    expect(rowTag(row({ highlighted: true }))).not.toMatch(/outline-2/u)
    expect(rowTag(row({ highlighted: false }))).not.toMatch(/ dshx:bg-accent\/60/u)
  })

  it('names the quota for assistive tech', () => {
    const html = row({})
    expect(optionTag(html)).toContain('aria-describedby="list-3-quota"')
    expect(html).toContain('>62 % left on Command Code 1<')
  })

  it('wires the search as a combobox over the listbox, with no ⌘K hint and a live region', () => {
    const picker = source('model-effort-picker.tsx')
    const search = tagOf(picker, '<SearchInput')
    for (const attribute of ['role="combobox"', 'aria-controls={listboxId}', 'aria-activedescendant=', 'aria-expanded={open}', 'aria-autocomplete="list"'])
      expect(search).toContain(attribute)
    expect(tagOf(picker, 'aria-label="Models and accounts"')).toContain('role="listbox"')
    expect(picker).not.toMatch(/metaKey|⌘|<Kbd/u)
    // The scroll viewport is no second tab stop (Chrome focuses a scroller whose children are not focusable).
    expect(picker).toContain("closest('[data-slot=\"scroll-area-viewport\"]')?.setAttribute('tabindex', '-1')")
    expect(tagOf(picker, 'data-model-picker-announcer')).toContain('aria-live="polite"')
    expect(ModelPickerModel.resultAnnouncement({ query: 'zz', count: 0 })).toBe('No models match “zz”')
    expect(ModelPickerModel.resultAnnouncement({ query: 'gpt', count: 3 })).toBe('3 models')
  })

  it('names the "?" buttons for what they explain', () => {
    expect(source('effort-control.tsx')).toContain('label="About reasoning effort"')
    expect(source('fallbacks-section.tsx')).toContain('label="About fallbacks"')
  })
})

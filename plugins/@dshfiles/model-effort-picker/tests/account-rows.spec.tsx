import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountRows } from '../src/account-rows.js'
import { ModelPickerModel } from '../src/model-picker-model.js'

const accounts = [
  { id: 'codex', name: 'Codex 1' },
  { id: 'cc1', name: 'Command Code 1' },
  { id: 'cc2', name: 'Command Code 2' },
  { id: 'cc3', name: 'Command Code 3' },
]
const quotas = new Map([
  ['cc1', { percent: 62, label: 'Weekly limit', onReserve: false }],
  ['cc2', { percent: 12, label: 'Weekly limit', onReserve: false }],
  ['cc3', { percent: 0, label: 'Weekly limit', onReserve: false }],
])

const html = renderToStaticMarkup(<AccountRows accents={new Map()} accounts={accounts} onChoose={() => undefined} quotas={quotas} selected="cc1" />)
const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>.*?<\/button>/gu)].map(match => match[0])
const text = (fragment: string): string => fragment.replace(/<[^>]+>/gu, '')

describe('accounts are full-width radio rows (council picker C3)', () => {
  it('lists one full-width radio row per account, 32 px and 44 px on touch, the chosen one checked with a check', () => {
    expect(html).toContain('role="radiogroup"')
    expect(radios).toHaveLength(4)
    for (const radio of radios)
      expect(radio).toMatch(/dshx:w-full[^"]*dshx:h-8[^"]*dshx:pointer-coarse:h-11|dshx:h-8[^"]*dshx:w-full[^"]*dshx:pointer-coarse:h-11/u)
    const checked = radios.filter(radio => radio.includes('aria-checked="true"'))
    expect(checked).toHaveLength(1)
    expect(checked[0]).toContain('aria-label="Command Code 1"')
    expect(checked[0]).toContain('data-model-account-check')
    expect(radios.filter(radio => radio.includes('data-model-account-check'))).toHaveLength(1)
  })

  it('heads the quota column with its window and right-aligns tabular percentages, no tooltip needed', () => {
    expect(text(html)).toContain('Weekly quota left')
    expect(html).not.toContain('tooltip-trigger')
    const quota = (radio: string | undefined): string =>
      /<span[^>]*data-model-account-quota[^>]*>.*?<\/span><\/span>|<span[^>]*data-model-account-quota[^>]*>[^<]*<\/span>/u.exec(radio ?? '')?.[0] ?? ''
    expect(quota(radios[1])).toMatch(/dshx:tabular-nums/u)
    expect(quota(radios[1])).toMatch(/dshx:text-right/u)
    expect(text(radios[1] ?? '')).toContain('62%')
  })

  it('tells an unknown quota from an empty one, and tones 15 % or less amber and 0 % red', () => {
    expect(text(radios[0] ?? '')).toContain('—')
    expect(text(radios[0] ?? '')).toContain('quota unknown')
    expect(radios[2]).toMatch(/dshx:text-warning/u)
    expect(radios[3]).toMatch(/dshx:text-destructive/u)
    expect(text(radios[3] ?? '')).toContain('0%')
    expect(radios[1]).not.toMatch(/dshx:text-warning|dshx:text-destructive/u)
  })

  it('names each quota for assistive tech', () => {
    expect(text(radios[1] ?? '')).toContain('62 % left on Command Code 1')
  })

  it('reads the heading from the binding window, and says nothing when no quota is known', () => {
    expect(ModelPickerModel.quotaHeading([{ percent: 1, label: 'Weekly limit', onReserve: false }])).toBe('Weekly quota left')
    expect(
      ModelPickerModel.quotaHeading([
        { percent: 1, label: '5-hour limit', onReserve: false },
        { percent: 1, label: 'Weekly limit', onReserve: false },
      ]),
    ).toBe('Quota left')
    expect(ModelPickerModel.quotaHeading([])).toBeUndefined()
  })
})

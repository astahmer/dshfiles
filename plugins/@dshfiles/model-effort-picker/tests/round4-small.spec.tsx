import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountRows } from '../src/account-rows.js'
import { createEffortCommitter } from '../src/effort-control.js'
import { ModelPickerModel } from '../src/model-picker-model.js'
import { MatchedName } from '../src/model-row.js'
import { BrandMark } from '../src/picker-atoms.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

describe('round 4 smaller fixes (council picker T16)', () => {
  it('draws the matched part of a name at 600 and leaves the text otherwise untouched', () => {
    const html = renderToStaticMarkup(<MatchedName name="gpt-6.2-astra" query="6.2" />)
    expect(html).toBe('gpt-<span class="dshx:font-semibold dshx:text-foreground" data-model-match="true">6.2</span>-astra')
    expect(renderToStaticMarkup(<MatchedName name="gpt-6-luna" query="" />)).toBe('gpt-6-luna')
    expect(renderToStaticMarkup(<MatchedName name="gpt-6-luna" query="zz" />)).toBe('gpt-6-luna')
  })

  it('lifts the unknown-family disc in dark', () => {
    expect(renderToStaticMarkup(<BrandMark brand={undefined} name="zeta" />)).toContain('dshx:dark:bg-(--dshx-tone-5)')
  })

  it('draws one account as a plain line, not a lone radio', () => {
    const one = renderToStaticMarkup(
      <AccountRows accents={new Map()} accounts={[{ id: 'codex', name: 'Codex 1' }]} onChoose={() => undefined} quotas={new Map()} selected="codex" />,
    )
    expect(one).not.toContain('role="radio')
    expect(one).toContain('data-model-account-single')
  })

  it('writes "No reasoning" on the trigger instead of "Off"', () => {
    expect(ModelPickerModel.triggerEffortText('Off')).toBe('No reasoning')
    expect(ModelPickerModel.triggerEffortText('none')).toBe('No reasoning')
    expect(ModelPickerModel.triggerEffortText('High')).toBe('High')
    expect(source('model-effort-picker.tsx')).toContain('{ModelPickerModel.triggerEffortText(effortLabel)}')
  })

  it('announces a level applied by resting, politely, and not a click', () => {
    const settled: (string | undefined)[] = []
    let run = (): void => undefined
    const committer = createEffortCommitter({
      commit: () => undefined,
      onSettled: value => settled.push(value),
      schedule: next => {
        run = next
        return () => undefined
      },
    })
    committer.commitNow('low')
    expect(settled).toEqual([])
    committer.preview('high')
    run()
    expect(settled).toEqual(['high'])
    expect(source('effort-control.tsx')).toMatch(/aria-live="polite"[^>]*data-model-effort-announcer[\s\S]{0,200}Reasoning effort: \$\{[^}]*\}, applied/u)
  })

  it('keeps Select rendered (disabled) when no row matches, so the search never widens', () => {
    expect(source('model-effort-picker.tsx')).toContain('disabled={!several && rows.length === 0}')
  })
})

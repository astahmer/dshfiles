import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { EffortControl } from '../src/effort-control.js'
import { ModelPickerModel } from '../src/model-picker-model.js'

const levels = ['Off', 'Minimal', 'Low', 'Medium', 'High', 'Xhigh', 'Max'].map(name => ({ id: name.toLowerCase(), name, description: '' }))

const render = (selected: string | undefined, efforts = levels): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <EffortControl efforts={efforts} onChange={() => undefined} selected={selected} />
    </TooltipProvider>,
  )

const text = (html: string): string => html.replace(/<[^>]+>/gu, '')

const radios = (html: string): string[] => [...html.matchAll(/<button[^>]*role="radio"[^>]*>(.*?)<\/button>/gu)].map(match => match[0])

describe('reasoning effort is a discrete, truthful choice (council picker C1)', () => {
  it('names every level with a short label', () => {
    expect(levels.map(effort => ModelPickerModel.effortShortLabel(effort))).toEqual(['Off', 'Min', 'Low', 'Med', 'High', 'XHigh', 'Max'])
    expect(ModelPickerModel.effortShortLabel({ id: 'turbo-plus', name: 'Turbo plus' })).toBe('Turbo plus')
  })

  it('is one radio per supported level, 28 px tall and 44 px on touch, with no slider or label buttons over a thumb', () => {
    const html = render('medium')
    const options = radios(html)
    expect(options).toHaveLength(7)
    for (const option of options) {
      expect(option).toMatch(/dshx:h-7/u)
      expect(option).toMatch(/dshx:pointer-coarse:h-11/u)
    }
    expect(html).toContain('role="radiogroup"')
    expect(html).not.toContain('role="slider"')
    expect(options.filter(option => option.includes('aria-checked="true"'))).toHaveLength(1)
    expect(options.find(option => option.includes('aria-checked="true"'))).toContain('>Med<')
  })

  it('says the selected level in the heading', () => {
    expect(text(render('medium'))).toContain('Reasoning effort · Medium')
  })

  it('shows the provider default as its own option, never as the first level', () => {
    const html = render(undefined)
    expect(text(html)).toContain('Reasoning effort · Provider default')
    expect(radios(html).some(option => option.includes('aria-checked="true"'))).toBe(false)
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Provider default<\/button>/u)
  })

  it('is hidden when the model has no levels', () => {
    expect(render(undefined, [])).toBe('')
  })
})

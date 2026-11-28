import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UseButton } from '../src/model-details.js'
import { ModelPickerModel } from '../src/model-picker-model.js'

describe('long names on the phone (council picker round 4, T5)', () => {
  it('splits a long name into a head the width truncates and a tail that stays (round 5 U1 replaces the cut by count)', () => {
    expect(ModelPickerModel.nameTail('mistral-large-3-instruct-2512-extended-context-preview')).toEqual({
      head: 'mistral-large-3-instruct-2512-extended-context',
      tail: '-preview',
    })
    expect(ModelPickerModel.nameTail('gpt-6-luna')).toEqual({ head: 'gpt-6-luna', tail: '' })
    expect(ModelPickerModel.nameTail('a'.repeat(30))).toEqual({ head: 'a'.repeat(18), tail: 'a'.repeat(12) })
  })

  it('keeps the full name in the Use button accessible name, whatever its visible label', () => {
    const html = renderToStaticMarkup(<UseButton busy={false} name="mistral-large-3-instruct-2512-extended-context-preview" onUse={() => undefined} />)
    expect(html).toContain('aria-label="Use mistral-large-3-instruct-2512-extended-context-preview"')
    expect(html).toMatch(/<span class="dshx:min-w-0 dshx:truncate">Use mistral/u)
  })
})

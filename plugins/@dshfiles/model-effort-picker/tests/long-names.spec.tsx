import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UseButton } from '../src/model-details.js'
import { ModelPickerModel } from '../src/model-picker-model.js'

describe('long names on the phone (council picker round 4, T5)', () => {
  it('cuts a long name in the middle, keeping its first 18 and last 14 characters', () => {
    const long = 'mistral-large-3-instruct-2512-extended-context-preview'
    expect(ModelPickerModel.middleTruncate(long)).toBe('mistral-large-3-in…ontext-preview')
    expect(ModelPickerModel.middleTruncate('gpt-6-luna')).toBe('gpt-6-luna')
    expect(ModelPickerModel.middleTruncate('a'.repeat(33))).toBe('a'.repeat(33))
  })

  it('keeps the full name in the Use button accessible name, whatever its visible label', () => {
    const html = renderToStaticMarkup(<UseButton busy={false} name="mistral-large-3-instruct-2512-extended-context-preview" onUse={() => undefined} />)
    expect(html).toContain('aria-label="Use mistral-large-3-instruct-2512-extended-context-preview"')
    expect(html).toMatch(/<span class="dshx:min-w-0 dshx:truncate">Use mistral/u)
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MatchedName } from '../src/model-row.js'

describe('a search match never reads as the model in use (council picker round 5, U14)', () => {
  it('underlines the match at the name weight, with no 600', () => {
    const html = renderToStaticMarkup(<MatchedName name="gpt-6-luna" query="luna" />)
    const match = /<span[^>]*data-model-match[^>]*>/u.exec(html)?.[0] ?? ''
    expect(match).toContain('dshx:underline')
    expect(match).not.toMatch(/font-semibold|font-bold|font-selected/u)
  })

  it('draws the underline unbroken and 3 px down (round 6 V13)', () => {
    const match = /<span[^>]*data-model-match[^>]*>/u.exec(renderToStaticMarkup(<MatchedName name="gpt-6-luna" query="luna" />))?.[0] ?? ''
    expect(match).toContain('dshx:underline-offset-3 dshx:[text-decoration-skip-ink:none]')
  })
})

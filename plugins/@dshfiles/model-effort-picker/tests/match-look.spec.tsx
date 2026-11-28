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
})

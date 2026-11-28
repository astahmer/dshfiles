import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FastModeRow } from '../src/fast-mode-section.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

describe('every control has a name, and Right works after Back (council picker round 5, U15)', () => {
  it('names the Fast switch explicitly', () => {
    const html = renderToStaticMarkup(<FastModeRow disabled={false} enabled={false} error={null} onChange={() => undefined} />)
    expect(/<button[^>]*role="switch"[^>]*>/u.exec(html)?.[0]).toContain('aria-label="Fast mode"')
  })

  it('makes the Fallbacks row twin a pointer-only span, not a nameless button', () => {
    const fallbacks = source('fallbacks-section.tsx')
    const at = fallbacks.indexOf('data-model-fallbacks-chevron')
    expect(fallbacks.slice(fallbacks.lastIndexOf('<', at), at)).toMatch(/^<span/u)
  })

  it('puts the caret at the end of the query when details go back to the list', () => {
    expect(source('model-effort-picker.tsx')).toContain('input?.setSelectionRange(input.value.length, input.value.length)')
  })
})

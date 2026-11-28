// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DisclosureLink } from '../src/components/ui/disclosure-link.js'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

afterEach(cleanup)

const sheet = (file: string): string => readFileSync(join(process.cwd(), 'src', file), 'utf8')
/** The body of one `@utility` block, nested braces included. */
const utility = (css: string, name: string): string => {
  const start = css.indexOf(`@utility ${name} {`)
  if (start < 0) return ''
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index++) {
    if (css[index] === '{') depth++
    if (css[index] === '}' && --depth === 0) return css.slice(start, index + 1)
  }
  return ''
}

describe('DisclosureLink (council round 15 A3)', () => {
  it('is a button in the disclosure-link look that says whether it is open', () => {
    const view = render(<DisclosureLink open={false}>More font settings</DisclosureLink>)
    const link = view.getByRole('button', { name: 'More font settings' })
    expect(link.getAttribute('type')).toBe('button')
    expect(link.dataset['slot']).toBe('disclosure-link')
    expect(link.className).toContain('dshx:disclosure-link')
    expect(link.getAttribute('aria-expanded')).toBe('false')
    view.rerender(<DisclosureLink open>More font settings</DisclosureLink>)
    expect(link.getAttribute('aria-expanded')).toBe('true')
    expect(link.dataset['state']).toBe('open')
  })

  it('without `open` is a plain link-look button, and takes another element with `asChild`', () => {
    const view = render(<DisclosureLink>Details</DisclosureLink>)
    expect(view.getByRole('button').hasAttribute('aria-expanded')).toBe(false)
    view.rerender(
      <DisclosureLink asChild>
        <a href="#fonts">Fonts</a>
      </DisclosureLink>,
    )
    const anchor = view.getByRole('link', { name: 'Fonts' })
    expect(anchor.className).toContain('dshx:disclosure-link')
    expect(anchor.hasAttribute('type')).toBe(false)
  })

  it('draws the link token at 13/18 500, a 12px chevron 4px after the text, underlined only under the pointer', () => {
    const css = utility(sheet('disclosure.css'), 'disclosure-link')
    expect(css).not.toBe('')
    expect(css).toMatch(/\n  color: var\(--dsw-alias-link\b/)
    expect(css).toContain('gap: 4px;')
    expect(css).toContain('font-size: var(--dshx-density-text-ui, 13px);')
    expect(css).toContain('line-height: 18px;')
    expect(css).toContain('font-weight: 500;')
    expect(css).toContain('text-decoration: none;')
    expect(css).toMatch(/&:hover \{\s+text-decoration: underline;/)
    expect(css).toMatch(/&::after \{[^}]*width: 12px;\s+height: 12px;\s+background-color: currentColor;/)
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s+min-height: 44px;/)
    // The kit's one focus ring covers it outside a kit root too.
    expect(sheet('styles.css')).toContain("[data-slot='disclosure-link'],")
  })

  it.each<Scheme>(['light', 'dark'])('keeps the link token at AA on the page and the nav surface (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    // The link token is the accent: `--dsw-alias-link` reads `--dshx-tone-accent`, the palette's accent text.
    const declarations = ThemeCss.blockDeclarations(WARM_STONE, scheme).join('\n')
    expect(declarations).toContain('--dsw-alias-link: var(--dshx-tone-accent);')
    expect(declarations).toContain(`--dshx-tone-accent: ${PaletteMath.toCss(p.accent.fg)};`)
    for (const [surface, under] of [
      ['page', p.neutral[0]!],
      ['nav', p.navSurface],
      ['panel', p.neutral[1]!],
    ] as const)
      expect(PaletteMath.contrastRatio(p.accent.fg, under), `link on ${surface}`).toBeGreaterThanOrEqual(4.5)
  })
})

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compactStatusStrip } from './native/client/AppFrame.js'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/client/AppFrame.module.css'), 'utf8')

/** A view whose media rule matches only the landscape clause (`(pointer: coarse) and (max-height: 500px)`). */
// SAFETY: compactStatusStrip reads only `matches` from the lists these views return.
const sideways: Pick<Window, 'matchMedia'> = {
  matchMedia: (query: string) => ({ matches: query.split(',').some(part => part.trim() === '(pointer: coarse) and (max-height: 500px)') }) as MediaQueryList,
}
// SAFETY: as above, only `matches` is read.
const desktop: Pick<Window, 'matchMedia'> = { matchMedia: () => ({ matches: false }) as MediaQueryList }

describe('phone turned sideways (unslop U8)', () => {
  it('collapses the status strip to the phone chip at 844px wide when the phone rule matches', () => {
    expect(compactStatusStrip(844, sideways)).toBe(true)
    expect(compactStatusStrip(390, desktop)).toBe(true)
    expect(compactStatusStrip(1440, desktop)).toBe(false)
  })

  it('gives the phone shell the whole width under the same rule, not under the width alone', () => {
    const block = css.slice(css.indexOf(':global([data-shell-phone-nav]) .frame {') - 2000, css.indexOf(':global([data-shell-phone-nav]) .frame {'))
    const media = [...block.matchAll(/@media ([^{]+)\{/gu)].at(-1)?.[1]?.trim()
    expect(media).toBe('(max-width: 639.98px), (pointer: coarse) and (max-height: 500px)')
  })
})

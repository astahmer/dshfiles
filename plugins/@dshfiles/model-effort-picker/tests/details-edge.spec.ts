import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const details = readFileSync(new URL('../src/model-details.tsx', import.meta.url), 'utf8')

describe('the details body under its header line (council picker round 5, U10)', () => {
  it('drops the top fade once the header draws its hairline, keeping the bottom fade', () => {
    const at = details.indexOf('data-model-details-body')
    const tag = details.slice(details.lastIndexOf('<div', at), details.indexOf('>\n', at))
    expect(tag).toContain('dshx:data-[scrolled]:[mask-image:linear-gradient(to_bottom,black,black_calc(100%-8px),transparent)]')
    expect(tag).toContain('data-scrolled={scrolled || undefined}')
  })
})

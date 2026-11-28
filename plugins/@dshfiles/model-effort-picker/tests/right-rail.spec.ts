import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

describe('one right rail on desktop (council picker round 6, V11)', () => {
  it('moves Close 3 px in and sets the account rows, the Fallbacks chevron and the fallback quota to its line', () => {
    expect(source('model-effort-picker.tsx')).toContain("'dshx:absolute dshx:right-3.25 dshx:flex dshx:size-5")
    expect(source('account-rows.tsx')).toContain('dshx:px-2 dshx:pointer-fine:pr-1.75 dshx:text-left')
    expect(source('account-rows.tsx')).toContain('dshx:pr-7.5 dshx:pointer-fine:pr-7.25')
    expect(source('fallbacks-section.tsx')).toContain('dshx:tabular-nums dshx:pointer-fine:-mr-1.75')
    expect(source('fallbacks-section.tsx')).toContain('dshx:pr-1.75 dshx:pointer-coarse:pr-1.5')
  })
})

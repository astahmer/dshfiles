import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')

describe('Close never sits inside the search field (council picker round 4, T6)', () => {
  it('narrows an empty catalog to the list width and keeps room for Close beside the search', () => {
    expect(picker).toContain("catalogEmpty && 'dshx:w-[min(22.5rem,calc(100vw-1.5rem))]'")
    // Round 5 U6: an empty catalog has no search row at all.
    expect(picker).toMatch(/catalogEmpty && 'dshx:hidden'\)\}\s*data-model-search-row/u)
  })
})

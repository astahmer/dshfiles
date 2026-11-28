import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')

describe('the empty catalog keeps the picker edges (council picker round 6, V6)', () => {
  it('centres its message with both side insets, and puts the phone title at the sheet inset', () => {
    expect(picker).toContain("catalogEmpty ? 'dshx:@max-pane-compact:pr-2' : 'dshx:@max-pane-compact:pr-0'")
    expect(picker).toContain("catalogEmpty && 'dshx:flex dshx:pl-1.5 dshx:pointer-coarse:pl-0'")
  })

  it('keeps Close at the popover inset on desktop, where the narrow empty picker is compact too', () => {
    expect(picker).toContain("'dshx:top-3 dshx:pointer-coarse:top-0 dshx:pointer-coarse:right-0'")
  })
})

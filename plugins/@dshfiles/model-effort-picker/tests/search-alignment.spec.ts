import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')

describe('the desktop search starts with the rows (council picker round 6, V9)', () => {
  it('pads the list section 8 px and gives the list no left padding on desktop, keeping the phone insets', () => {
    expect(picker).toContain("'dshx:flex dshx:w-90 dshx:min-w-0 dshx:shrink-0 dshx:flex-col dshx:gap-1.5 dshx:p-2 dshx:@max-pane-compact:pb-1.5'")
    expect(picker).toContain('dshx:flex dshx:flex-col dshx:gap-px dshx:py-1 dshx:pr-1 dshx:@max-pane-compact:pl-1 dshx:@max-pane-compact:pr-2')
  })
})

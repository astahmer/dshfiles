import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the phone details header follows Back closely (council picker round 6, V5)', () => {
  it("pulls the mark 16 px into Back's 44 pt box and lets taps pass through it to Back", () => {
    const details = readFileSync(new URL('../src/model-details.tsx', import.meta.url), 'utf8')
    expect(details).toContain('dshx:pointer-events-none dshx:size-[18px] dshx:pointer-coarse:mt-[13px] dshx:pointer-coarse:@max-pane-compact:-ml-4')
  })
})

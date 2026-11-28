import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

describe('the phone list pane has one inset on both sides (council picker round 6, V4)', () => {
  it('keeps 8 px on the right of the search row, the list and the select bar (its divider too)', () => {
    const picker = source('model-effort-picker.tsx')
    expect(picker).toContain("'dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:@max-pane-compact:pr-2'")
    expect(picker).toContain('dshx:flex dshx:flex-col dshx:gap-px dshx:py-1 dshx:pr-1 dshx:@max-pane-compact:pl-1 dshx:@max-pane-compact:pr-2')
    expect(source('fan-out-bar.tsx')).toContain('dshx:pt-1.5 dshx:@max-pane-compact:mr-2')
  })

  it('lets only the 44 pt chevron box overhang, to Close\'s edge', () => {
    expect(source('model-row.tsx')).toContain('dshx:pointer-coarse:size-11 dshx:pointer-coarse:@max-pane-compact:-mr-2')
  })
})

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const sources = ['turn-file-chips.tsx', 'turn-summary-line.tsx']

describe('change counts use the kit DiffStat (round five C1, council round 3)', () => {
  it.each(sources)('%s draws +N −M with DiffStat, not hand-rolled spans', file => {
    const source = readFileSync(resolve(here, file), 'utf8')
    expect(source).toContain("from '@dshfiles/plugin-ui/components/diff-stat'")
    expect(source).toMatch(/<DiffStat added=\{/u)
    expect(source).not.toMatch(/>\s*\+\{[^}]*added\}/u)
    expect(source).not.toMatch(/[−-]\{[^}]*(removed|deleted)\}/u)
  })
})

import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { quotaTone } from '../src/picker-atoms.js'

describe('quota text reads at 4.5:1 (council picker round 3, R5)', () => {
  it('draws a healthy quota in the secondary ink with no opacity, amber at 15 % or less and red once spent', () => {
    expect(quotaTone(62)).toBe('dshx:text-muted-foreground')
    expect(quotaTone(15)).toBe('dshx:text-warning')
    expect(quotaTone(0.4)).toBe('dshx:text-destructive')
  })

  it('keeps one quota convention in the picker and no faded secondary ink anywhere on its text', () => {
    for (const name of readdirSync(new URL('../src/', import.meta.url)).filter(file => file.endsWith('.tsx'))) {
      const source = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
      expect([name, source.includes('const quotaTone')]).toEqual([name, name === 'picker-atoms.tsx'])
      expect([name, source.match(/dshx:text-muted-foreground\/\d+/gu) ?? []]).toEqual([name, []])
    }
  })
})

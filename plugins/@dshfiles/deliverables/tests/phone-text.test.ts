import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs each package from its root.
const read = (file: string): string => readFileSync(join(process.cwd(), 'src/native', file), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')

/** Selectors that set a fixed font size under 12px outside any media block. */
const smallSelectors = (css: string): string[] => {
  const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, '')
  const found: string[] = []
  for (const match of top.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const size = /font-size:\s*(\d+(?:\.\d+)?)px/u.exec(match[2] ?? '')
    if (size !== null && Number(size[1]) < 12) found.push(...(match[1] ?? '').split(',').map(part => part.trim()))
  }
  return found
}

/** Selectors a coarse-pointer block sizes from the density minimum (12px on a phone). */
const coarseDensitySelectors = (css: string): string[] => {
  const found: string[] = []
  for (const media of css.matchAll(/@media \(pointer: coarse\)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/gu)) {
    for (const match of (media[1] ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      if (/font-size:\s*var\(--dshx-density-text-min, 12px\)/u.test(match[2] ?? '')) found.push(...(match[1] ?? '').split(',').map(part => part.trim()))
    }
  }
  return found
}

describe('changed-files and delivery cards on a phone (unslop U7)', () => {
  it.each(['ChangedFiles.module.css', 'Deliverables.module.css'])('%s lifts every string under 12px to the density minimum on a coarse pointer', file => {
    const css = read(file)
    const small = smallSelectors(css)
    expect(small.length).toBeGreaterThan(0)
    expect(coarseDensitySelectors(css)).toEqual(expect.arrayContaining(small))
  })
})
